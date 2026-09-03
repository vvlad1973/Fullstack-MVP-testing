/**
 * @module shared/breakdown/feedback
 * @description PRD-50 FR-50: какие тексты подтем получает обучающийся.
 *
 * У подтемы (тега вопросов) НЕТ собственного вердикта — его сняли решением владельца
 * 2026-09-03: подтема считается и показывается, но не судится. Поэтому текст подтемы
 * выдаётся по ЕДИНСТВЕННОМУ правилу, назначенному владельцем в тот же день:
 *
 *   результат по подтеме НИЖЕ общего проходного порога теста -> текст выдаётся,
 *   при ЛЮБОМ вердикте теста и темы.
 *
 * «При любом вердикте» — часть правила, а не упрощение: провал по подтеме внутри сданного
 * теста и есть тот случай, ради которого текст пишут. Обратная связь ТЕМЫ так себя не
 * ведёт (её гасит пройденная тема), и это сознательное расхождение: тема судится, подтема
 * нет.
 *
 * Модуль чистый: ни DOM, ни Node. Оба хоста — веб и рантайм пакета — зовут одну эту
 * функцию, иначе экран и пакет разошлись бы в том, что человек прочитал.
 */

import type { BreakdownEntry } from "./types";

/**
 * Раздел глазами отбора: его подытоги и тексты его подтем.
 *
 * Тип блока — параметр, а не своя структура: собирает тексты `collectRecommendations`,
 * и объявить здесь ПОХОЖУЮ форму значило бы завести вторую правду о том, что такое
 * обратная связь. Модуль про отбор, а не про содержимое.
 */
export interface BreakdownFeedbackTopic<T> {
  breakdown?: BreakdownEntry[] | null;
  /** Ключ подтемы -> её текст (`test_sections.breakdown_feedback_json`). */
  breakdownFeedback?: Record<string, T> | null;
}

/**
 * Общий проходной порог теста, приведённый к процентам.
 *
 * Правило владельца названо в процентах («результат по тегу ниже проходного порога»), а
 * порог теста бывает и суммой баллов. Абсолютный переводится в долю от достижимого:
 * иначе тест, у которого порог задан баллами, молча остался бы без текстов подтем —
 * настройка, которая ничего не делает, хуже, чем приблизительный перевод.
 *
 * `null` значит «порога нет»: тест ничего не судит, сравнивать не с чем. Тогда условия
 * нет вовсе и текст выдаётся везде, где автор его написал, — потерять написанное хуже,
 * чем показать лишний раз (то же правило, что у обратной связи темы без вердикта).
 */
export function passThresholdPercent(
  rule: { type?: string | null; value?: number | null } | null | undefined,
  possiblePoints: number | null | undefined,
): number | null {
  if (!rule || !rule.type || rule.type === "none") return null;
  const value = Number(rule.value);
  if (!Number.isFinite(value)) return null;
  if (rule.type === "percent") return value;
  const possible = Number(possiblePoints);
  if (!Number.isFinite(possible) || possible <= 0) return null;
  return (value / possible) * 100;
}

/**
 * Тексты подтем, которые обучающийся должен прочитать, в порядке разделов и подытогов.
 *
 * Сравнивается доля БАЛЛОВ подтемы (`percentPoints`), а не доля вопросов: порог теста —
 * про баллы, и сравнивать его с долей вопросов значило бы сопоставлять разные величины.
 * Показ подытогов («доля вопросов» или «доля баллов») на это не влияет: он решает, какое
 * число НАПЕЧАТАТЬ, а не по какому судить.
 *
 * Подтема, которой выдача не дала ни одного вопроса, в подытогах не появляется — значит,
 * и текста не даёт: рекомендация по неспрошенному ни на чём не основана.
 */
export function collectBreakdownFeedback<T>(
  topics: ReadonlyArray<BreakdownFeedbackTopic<T>>,
  thresholdPercent: number | null | undefined,
): T[] {
  const out: T[] = [];
  const threshold = typeof thresholdPercent === "number" && Number.isFinite(thresholdPercent)
    ? thresholdPercent
    : null;
  for (const topic of topics) {
    const texts = topic.breakdownFeedback;
    if (!texts) continue;
    for (const entry of topic.breakdown ?? []) {
      const block = texts[entry.key];
      if (!block) continue;
      if (threshold !== null && entry.percentPoints >= threshold) continue;
      out.push(block);
    }
  }
  return out;
}
