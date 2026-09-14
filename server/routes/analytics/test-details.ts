import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { config } from "../../config";
import { storage } from "../../storage";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { checkAnswer } from "../../utils/check-answer";
import { loadTestScoringContext } from "../../services/effective-scoring";
import type { AttemptResult } from "@shared/schema";
import { stripMarkdown } from "@shared/text";
import { loadAnswerFacts, summariseAnswers } from "../../services/analytics/answers";
import { scoreBuckets } from "../../services/analytics/score-buckets";
import { loadObservations } from "../../services/analytics/observations";
import { passTrendByMonth } from "../../services/analytics/pass-trend";
import { reviewFlags } from "../../services/analytics/question-review";
import { summariseTopics } from "../../services/analytics/topic-stats";
import { summariseObservations } from "../../services/analytics/test-summary";
import { resolveOverallRule, resolveTopicRule } from "@shared/scoring/pass-rule";
import { declaresPassThreshold, thresholdPercentOfTest } from "./helpers";

const router = Router();

/**
 * Состав выданной формы прохождения — идентификаторы заданий, которые человек ВИДЕЛ.
 *
 * У обычного теста это вопросы разделов, у адаптивного — вопросы пройденных уровней.
 * Отвеченное описывает `answersJson`; разница между двумя множествами и есть пропуски
 * (PRD-56 FR-15).
 */
function variantQuestionIds(variantJson: unknown): string[] {
  const variant = variantJson as {
    sections?: Array<{ questionIds?: string[] }>;
    topics?: Array<{ levelsState?: Array<{ questionIds?: string[] }> }>;
  } | null;
  if (!variant) return [];

  const ids: string[] = [];
  for (const section of variant.sections ?? []) ids.push(...(section.questionIds ?? []));
  for (const topic of variant.topics ?? []) {
    for (const level of topic.levelsState ?? []) ids.push(...(level.questionIds ?? []));
  }
  return ids;
}

