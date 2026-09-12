/**
 * @module shared/lms-export/response-codec
 * @description Кодирование и разбор строки `cmi.interactions.n.learner_response` (PRD-54 раздел 7).
 *
 * Зеркало `formatResponse` из пакета (`server/scorm/template/app/render/resultsPage.js`). Обе
 * половины лежат в ОДНОМ модуле и покрыты тестом на парность намеренно: копии этого кода в проекте
 * расходились дважды, и оба раза молча.
 *
 * ВЕРСИЯ ФОРМАТА. Выбор, множественный выбор, ранжирование и сопоставление были 1-based всегда,
 * а распределение баллов кодировалось 0-based (версия 1). С версии 2 индексы выравнены: 1-based
 * у ВСЕХ типов. Различить версии по самой строке нельзя — «0,1,2» и «1,2,3» одинаково
 * правдоподобны, — поэтому пакет сообщает версию отдельным взаимодействием, а её отсутствие в
 * выгрузке означает «собран до выравнивания». Выданные пакеты шлют версию 1 вечно, поэтому обе
 * ветки разбора остаются рабочими и обе покрыты тестом на парность.
 */
import { distributesBudget, isSingleIndexChoice } from "../questions/question-type";

/** Ответ в той же форме, в какой его держат хосты: индекс, список индексов или карта. */
export type LearnerAnswer = number | number[] | Record<number, number>;

/**
 * Версия формата, которую пишет пакет СЕГОДНЯ: индексы 1-based у всех типов вопросов.
 *
 * Значение уезжает в LMS взаимодействием {@link RESPONSE_FORMAT_INTERACTION_ID} и приходит
 * обратно строкой выгрузки. Меняется только вместе с самим кодированием.
 */
export const RESPONSE_FORMAT_VERSION = 2;

/**
 * Версия формата у пакета, собранного до выравнивания индексов: распределение баллов 0-based.
 *
 * Такие пакеты версию не сообщают вовсе, поэтому она же — умолчание разбора.
 */
export const LEGACY_RESPONSE_FORMAT_VERSION = 1;

/**
 * Идентификатор служебного взаимодействия, которым пакет сообщает версию формата.
 *
 * Префикс `meta_` выбран по образцу уже существующих служебных блоков выгрузки (`scale_`,
 * `var_`, `topic_`): разбор опознаёт вид блока по префиксу, и новый вид не должен попадать в
 * «неопознанные колонки».
 */
export const RESPONSE_FORMAT_INTERACTION_ID = "meta_response_format";

/** Версия, по правилам которой разбирать строку: отсутствие означает исходный формат. */
function versionOf(formatVersion: number | null | undefined): number {
  const n = Number(formatVersion);
  return Number.isFinite(n) && n >= 1 ? n : LEGACY_RESPONSE_FORMAT_VERSION;
}

/** С какого числа начинается отсчёт вариантов у распределения баллов в этой версии. */
function budgetOrigin(formatVersion: number | null | undefined): number {
  return versionOf(formatVersion) >= RESPONSE_FORMAT_VERSION ? 1 : 0;
}

function toInt(raw: string): number | null {
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : null;
}

/**
 * Разобрать строку ответа из выгрузки.
 *
 * @param type тип вопроса
 * @param raw значение колонки «Полученный ответ»
 * @param formatVersion версия формата из выгрузки; отсутствие = пакет собран до выравнивания
 *   индексов, то есть распределение баллов 0-based
 * @returns ответ в форме хоста либо `null`, если ответа нет или строка неразбираема
 */
export function decodeLearnerResponse(
  type: string,
  raw: string,
  formatVersion?: number | null,
): LearnerAnswer | null {
  const s = String(raw ?? "").trim();
  if (s === "") return null;

  if (isSingleIndexChoice(type)) {
    const n = toInt(s);
    return n === null || n < 1 ? null : n - 1;
  }

  if (type === "multiple" || type === "ranking") {
    const parts = s.split(",").map(toInt);
    if (parts.some((n) => n === null || n < 1)) return null;
    return (parts as number[]).map((n) => n - 1);
  }

  if (type === "matching") {
    const out: Record<number, number> = {};
    for (const pair of s.split(",")) {
      const [l, r] = pair.split("-").map(toInt);
      if (l === null || r === null || l < 1 || r < 1) return null;
      out[l - 1] = r - 1;
    }
    return out;
  }

  if (distributesBudget(type)) {
    const origin = budgetOrigin(formatVersion);
    const out: Record<number, number> = {};
    for (const pair of s.split(",")) {
      const [i, v] = pair.split("[.]").map(toInt);
      if (i === null || v === null || i < origin) return null;
      out[i - origin] = v;
    }
    return out;
  }

  return null;
}

/**
 * Закодировать ответ так же, как это делает пакет. Существует ради теста на парность.
 *
 * @param type тип вопроса
 * @param answer ответ в форме хоста
 * @param formatVersion версия формата; по умолчанию та, что пишет пакет сегодня. Явная
 *   версия 1 нужна проверке парности на исходном формате: выгрузки таких пакетов мы читаем
 *   вечно, и их ветка обязана оставаться парной
 * @returns строка `learner_response`
 */
export function encodeLearnerResponse(
  type: string,
  answer: LearnerAnswer,
  formatVersion: number = RESPONSE_FORMAT_VERSION,
): string {
  if (answer === null || answer === undefined) return "";

  if (isSingleIndexChoice(type)) return String((answer as number) + 1);

  if (type === "multiple" || type === "ranking") {
    return (answer as number[]).map((i) => i + 1).join(",");
  }

  if (type === "matching") {
    const m = answer as Record<number, number>;
    return Object.keys(m)
      .map(Number)
      .sort((a, b) => a - b)
      .map((k) => `${k + 1}-${m[k] + 1}`)
      .join(",");
  }

  if (distributesBudget(type)) {
    const origin = budgetOrigin(formatVersion);
    const m = answer as Record<number, number>;
    return Object.keys(m)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => `${i + origin}[.]${m[i]}`)
      .join(",");
  }

  return "";
}
