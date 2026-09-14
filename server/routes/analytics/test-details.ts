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
import { loadObservations } from "../../services/analytics/observations";
import { summariseObservations } from "../../services/analytics/test-summary";
import { declaresPassThreshold, gradingOf } from "./helpers";

const router = Router();

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

    // Topic stats
    interface TopicStatsEntry {
      topicId: string;
      topicName: string;
      totalAnswers: number;
      correctAnswers: number;
      earnedPoints: number;
      possiblePoints: number;
      passedCount: number;
      failedCount: number;
    }

    const topicStatsMap = new Map<string, TopicStatsEntry>();

    for (const attempt of completedAttempts) {
      const result = attempt.resultJson as any;
      if (!result?.topicResults) continue;

      for (const tr of result.topicResults) {
        const existing = topicStatsMap.get(tr.topicId) || {
          topicId: tr.topicId,
          topicName: tr.topicName,
          totalAnswers: 0,
          correctAnswers: 0,
          earnedPoints: 0,
          possiblePoints: 0,
          passedCount: 0,
          failedCount: 0,
        };

        existing.totalAnswers += tr.total || tr.totalQuestionsAnswered || 0;
        existing.correctAnswers += tr.correct || tr.totalCorrect || 0;
        existing.earnedPoints += tr.earnedPoints || 0;
        existing.possiblePoints += tr.possiblePoints || 0;

        if (tr.passed === true || (tr.achievedLevelIndex !== undefined && tr.achievedLevelIndex !== null)) {
          existing.passedCount++;
        } else if (tr.passed === false || tr.achievedLevelIndex === null) {
          existing.failedCount++;
        }

        topicStatsMap.set(tr.topicId, existing);
      }
    }

    const topicStats = Array.from(topicStatsMap.values()).map(ts => ({
      topicId: ts.topicId,
      topicName: ts.topicName,
      totalAnswers: ts.totalAnswers,
      correctAnswers: ts.correctAnswers,
      avgPercent: ts.possiblePoints > 0 ? (ts.earnedPoints / ts.possiblePoints) * 100 : 0,
      passRate: (ts.passedCount + ts.failedCount) > 0
        ? (ts.passedCount / (ts.passedCount + ts.failedCount)) * 100
        : null,
    }));

    // Question stats
    const allQuestionIds = new Set<string>();
    for (const attempt of testAttempts) {
      const variant = attempt.variantJson as any;
      if (variant?.sections) {
        for (const section of variant.sections) {
          for (const qId of section.questionIds || []) {
            allQuestionIds.add(qId);
          }
        }
      }
      if (variant?.topics) {
        for (const topic of variant.topics) {
          for (const level of topic.levelsState || []) {
            for (const qId of level.questionIds || []) {
              allQuestionIds.add(qId);
            }
          }
        }
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
        if (question.type === "scale" || question.type === "allocation") return "neutral";
        return checkAnswer(question, answer, scoring.resolve(question).scoring) === 1
          ? "correct"
          : "incorrect";
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


    const questionStats = Array.from(questionStatsMap.values()).map(qs => {
      const exposureCount = exposureOwn.get(qs.questionId) ?? 0;
      const lat = latency.get(qs.questionId);
      return {
        ...qs,
        exposureCount,
        exposurePercent:
          attemptsInWindow > 0 && exposureCount > 0 ? (exposureCount / attemptsInWindow) * 100 : null,
        globalExposureCount: exposureGlobal.get(qs.questionId) ?? 0,
        otherTestsCount: otherTests.get(qs.questionId) ?? 0,
        // Своя выборка: веб времени не измеряет, пакеты старше 2026-09-12 его не сообщают.
        latencyMedianMs: lat ? lat.medianMs : null,
        latencySampleSize: lat ? lat.sampleSize : 0,
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

    // Score distribution
    const scoreRanges = [
      { range: "0-10", min: 0, max: 10, count: 0 },
      { range: "11-20", min: 11, max: 20, count: 0 },
      { range: "21-30", min: 21, max: 30, count: 0 },
      { range: "31-40", min: 31, max: 40, count: 0 },
      { range: "41-50", min: 41, max: 50, count: 0 },
      { range: "51-60", min: 51, max: 60, count: 0 },
      { range: "61-70", min: 61, max: 70, count: 0 },
      { range: "71-80", min: 71, max: 80, count: 0 },
      { range: "81-90", min: 81, max: 90, count: 0 },
      { range: "91-100", min: 91, max: 100, count: 0 },
    ];

    // PRD-56 FR-33: распределение строится по тем же наблюдениям, что и плитки. Иначе экран
    // противоречит сам себе: «18 прохождений» сверху и гистограмма по пятнадцати веб-попыткам.
    // Прохождения без результата в корзины не попадают: у них нет процента, а не ноль.
    for (const observation of observations.rows) {
      if (observation.percent === null) continue;
      for (const range of scoreRanges) {
        if (observation.percent >= range.min && observation.percent <= range.max) {
          range.count++;
          break;
        }
      }
    }

    const scoreDistribution = scoreRanges.map(r => ({ range: r.range, count: r.count }));

    // Daily trends
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const dailyMap = new Map<string, { date: string; attempts: number; totalPercent: number; passed: number }>();

    for (const observation of observations.rows) {
      if (!observation.finishedAt) continue;
      const finishedDate = new Date(observation.finishedAt);
      if (finishedDate < thirtyDaysAgo) continue;

      const dateStr = finishedDate.toISOString().split("T")[0];
      const existing = dailyMap.get(dateStr) || { date: dateStr, attempts: 0, totalPercent: 0, passed: 0 };
      existing.attempts++;
      existing.totalPercent += observation.percent ?? 0;
      if (observation.passed) existing.passed++;
      dailyMap.set(dateStr, existing);
    }

    const dailyTrends = Array.from(dailyMap.values())
      .map(d => ({
        date: d.date,
        attempts: d.attempts,
        avgPercent: d.attempts > 0 ? d.totalPercent / d.attempts : 0,
        passRate: d.attempts > 0 ? (d.passed / d.attempts) * 100 : 0,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

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
      dailyTrends,
    });

  } catch (error) {
    logger.error("Test analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to fetch test analytics" });
  }
});

export default router;