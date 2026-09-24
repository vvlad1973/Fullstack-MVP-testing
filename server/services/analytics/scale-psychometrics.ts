/**
 * @module server/services/analytics/scale-psychometrics
 * @description PRD-66 FR-29 — FR-32: психометрика измерительных ШКАЛ.
 *
 * У заданий без эталона нет ни трудности, ни дискриминации: проверять нечего, и единица
 * анализа для них — шкала PRD-5, а не тест. Пункты шкалы считаются согласованными между собой,
 * а не верными или неверными.
 *
 * ЗНАЧЕНИЕ ПУНКТА — ВКЛАД ОТВЕТА В ШКАЛУ со знаком и весом (FR-19a), а не номер выбранной
 * градации. Вклад считает тот же движок, что и результат участника
 * (`shared/scales/engine`): второй способ его вычисления развёл бы психометрику с тем, что
 * участник видел в своём отчёте.
 *
 * Отсюда же вычислимость вопроса «а что, если вклад перевернуть» (FR-31b): знак меняется,
 * наблюдения остаются те же, и подпись даёт проверяемое следствие вместо догадки о причине.
 */

import { computeAnswerContributions, type Answer, type MeasurementSpec } from "@shared/scales/engine";
import type { QuestionType } from "@shared/questions/question-type";
import { itemRestCorrelation, type ItemResponse } from "@shared/psychometrics/item-metrics";
import { alphaOf, type Reliability, type ReliabilityGap } from "@shared/psychometrics/reliability";
import {
  alphaIfMirrored,
  gradeDistribution,
  isDeadItem,
  looksIpsative,
  scaleValues,
  type ScaleResponse,
} from "@shared/psychometrics/scales";

import type { ResponseFact } from "./response-matrix";

/** Что известно о пункте шкалы помимо наблюдений за ним. */
export interface ScaleItemInfo {
  questionId: string;
  prompt: string;
  type: string;
  /** Подписи градаций ответа — их задаёт автор (PRD-26), и придумывать их нельзя. */
  gradeLabels: string[];
}

/** Условия расчёта по шкалам. */
export interface ScaleContext {
  /** Единицы измерения теста — те же, по которым считается результат участника. */
  measurements: MeasurementSpec[];
  /** Ключ шкалы -> её название на экране. */
  scaleLabels: ReadonlyMap<string, string>;
  itemById: ReadonlyMap<string, ScaleItemInfo>;
}

/** Пункт шкалы с его психометрикой. */
export interface ScaleItemPsychometrics {
  questionId: string;
  prompt: string;
  observations: number;
  /** Корреляция пункта с остатком СВОЕЙ шкалы; `null` — считать не на чем. */
  itemRest: number | null;
  /** Доли ответов по градациям — форма распределения (FR-30a). */
  distribution: number[];
  gradeLabels: string[];
  /** Пункт, где почти все ответили одинаково: он ничего не различает. */
  dead: boolean;
  /**
   * Пункт ведёт себя противоположно своей шкале (FR-31a).
   *
   * Причину признак НЕ называет: обратная формулировка с неперевёрнутым вкладом, пункт не из
   * этой шкалы, перепутанный знак и случайность на малой выборке дают одно и то же число.
   */
  againstScale: boolean;
  /**
   * Какой стала бы альфа шкалы с перевёрнутым вкладом этого пункта (FR-31b); `null` — пересчёт
   * невозможен. Это вычислимое следствие вместо догадки о причине.
   */
  alphaIfMirrored: number | null;
}

/** Психометрика одной шкалы. */
export interface ScalePsychometrics {
  scaleKey: string;
  label: string;
  /** Альфа по вносящим вклад пунктам либо причина, по которой её нет. */
  reliability: Reliability | ReliabilityGap;
  respondents: number;
  /**
   * Ипсативная методика: сумма вкладов респондента фиксирована по построению (FR-32).
   *
   * Вклады там связаны отрицательно не потому, что пункты плохи, а потому, что иначе не
   * бывает, — и альфа систематически занижена. Число выводится с оговоркой, а не как дефект.
   */
  ipsative: boolean;
  items: ScaleItemPsychometrics[];
}

