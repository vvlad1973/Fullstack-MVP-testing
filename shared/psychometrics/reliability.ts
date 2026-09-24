/**
 * @module shared/psychometrics/reliability
 *
 * Надёжность ТЕСТА: альфа Кронбаха и KR-20, стандартная ошибка измерения, прогноз
 * Спирмена-Брауна (FR-19 — FR-23).
 *
 * Что означает альфа, одной фразой (FR-19c): она сравнивает разброс СУММЫ с разбросом
 * отдельных пунктов. Пункты, меряющие одно и то же, меняются согласованно — сумма разбрасывается
 * заметно сильнее, чем слагаемые по отдельности, и коэффициент растёт к единице; независимые
 * пункты гасят друг друга, и он падает к нулю.
 *
 * ```text
 * alpha = (k / (k - 1)) * (1 - sum(var_item) / var_total)
 * ```
 *
 * ЗНАЧЕНИЕ ПУНКТА, а не сырой ответ (FR-19a). Для теста это доля балла задания, для
 * измерительной шкалы — вклад ответа в шкалу со знаком и весом, а не номер выбранной градации.
 * Отсюда прямое следствие: альфа при ПЕРЕВЁРНУТОМ вкладе пункта вычислима (FR-31b) — меняется
 * знак значения, меняются ковариации, а наблюдения остаются те же.
 *
 * ТОЛЬКО ПОЛНЫЕ НАБОРЫ (FR-19b). Дисперсии слагаемых и дисперсия суммы обязаны быть посчитаны
 * на одной и той же выборке, иначе их отношение теряет смысл. Респондент, пропустивший пункт,
 * из расчёта выпадает целиком, и число включённых выводится рядом с коэффициентом — оно тем
 * меньше общего `n`, чем чаще пункты пропускали.
 */

import { standardDeviation, variance } from "./stats";

/** Значение одного пункта у одного респондента — вход расчёта надёжности. */
export interface ItemValue {
  respondentId: string;
  itemId: string;
  /** Значение пункта: доля балла задания либо вклад ответа в шкалу со знаком. */
  value: number;
}

/** Почему надёжность не посчиталась — на экране это разные сообщения, а не одно «нет данных». */
export type ReliabilityGap =
  /** Пунктов меньше двух: согласованность одного пункта с самим собой не определена. */
  | "too-few-items"
  /** Респондентов с полным набором меньше двух: разброса нет. */
  | "too-few-respondents"
  /** Разброс суммы нулевой: все набрали поровну, и сравнивать не с чем. */
  | "no-variance";

export interface Reliability {
  alpha: number;
  /** Пунктов в расчёте. */
  items: number;
  /**
   * Респондентов с ПОЛНЫМ набором пунктов — на них и посчитано (FR-19b).
   *
   * Выводится рядом с коэффициентом: расхождение с общим `n` выборки и есть мера того, как
   * часто пункты пропускали.
   */
  respondents: number;
  /** Стандартное отклонение суммарного балла — оно же основа ошибки измерения. */
  totalSd: number;
  /**
   * Строго дихотомический набор: каждый пункт принимает только 0 или 1.
   *
   * Тогда альфа В ТОЧНОСТИ равна KR-20 — это не другая формула, а её частный случай, и
   * считать её отдельно значило бы завести второй источник одного и того же числа.
   */
  dichotomous: boolean;
}

/**
 * Внутренняя согласованность набора пунктов.
 *
 * @param values значения пунктов по респондентам
 * @returns коэффициент с составом выборки либо причина, по которой его нет
 */
