/**
 * @module server/services/analytics/psychometrics
 * @description PRD-66: сведение матрицы наблюдений и расчётного движка.
 *
 * Разделение ответственности здесь намеренное и жёсткое. `response-matrix` знает, ГДЕ взять
 * наблюдения; `shared/psychometrics` знает, КАК считать; этот модуль — что с чем сопоставить:
 * какому заданию сколько вариантов, какой порог применить к какому числу, что показывать, а
 * что скрыть за недостатком данных. Считать он не умеет ничего, и это проверяется тем, что ни
 * одной формулы в нём нет.
 *
 * Функция чистая: наблюдения и справочники приходят готовыми. Поэтому она проверяется без базы
 * — на матрице, собранной руками, где каждое число известно заранее.
 */

import { isSingleIndexChoice } from "@shared/questions/question-type";
import {
  abilities,
  difficulty as difficultyOf,
  discriminationIndex,
  guessingCorrectedDifficulty,
  itemRestCorrelation,
  type ItemResponse,
} from "@shared/psychometrics/item-metrics";
import {
  alphaOf,
  cutScoreBand,
  standardErrorOfMeasurement,
  type CutScoreBand,
  type ItemValue,
  type Reliability,
  type ReliabilityGap,
} from "@shared/psychometrics/reliability";
import {
  coefficientConfidence,
  descriptiveConfidence,
  type ConfidenceLevel,
} from "@shared/psychometrics/confidence";
import {
  rushedShare,
  summariseTiming,
  timingFlags,
  type TimingFlags,
  type TimingSummary,
} from "@shared/psychometrics/timing";

import type { ResponseFact } from "./response-matrix";

/** Что известно о задании помимо наблюдений за ним. */
export interface QuestionInfo {
  id: string;
  type: string;
  prompt: string;
  dataJson: unknown;
  /** Трудность, заявленная автором (PRD-16, необязательна); `null` — сравнивать не с чем. */
  difficulty: number | null;
}

/** Условия, в которых считается психометрика. */
export interface PsychometricsContext {
  questionById: ReadonlyMap<string, QuestionInfo>;
  /** Порог описательных величин инстанса (`analytics.minObservations`). */
  minObservations: number;
  /** Проходной балл теста в долях, если он объявлен: по нему строится интервал у порога. */
  cutRatio?: number | null;
}

/** Психометрика ОДНОГО задания. */
export interface ItemPsychometrics {
  questionId: string;
  /** Наблюдений, где задание было выдано и оценено. */
  observations: number;
  difficulty: number | null;
  /** Трудность с поправкой на угадывание; `null` — к этому типу неприменима (FR-17a). */
  correctedDifficulty: number | null;
  /** Корреляция задание-остаток. */
  itemRest: number | null;
  /** Индекс крайних групп `D`. */
  discrimination: number | null;
  timing: TimingSummary | null;
  timingFlags: TimingFlags;
  /** Уровни доверия — РАЗНЫЕ у описательных величин и коэффициентов (FR-04, FR-38a). */
  difficultyConfidence: ConfidenceLevel;
  coefficientConfidence: ConfidenceLevel;
  flags: ItemFlags;
  /** Заявленная автором трудность рядом с наблюдаемой (FR-18). */
  declaredDifficulty: number | null;
}

/** Признаки задания — симптомы, названные числами, а не приговор (FR-50). */
export interface ItemFlags {
  /** `p < 0.2`: задание проходит почти никто. */
  tooHard: boolean;
  /** `p > 0.9`: задание проходят все — оно почти ничего не измеряет. */
  tooEasy: boolean;
  /** `r < 0` или `D < 0`: сильные ошибаются чаще слабых. Красный флаг первого приоритета. */
  negativeDiscrimination: boolean;
  /** Скорректированная трудность на уровне случайного попадания. */
  atChanceLevel: boolean;
}

/** Психометрика теста целиком. */
export interface TestPsychometrics {
  items: ItemPsychometrics[];
  /** Коэффициент надёжности либо причина, по которой его нет. */
  reliability: Reliability | ReliabilityGap;
  /** Ошибка измерения в долях балла; `null` — надёжность не посчиталась. */
  sem: number | null;
  /** Интервал вокруг проходного балла; `null` — порога нет либо ошибка не посчиталась. */
  cutBand: CutScoreBand | null;
  sample: {
    /** Респондентов в выборке. */
    respondents: number;
    /** Наблюдений за ответами. */
    responses: number;
    /** Сколько наблюдений пришло из каждого источника — на чём стоят числа (FR-42). */
    bySource: Record<string, number>;
    /** Доля наблюдений с неизвестной редакцией задания (FR-09c): мера огрубления серий. */
    unknownVersionShare: number;
  };
}

/** Пороги признаков трудности — из FR-13. */
const TOO_HARD = 0.2;
const TOO_EASY = 0.9;

/** Сколько вариантов у задания: по ним считается вероятность случайного попадания. */
function optionCountOf(question: QuestionInfo | undefined): number {
  const options = (question?.dataJson as { options?: unknown[] } | null)?.options;
  return Array.isArray(options) ? options.length : 0;
}