/** Номер выбранной градации — по нему строится гистограмма распределения. */
function gradeOf(type: string, answer: unknown): number | null {
  // Шкала Ликерта (PRD-26) отвечает индексом градации; прочие типы гистограммы не имеют.
  if (type === "scale" && typeof answer === "number") return answer;
  if (type === "single" && typeof answer === "number") return answer;
  return null;
}

/**
 * Психометрика шкал теста.
 *
 * @param responses наблюдения выборки — те же, на которых считается всё остальное
 * @param ctx единицы измерения, названия шкал и справочник пунктов
 */
export function computeScalePsychometrics(
  responses: readonly ResponseFact[],
  ctx: ScaleContext,
): ScalePsychometrics[] {
  const identified = responses.filter(r => r.respondentId !== null);

  // Вклад ответа в каждую шкалу: одна единица измерения — одна запись, поэтому ответ с
  // несколькими выбранными вариантами законно двигает шкалу несколько раз.
  const byScale = new Map<string, ScaleResponse[]>();
  for (const response of identified) {
    const info = ctx.itemById.get(response.questionId);
    const contributions = computeAnswerContributions(
      ctx.measurements,
      response.questionId,
      response.answer as Answer,
      info?.type as QuestionType | undefined,
    );
    if (contributions.length === 0) continue;

    const summed = new Map<string, number>();
    for (const contribution of contributions) {
      summed.set(contribution.scaleKey, (summed.get(contribution.scaleKey) ?? 0) + contribution.delta);
    }

    for (const [scaleKey, value] of summed) {
      const list = byScale.get(scaleKey) ?? [];
      list.push({
        respondentId: response.respondentId!,
        itemId: response.questionId,
        grade: gradeOf(info?.type ?? "", response.answer) ?? -1,
        value,
      });
      byScale.set(scaleKey, list);
    }
  }

  const out: ScalePsychometrics[] = [];
  for (const [scaleKey, scaleResponses] of byScale) {
    const values = scaleValues(scaleResponses);
    const reliability = alphaOf(values);
    const baseAlpha = typeof reliability === "string" ? null : reliability.alpha;

    const itemIds = [...new Set(scaleResponses.map(r => r.itemId))];
    const forCorrelation: ItemResponse[] = scaleResponses.map(r => ({
      respondentId: r.respondentId,
      itemId: r.itemId,
      // Корреляция считается по ВКЛАДУ: он и есть значение пункта в этой шкале.
      ratio: r.value,
    }));

    const items: ScaleItemPsychometrics[] = itemIds.map(questionId => {
      const info = ctx.itemById.get(questionId);
      const own = scaleResponses.filter(r => r.itemId === questionId);
      const itemRest = itemRestCorrelation(questionId, forCorrelation);
      const distribution = gradeDistribution(own, info?.gradeLabels.length ?? 0);
      const mirrored = alphaIfMirrored(scaleResponses, questionId);

      return {
        questionId,
        prompt: info?.prompt ?? questionId,
        observations: own.length,
        itemRest,
        distribution,
        gradeLabels: info?.gradeLabels ?? [],
        dead: isDeadItem(distribution),
        againstScale: itemRest !== null && itemRest < 0,
        // Следствие показывается только там, где оно осмысленно: пункт, и так согласованный
        // со шкалой, переворачивать незачем, и число рядом с ним сбивало бы с толку.
        alphaIfMirrored: typeof mirrored === "string" || baseAlpha === null || itemRest === null || itemRest >= 0
          ? null
          : mirrored.alpha,
      };
    });

    out.push({
      scaleKey,
      label: ctx.scaleLabels.get(scaleKey) ?? scaleKey,
      reliability,
      respondents: new Set(scaleResponses.map(r => r.respondentId)).size,
      ipsative: looksIpsative(scaleResponses),
      items: items.sort((a, b) => a.questionId.localeCompare(b.questionId)),
    });
  }

  return out.sort((a, b) => a.label.localeCompare(b.label));
}