// GET /api/analytics/tests/:testId - Детальная аналитика теста
router.get("/:testId", requirePermission("analytics.read"), requireTestScope("analytics", "testId"), async (req: Request, res: Response) => {
  try {
    const testId = req.params.testId;
    const test = await storage.getTest(testId);

    if (!test) {
      return res.status(404).json({ error: "Test not found" });
    }

    const allAttempts = await storage.getAllAttempts();
    const testAttempts = allAttempts.filter(a => a.testId === testId);
    const completedAttempts = testAttempts.filter(a => a.resultJson !== null);

    // PRD-29 §6.7: does this test grade at all? Averaged over runs that graded
    // NOTHING, «средний балл» and «процент прохождения» are not weak numbers —
    // they are false ones: a questionnaire carries the default 70% threshold and
    // an `overallPassed: true` nobody pronounced, so the screen used to headline
    // «0.0 %» beside «100 % успешно сдали тест». Counts stay (the runs happened);
    // the grade-shaped metrics answer `null` — «неприменимо», not «ноль».
    const thresholdDeclared = declaresPassThreshold(test);

    // PRD-56 FR-33: плитки считаются по ВСЕМ прохождениям теста — вебу, телеметрии и
    // импортированным выгрузкам. До этого страница читала только `attempts`, и на тесте,
    // который проходят в LMS, её числа расходились с разделом «Аналитика» (FR-25).
    // Область видимости уже проверена `requireTestScope` выше, поэтому здесь она открыта.
    const observations = await loadObservations(
      { testIds: [testId] },
      { all: true, ids: new Set([testId]) },
    );
    const stats = summariseObservations(observations.rows);

    const summary = {
      totalAttempts: stats.totalAttempts,
      completedAttempts: stats.completedAttempts,
      // The two denominators, published so a reader can tell «неприменимо» (a `null`
      // metric over zero of these) from «ноль» (a real zero over a positive count).
      gradedAttempts: stats.gradedAttempts,
      judgedAttempts: stats.judgedAttempts,
      uniqueUsers: stats.uniqueParticipants,
      avgPercent: stats.avgPercent,
      // Секунды: контракт экрана не меняется от смены источника данных.
      avgDuration: stats.avgDurationMs === null ? null : stats.avgDurationMs / 1000,
      // Медиана рядом со средним — величина, которой экран будет пользоваться после Э4
      // (эскиз обзора подписывает плитку «Время, медиана»).
      medianDuration: stats.medianDurationMs === null ? null : stats.medianDurationMs / 1000,
      passRate: stats.passRate,
      avgScore: stats.avgScore,
      maxScore: stats.maxScore ?? 0,
    };


    // Question stats
    const allQuestionIds = new Set<string>();
    for (const attempt of testAttempts) {
      for (const questionId of variantQuestionIds(attempt.variantJson)) {
        allQuestionIds.add(questionId);
      }
    }

    // PRD-56 FR-25: ответы прохождений из LMS. Задание, выданное только пакетом, в вариантах
    // веб-попыток не встречается — без этого шага его ответы отбрасывались бы молча.
    const lmsAnswers = await storage.selectAnswersForTest(testId);
    for (const answer of lmsAnswers) allQuestionIds.add(answer.questionId);

    const questions = await storage.getQuestionsByIds(Array.from(allQuestionIds));
    const questionMap = new Map(questions.map(q => [q.id, q]));
    const topics = await storage.getTopics();
    const topicMap = new Map(topics.map(t => [t.id, t.name]));

    // PRD-15 block D (FR-32): correctness/difficulty use the test-effective chain.
    const scoring = await loadTestScoringContext(testId, storage);

    interface QuestionStatsEntry {
      questionId: string;
      questionPrompt: string;
      questionType: string;
      topicId: string;
      topicName: string;
      difficulty: number;
      /** Сколько раз ответили — включая ответы, которым нечего было оценивать. */
      totalAnswers: number;
      /** Сколько из них оценивалось: только по ним законна доля верных. */
      gradedAnswers: number;
      correctAnswers: number;
      /** Доля верных; `null` — оценивать было нечего (измерительный вопрос). */
      correctPercent: number | null;
      answersBySource: Record<string, number>;
    }

    const questionStatsMap = new Map<string, QuestionStatsEntry>();

    /**
     * PRD-56 FR-25: ответы обоих источников сводятся одним расчётом.
     *
     * Оценка веб-ответа остаётся здесь: эффективная стоимость и правило проверки вопроса
     * внутри теста уже разрешены (`loadTestScoringContext`), и считать их во второй раз в
     * слое ответов значило бы завести второй источник правды о том, что такое «верно».
     * Измерительный вопрос не оценивается вовсе — у него нет эталона (PRD-26 FR-08,
     * PRD-44 FR-09), и его ответ приходит третьим состоянием.
     */
    const facts = await loadAnswerFacts(testId, {
      attempts: completedAttempts,
      grade: (questionId, answer) => {
        const question = questionMap.get(questionId);
        if (!question) return null;
        if (question.type === "scale" || question.type === "allocation") {
          return { result: "neutral", earnedPoints: null, possiblePoints: null };
        }
        const effective = scoring.resolve(question);
        const ratio = checkAnswer(question, answer, effective.scoring);
        return {
          result: ratio === 1 ? "correct" : "incorrect",
          earnedPoints: ratio * effective.points,
          possiblePoints: effective.points,
        };
      },
    });

    for (const stats of summariseAnswers(facts)) {
      const question = questionMap.get(stats.questionId);
      if (!question) continue;

      questionStatsMap.set(stats.questionId, {
        questionId: stats.questionId,
        questionPrompt: stripMarkdown(question.prompt),
        questionType: question.type,
        topicId: question.topicId,
        topicName: topicMap.get(question.topicId) || "Unknown",
        difficulty: scoring.difficultyOf(question) || 50,
        totalAnswers: stats.answered,
        gradedAnswers: stats.graded,
        correctAnswers: stats.correct,
        correctPercent: stats.correctPercent,
        answersBySource: stats.bySource,
      });
    }

    /**
     * PRD-56 FR-14, FR-14a: разрезы по темам и подтемам — из тех же ответов.
     *
     * Порог темы разрешается правилом теста (`resolveTopicRule`), а исход считает движок
     * PRD-50: своего правила аналитика не заводит, иначе исход в отчёте участника и исход
     * на этом экране однажды разойдутся.
     */
    const sections = await storage.getTestSections(testId);
    const overallRule = resolveOverallRule(test.overallPassRuleJson);
    const topicRules = new Map(sections.map(section => [
      section.topicId,
      resolveTopicRule(section.topicPassRuleJson, overallRule),
    ]));

    const topicStats = summariseTopics(
      facts.flatMap(fact => {
        const question = questionMap.get(fact.questionId);
        if (!question) return [];
        return [{
          attemptId: fact.attemptId,
          topicId: question.topicId,
          topicName: topicMap.get(question.topicId) || "Без темы",
          // Подтема — тег вопроса (PRD-11): ответ может попасть в несколько, и это правда
          // о данных, а не ошибка счёта.
          subtopics: question.tags ?? [],
          result: fact.result,
          earnedPoints: fact.earnedPoints,
          possiblePoints: fact.possiblePoints,
        }];
      }),
      topicRules,
    );

    // Знаменатель доли — попытки теста за окно, считая БРОШЕННЫЕ: счётчик выдач пополняется на
    // старте попытки (FR-02), потому что брошенная попытка показала задание так же, как
    // доведённая до конца. Завершённые попытки в знаменателе давали бы долю больше ста процентов
    // ровно на число брошенных — «выдано 3 из 2» на первой же приёмке.
    //
    // Ноль попыток означает «сравнивать не с чем»: доля тогда `null`, а не ноль, иначе экран
    // покажет «0%» там, где данных нет вовсе.
    const exposureWindowStart = new Date();
    exposureWindowStart.setMonth(exposureWindowStart.getMonth() - config.delivery.exposureWindowMonths);
    const attemptsInWindow = testAttempts.filter(
      (a) => new Date(a.startedAt as Date) >= exposureWindowStart,
    ).length;

    // PRD-55 (FR-31/FR-31a/FR-32): экспозиция задания и время на него. Три запроса на ВЕСЬ тест,
    // а не по заданию: карточек на экране десятки, и запрос в цикле превратил бы страницу в
    // сотню обращений к базе.
    //
    // Ни одна из величин не является условием работы экрана: это дополнение к статистике
    // ответов, поэтому сбой чтения уходит в лог, а страница отдаётся без них.
    const questionIds = Array.from(questionStatsMap.keys());
    let exposureOwn = new Map<string, number>();
    let exposureGlobal = new Map<string, number>();
    let otherTests = new Map<string, number>();
    let latency = new Map<string, { medianMs: number; sampleSize: number }>();
    try {
      [exposureOwn, exposureGlobal, otherTests, latency] = await Promise.all([
        storage.getDeliveryCountsForTest(questionIds, testId, exposureWindowStart),
        storage.getDeliveryCounts(questionIds, exposureWindowStart),
        storage.getOtherTestsCount(questionIds, testId, exposureWindowStart),
        storage.getLatencyStats(questionIds, testId, exposureWindowStart),
      ]);
    } catch (error) {
      logger.warn("PRD-55: экспозиция и время заданий не прочитаны — " + (error as Error).message);
    }


    /**
     * PRD-56 FR-15: доля ПРОПУСКОВ — выданных заданий, оставшихся без ответа.
     *
     * Считается по веб-попыткам: у них известен и состав выдачи (`variantJson`), и ответы.
     * Пакет состава по попытке не сообщает — он шлёт выданный набор в счётчик экспозиции
     * (PRD-55), а тот агрегирован по месяцам и с ответами построчно не сопоставляется.
     * Поэтому у теста, который проходят только в LMS, доли пропусков нет, и это честнее
     * числа, собранного из двух разных окон.
     */
    const deliveredWeb = new Map<string, number>();
    const skippedWeb = new Map<string, number>();
    for (const attempt of completedAttempts) {
      const answers = (attempt.answersJson ?? {}) as Record<string, unknown>;
      for (const questionId of variantQuestionIds(attempt.variantJson)) {
        deliveredWeb.set(questionId, (deliveredWeb.get(questionId) ?? 0) + 1);
        if (!(questionId in answers)) {
          skippedWeb.set(questionId, (skippedWeb.get(questionId) ?? 0) + 1);
        }
      }
    }

    const questionStats = Array.from(questionStatsMap.values()).map(qs => {
      const exposureCount = exposureOwn.get(qs.questionId) ?? 0;
      const lat = latency.get(qs.questionId);
      const delivered = deliveredWeb.get(qs.questionId) ?? 0;
      const skipped = skippedWeb.get(qs.questionId) ?? 0;
      const exposurePercent =
        attemptsInWindow > 0 && exposureCount > 0 ? (exposureCount / attemptsInWindow) * 100 : null;

      return {
        ...qs,
        exposureCount,
        exposurePercent,
        globalExposureCount: exposureGlobal.get(qs.questionId) ?? 0,
        otherTestsCount: otherTests.get(qs.questionId) ?? 0,
        // Своя выборка: веб времени не измеряет, пакеты старше 2026-09-12 его не сообщают.
        latencyMedianMs: lat ? lat.medianMs : null,
        latencySampleSize: lat ? lat.sampleSize : 0,
        deliveredWeb: delivered,
        skippedWeb: skipped,
        skipShare: delivered > 0 ? (skipped / delivered) * 100 : null,
        // FR-16: признаки ревизии считает сервис — вид «требуют ревизии» это отбор по ним,
        // а не собственное правило экрана.
        reviewFlags: reviewFlags({
          questionId: qs.questionId,
          gradedAnswers: qs.gradedAnswers,
          correctPercent: qs.correctPercent,
          exposurePercent,
          latencyMedianMs: lat ? lat.medianMs : null,
          latencySampleSize: lat ? lat.sampleSize : 0,
        }, { minObservations: config.analytics.minObservations }),
      };
      // Первыми — самые трудные; вопросы без оценивания (измерительные) уходят в конец:
      // сортировать их вместе с долей верных не по чему, доли у них нет.
    }).sort((a, b) => (a.correctPercent ?? Infinity) - (b.correctPercent ?? Infinity));

    // Level stats (adaptive)
    interface LevelStatsEntry {
      levelIndex: number;
      levelName: string;
      topicId: string;
      topicName: string;
      achievedCount: number;
      attemptedCount: number;
      passedCount: number;
      failedCount: number;
      totalCorrect: number;
      totalAnswered: number;
    }

    let levelStats: Array<LevelStatsEntry & { avgCorrectPercent: number }> = [];

    if (test.mode === "adaptive") {
      const levelStatsMap = new Map<string, LevelStatsEntry>();

      for (const attempt of completedAttempts) {
        const result = attempt.resultJson as any;
        if (!result?.topicResults) continue;

        for (const tr of result.topicResults) {
          if (tr.achievedLevelIndex !== undefined && tr.achievedLevelIndex !== null) {
            const key = `${tr.topicId}-${tr.achievedLevelIndex}`;
            const existing = levelStatsMap.get(key) || {
              levelIndex: tr.achievedLevelIndex,
              levelName: tr.achievedLevelName || `Level ${tr.achievedLevelIndex}`,
              topicId: tr.topicId,
              topicName: tr.topicName,
              achievedCount: 0,
              attemptedCount: 0,
              passedCount: 0,
              failedCount: 0,
              totalCorrect: 0,
              totalAnswered: 0,
            };
            existing.achievedCount++;
            levelStatsMap.set(key, existing);
          }

          for (const la of tr.levelsAttempted || []) {
            const key = `${tr.topicId}-${la.levelIndex}`;
            const existing = levelStatsMap.get(key) || {
              levelIndex: la.levelIndex,
              levelName: la.levelName,
              topicId: tr.topicId,
              topicName: tr.topicName,
              achievedCount: 0,
              attemptedCount: 0,
              passedCount: 0,
              failedCount: 0,
              totalCorrect: 0,
              totalAnswered: 0,
            };

            existing.attemptedCount++;
            existing.totalCorrect += la.correctCount || 0;
            existing.totalAnswered += la.questionsAnswered || 0;

            if (la.status === "passed") existing.passedCount++;
            else if (la.status === "failed") existing.failedCount++;

            levelStatsMap.set(key, existing);
          }
        }
      }

      levelStats = Array.from(levelStatsMap.values()).map(ls => ({
        ...ls,
        avgCorrectPercent: ls.totalAnswered > 0 ? (ls.totalCorrect / ls.totalAnswered) * 100 : 0,
      })).sort((a, b) => {
        if (a.topicId !== b.topicId) return a.topicId.localeCompare(b.topicId);
        return a.levelIndex - b.levelIndex;
      });
    }

    /**
     * PRD-56 FR-13a: корзины одной ширины, цвет — от проходного балла.
     *
     * Считается по тем же наблюдениям, что и плитки: иначе экран противоречит сам себе —
     * «18 прохождений» сверху и гистограмма по пятнадцати веб-попыткам. Прохождения без
     * результата в корзины не попадают: у них нет процента, а не ноль.
     */
    const percents = observations.rows
      .map(observation => observation.percent)
      .filter((percent): percent is number => percent !== null);
    const scoreDistribution = scoreBuckets(
      percents,
      thresholdPercentOfTest(test),
    );

    /**
     * PRD-56 FR-13: динамика сдаваемости ПО МЕСЯЦАМ.
     *
     * Дневная линия за тридцать дней, которая была здесь, для теста нечитаема: прохождения
     * идут волнами по назначениям, и график превращался в частокол из единиц. Месяц — та
     * единица, в которой об обучении и говорят.
     */
    const passTrend = passTrendByMonth(observations.rows);

    res.json({
      testId: test.id,
      testTitle: test.title,
      testMode: test.mode,
      // The test's half of the PRD-29 §6.7 rule (see `summary` above).
      hasPassThreshold: thresholdDeclared,
      summary,
      topicStats,
      questionStats,
      // PRD-55 (FR-31): знаменатель доли выдачи. Отдаётся явно, потому что он НЕ равен ни одному
      // числу сводки: это попытки за окно наблюдения, считая брошенные, — а сводка показывает
      // завершённые. Считая его на клиенте по сводке, экран подписал бы «выдано 3 из 2».
      exposureAttempts: attemptsInWindow,
      levelStats: test.mode === "adaptive" ? levelStats : undefined,
      scoreDistribution,
      passTrend,
    });

  } catch (error) {
    logger.error("Test analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch test analytics" });
  }
});

export default router;