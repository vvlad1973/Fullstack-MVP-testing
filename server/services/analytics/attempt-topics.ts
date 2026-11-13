/**
 * @module server/services/analytics/attempt-topics
 * @description Результат ОДНОГО прохождения по каждой теме — баллы, процент и итог «пройдена /
 * не пройдена» для книги выгрузки аналитики.
 *
 * Источники отвечают на этот вопрос по-разному:
 *
 * - веб-попытка хранит итог по темам в своём результате (`topicResults`) — ровно то, что участник
 *   видел в отчёте, поэтому он берётся как есть ({@link webAttemptTopics});
 * - прохождение LMS (телеметрия и импорт выгрузки) итога по темам не хранит: пакет сообщает его
 *   LMS целями (`cmi.objectives`), а в выгрузку отчёта они не попадают. Итог восстанавливается из
 *   ответов ({@link lmsAttemptTopics}) по цене задания в тесте и порогу темы — тем же
 *   `checkPassRule`, которым судит пакет и веб.
 *
 * Баллы LMS-ответа приводятся к цене задания в тесте: импорт пишет в `points` долю цены (0..1),
 * телеметрия — баллы пакета, а итог темы обязан быть в одних единицах с её порогом.
 */

import { checkPassRule, type ResolvedRule } from "@shared/scoring/pass-rule";

import type { AnswerFact } from "./answers";

/** Итог прохождения по одной теме. */
export interface AttemptTopicResult {
  /** Набранные баллы. */
  earned: number;
  /** Достижимые баллы. */
  possible: number;
  /** Доля набранных от достижимых, %; `null` — оценивать в теме было нечего. */
  percent: number | null;
  /** Итог по порогу темы; `null` — порога нет или оценивать было нечего. */
  passed: boolean | null;
}

/** Тема в сохранённом результате веб-попытки — поля, которые читает книга. */
interface StoredTopicResult {
  topicId?: string;
  earnedPoints?: number | null;
  possiblePoints?: number | null;
  passed?: boolean | null;
}

/** Накопитель темы до свёртки в итог. */
interface TopicAccumulator {
  earned: number;
  possible: number;
  /** Итоги разделов темы; тема бывает в тесте дважды только у старых данных. */
  verdicts: Array<boolean | null>;
}

/** Процент набранного или `null`, когда достижимых баллов нет. */
function percentOf(earned: number, possible: number): number | null {
  return possible > 0 ? (earned / possible) * 100 : null;
}

/**
 * Итог по темам веб-попытки — из её сохранённого результата.
 *
 * Тема, встреченная в результате дважды, складывается: баллы суммируются, итог «пройдена» —
 * только если пройдены все её части, у которых итог вообще вынесен.
 *
 * @param resultJson сохранённый результат попытки (`attempts.result_json`)
 * @returns итог по идентификатору темы; пустая карта, когда результата нет
 */
export function webAttemptTopics(resultJson: unknown): Map<string, AttemptTopicResult> {
  const topics = (resultJson as { topicResults?: StoredTopicResult[] } | null)?.topicResults;
  const acc = new Map<string, TopicAccumulator>();
  for (const topic of Array.isArray(topics) ? topics : []) {
    if (!topic?.topicId) continue;
    const entry = acc.get(topic.topicId) ?? { earned: 0, possible: 0, verdicts: [] };
    entry.earned += Number(topic.earnedPoints) || 0;
    entry.possible += Number(topic.possiblePoints) || 0;
    entry.verdicts.push(typeof topic.passed === "boolean" ? topic.passed : null);
    acc.set(topic.topicId, entry);
  }

  const out = new Map<string, AttemptTopicResult>();
  for (const [topicId, entry] of acc) {
    const percent = percentOf(entry.earned, entry.possible);
    const judged = entry.verdicts.filter((v): v is boolean => v !== null);
    out.set(topicId, {
      earned: entry.earned,
      possible: entry.possible,
      percent,
      passed: percent === null || judged.length === 0 ? null : judged.every(Boolean),
    });
  }
  return out;
}

/** Что нужно, чтобы восстановить итог по темам прохождения LMS. */
export interface LmsTopicInput {
  /** Ответы ЭТОГО прохождения. */
  facts: readonly AnswerFact[];
  /**
   * Выданный состав прохождения; `null` — не известен (телеметрия его не хранит). Выданное, но
   * не отвеченное оцениваемое задание в ответы не попадает, а достижимые баллы темы — несёт.
   */
  delivered: readonly string[] | null;
  /** Тема задания; `null` — задания нет в базе. */
  topicOf: (questionId: string) => string | null;
  /** Цена задания в тесте; `null` — задание не оценивается (измерительное) или неизвестно. */
  priceOf: (questionId: string) => number | null;
  /** Порог темы этого прохождения; `null` — порога нет. */
  ruleOf: (topicId: string) => ResolvedRule | null;
}

/**
 * Доля цены, которую принёс ответ LMS.
 *
 * Баллы ответа — доля от его максимума; без максимума остаётся исход «верно / неверно».
 */
function shareOf(fact: AnswerFact): number {
  if (fact.possiblePoints !== null && fact.possiblePoints > 0 && fact.earnedPoints !== null) {
    return fact.earnedPoints / fact.possiblePoints;
  }
  return fact.result === "correct" ? 1 : 0;
}

/**
 * Итог по темам прохождения LMS — из его ответов.
 *
 * Измерительные ответы (`neutral`) и задания без цены в баллы не идут. Повторный ответ на то же
 * задание заменяет прежний: в теме задание стоит один раз.
 *
 * @param input ответы, выдача и справочники теста
 * @returns итог по идентификатору темы; тема без единого оцениваемого задания — с `percent: null`
 */
export function lmsAttemptTopics(input: LmsTopicInput): Map<string, AttemptTopicResult> {
  const byQuestion = new Map<string, AnswerFact>();
  for (const fact of input.facts) byQuestion.set(fact.questionId, fact);

  const acc = new Map<string, { earned: number; possible: number }>();
  const addTo = (topicId: string, earned: number, possible: number) => {
    const entry = acc.get(topicId) ?? { earned: 0, possible: 0 };
    entry.earned += earned;
    entry.possible += possible;
    acc.set(topicId, entry);
  };

  for (const [questionId, fact] of byQuestion) {
    const topicId = input.topicOf(questionId);
    if (!topicId) continue;
    const price = fact.result === "neutral" ? null : input.priceOf(questionId);
    if (price === null) {
      addTo(topicId, 0, 0);
      continue;
    }
    addTo(topicId, shareOf(fact) * price, price);
  }

  for (const questionId of new Set(input.delivered ?? [])) {
    if (byQuestion.has(questionId)) continue;
    const topicId = input.topicOf(questionId);
    if (!topicId) continue;
    addTo(topicId, 0, input.priceOf(questionId) ?? 0);
  }

  const out = new Map<string, AttemptTopicResult>();
  for (const [topicId, entry] of acc) {
    const percent = percentOf(entry.earned, entry.possible);
    const rule = input.ruleOf(topicId);
    out.set(topicId, {
      earned: entry.earned,
      possible: entry.possible,
      percent,
      passed: percent === null || rule === null ? null : checkPassRule(rule, percent, entry.earned),
    });
  }
  return out;
}