export function alphaOf(values: readonly ItemValue[]): Reliability | ReliabilityGap {
  const itemIds = [...new Set(values.map(v => v.itemId))];
  if (itemIds.length < 2) return "too-few-items";

  const byRespondent = new Map<string, Map<string, number>>();
  for (const entry of values) {
    let row = byRespondent.get(entry.respondentId);
    if (!row) {
      row = new Map<string, number>();
      byRespondent.set(entry.respondentId, row);
    }
    row.set(entry.itemId, entry.value);
  }

  // Полные наборы, и только они: неполный респондент попал бы в дисперсию одних пунктов и не
  // попал в дисперсию других, а отношение таких дисперсий не значит ничего.
  const complete = [...byRespondent.values()].filter(row => row.size === itemIds.length);
  if (complete.length < 2) return "too-few-respondents";

  let sumOfItemVariances = 0;
  for (const itemId of itemIds) {
    const column = complete.map(row => row.get(itemId)!);
    sumOfItemVariances += variance(column)!;
  }

  const totals = complete.map(row => itemIds.reduce((sum, itemId) => sum + row.get(itemId)!, 0));
  const totalVariance = variance(totals)!;
  // Все набрали поровну — сравнивать разбросы не с чем. Ноль здесь был бы не «низкой
  // надёжностью», а делением на ноль, выданным за факт.
  if (totalVariance === 0) return "no-variance";

  const k = itemIds.length;
  const alpha = (k / (k - 1)) * (1 - sumOfItemVariances / totalVariance);

  return {
    alpha,
    items: k,
    respondents: complete.length,
    totalSd: standardDeviation(totals)!,
    dichotomous: complete.every(row => [...row.values()].every(value => value === 0 || value === 1)),
  };
}

/**
 * Стандартная ошибка измерения (FR-21).
 *
 * ```text
 * SEM = SD_total * sqrt(1 - alpha)
 * ```
 *
 * Величина в баллах теста: насколько наблюдаемый балл участника может отличаться от его
 * «истинного». Она и решает, можно ли доверять вердикту у порога.
 */
export function standardErrorOfMeasurement(totalSd: number, alpha: number): number {
  // Альфа бывает и отрицательной (пункты гасят друг друга) — тогда под корнем больше единицы,
  // и ошибка ЗАКОННО превышает разброс: набор, где пункты противоречат друг другу, не измеряет
  // ничего, и притворяться, что ошибка мала, нельзя.
  return totalSd * Math.sqrt(Math.max(0, 1 - alpha));
}

/** Интервал вокруг порога и то, кого он фактически затронул (FR-21a). */
export interface CutScoreBand {
  /** Границы интервала в тех же единицах, что и порог. */
  low: number;
  high: number;
  /** Множитель ошибки: 1 — около 68 % случаев, 1,96 — около 95 %. */
  z: number;
}

/**
 * Интервал неопределённости вокруг проходного балла.
 *
 * Решение «сдал / не сдал» у участника, чей балл попал в этот интервал, ненадёжно: сдвиг
 * порога на величину ошибки измерения поменял бы вердикт. Это и есть та величина, ради которой
 * психометрику чаще всего и заводят.
 *
 * @param cut проходной балл
 * @param sem стандартная ошибка измерения
 * @param z множитель ошибки; по умолчанию 1,96 — около 95 % случаев
 */
export function cutScoreBand(cut: number, sem: number, z = 1.96): CutScoreBand {
  return { low: cut - z * sem, high: cut + z * sem, z };
}

/**
 * Прогноз Спирмена-Брауна (FR-22): во сколько раз удлинить тест ради целевой надёжности.
 *
 * ```text
 * factor = target * (1 - alpha) / (alpha * (1 - target))
 * ```
 *
 * `null` — прогноз невозможен: при нулевой или отрицательной альфе удлинять нечего (пункты не
 * согласованы вовсе, и добавление таких же не поможет), а целевая надёжность в единицу
 * недостижима никаким числом заданий.
 *
 * @param alpha текущая надёжность
 * @param target желаемая надёжность
 * @param items текущее число пунктов
 * @returns множитель длины и число пунктов, которое нужно добавить (отрицательное — снять)
 */
export function spearmanBrown(
  alpha: number,
  target: number,
  items: number,
): { factor: number; itemsDelta: number } | null {
  if (!(alpha > 0) || !(target > 0) || target >= 1 || items < 1) return null;
  const factor = (target * (1 - alpha)) / (alpha * (1 - target));
  // Округление вверх — с допуском на шум последнего разряда: ровно двукратная длина выходит в
  // двоичной дроби как 2,0000000000000004, и «добавить 4 задания» превращалось в «добавить 5».
  // Совет автору нельзя брать из погрешности вычислений.
  return { factor, itemsDelta: Math.ceil(items * factor - 1e-9) - items };
}