/**
 * Оставить по одному наблюдению на респондента — первое по времени (FR-51).
 *
 * Повторные попытки одного человека не независимы: он помнит задания, и вторая попытка говорит
 * о памяти не меньше, чем о способности. Умолчание — «только первая»; выключение переключателя
 * на экране сопровождается предупреждением, и это решение читателя, а не расчёта.
 */
export function firstAttemptOnly(responses: readonly ResponseFact[]): ResponseFact[] {
  const firstByRespondent = new Map<string, { observationId: string; at: number }>();
  for (const response of responses) {
    if (!response.respondentId) continue;
    const seen = firstByRespondent.get(response.respondentId);
    const at = response.occurredAt.getTime();
    if (!seen || at < seen.at) firstByRespondent.set(response.respondentId, { observationId: response.observationId, at });
  }
  return responses.filter(r =>
    r.respondentId !== null
    && firstByRespondent.get(r.respondentId)?.observationId === r.observationId);
}

/**
 * Посчитать психометрику по наблюдениям.
 *
 * @param responses наблюдения за ответами — уже отобранные фильтром экрана
 * @param ctx справочник заданий и пороги
 */
export function computePsychometrics(
  responses: readonly ResponseFact[],
  ctx: PsychometricsContext,
): TestPsychometrics {
  // В расчёт идут только опознанные респонденты: без ключа человека нельзя ни построить
  // способность, ни отличить его вторую попытку от чужой первой.
  const identified = responses.filter(r => r.respondentId !== null);

  const graded: ItemResponse[] = identified.map(r => ({
    respondentId: r.respondentId!,
    itemId: r.questionId,
    ratio: r.scoreRatio,
  }));
  const ability = abilities(graded);

  const byItem = new Map<string, ResponseFact[]>();
  for (const response of identified) {
    const list = byItem.get(response.questionId);
    if (list) list.push(response);
    else byItem.set(response.questionId, [response]);
  }

  // Медиана времени ПО ТЕСТУ — та величина, относительно которой задание считается тормозящим.
  const testTiming = summariseTiming(identified.map(r => r.latencyMs));

  const items: ItemPsychometrics[] = [];
  for (const [questionId, facts] of byItem) {
    const question = ctx.questionById.get(questionId);
    const scored = facts.filter(f => f.scoreRatio !== null);
    const observations = scored.length;

    const p = difficultyOf(scored.map(f => ({
      respondentId: f.respondentId!,
      itemId: questionId,
      ratio: f.scoreRatio,
    })));
    // Поправка считается ТОЛЬКО у заданий с одним верным ответом из перечисленных вариантов:
    // у остальных типов вероятность случайного попадания невычислима, и пустое место там
    // честнее нуля (FR-17a).
    const corrected = question && isSingleIndexChoice(question.type)
      ? guessingCorrectedDifficulty(p, optionCountOf(question))
      : null;

    const itemRest = itemRestCorrelation(questionId, graded);
    const groups = discriminationIndex(questionId, graded, ability);
    const timing = summariseTiming(facts.map(f => f.latencyMs));
    const rushed = rushedShare(facts.map(f => f.latencyMs), question?.prompt.length ?? 0);

    items.push({
      questionId,
      observations,
      difficulty: p,
      correctedDifficulty: corrected,
      itemRest,
      discrimination: groups?.index ?? null,
      timing,
      timingFlags: timingFlags(timing, rushed, testTiming?.medianMs ?? null, p),
      difficultyConfidence: descriptiveConfidence(observations, ctx.minObservations),
      coefficientConfidence: coefficientConfidence(observations),
      declaredDifficulty: question?.difficulty ?? null,
      flags: {
        tooHard: p !== null && p < TOO_HARD,
        tooEasy: p !== null && p > TOO_EASY,
        // Достаточно ОДНОГО из двух показателей: они считаются по-разному и ловят разное, а
        // симптом у них один — сильные ошибаются чаще слабых (FR-16).
        negativeDiscrimination: (itemRest !== null && itemRest < 0)
          || (groups !== null && groups.index < 0),
        atChanceLevel: corrected !== null && corrected <= 0,
      },
    });
  }

  const values: ItemValue[] = graded
    .filter(r => r.ratio !== null)
    .map(r => ({ respondentId: r.respondentId, itemId: r.itemId, value: r.ratio! }));
  const reliability = alphaOf(values);
  const sem = typeof reliability === "string"
    ? null
    : standardErrorOfMeasurement(reliability.totalSd, reliability.alpha);

  const bySource: Record<string, number> = {};
  for (const response of identified) bySource[response.source] = (bySource[response.source] ?? 0) + 1;

  return {
    items: items.sort((a, b) => a.questionId.localeCompare(b.questionId)),
    reliability,
    sem,
    // Порог переводится в ту же единицу, что и суммарный балл расчёта: сумма долей баллов по
    // пунктам. Сравнивать интервал в долях с порогом в процентах — ошибка на два порядка.
    cutBand: sem !== null && ctx.cutRatio !== null && ctx.cutRatio !== undefined && typeof reliability !== "string"
      ? cutScoreBand(ctx.cutRatio * reliability.items, sem)
      : null,
    sample: {
      respondents: ability.size,
      responses: identified.length,
      bySource,
      unknownVersionShare: identified.length === 0
        ? 0
        : identified.filter(r => r.psychoHash === null).length / identified.length,
    },
  };
}
