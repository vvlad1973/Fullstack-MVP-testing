/**
 * @module shared/lms-export/response-codec
 * @description Кодирование и разбор строки `cmi.interactions.n.learner_response` (PRD-54 раздел 7).
 *
 * Зеркало `formatResponse` из пакета (`server/scorm/template/app/render/resultsPage.js`). Обе
 * половины лежат в ОДНОМ модуле и покрыты тестом на парность намеренно: копии этого кода в проекте
 * расходились дважды, и оба раза молча.
 *
 * ГОЧА ИНДЕКСОВ. Выбор, множественный выбор, ранжирование и сопоставление кодируются 1-based;
 * распределение баллов — 0-based. Это расхождение существует в выданных пакетах, поэтому разбор
 * обязан его воспроизводить. Выравнивание — отдельная задача вне PRD-54.
 */
import { distributesBudget, isSingleIndexChoice } from "../questions/question-type";

/** Ответ в той же форме, в какой его держат хосты: индекс, список индексов или карта. */
export type LearnerAnswer = number | number[] | Record<number, number>;

function toInt(raw: string): number | null {
  const n = Number(String(raw).trim());
  return Number.isInteger(n) ? n : null;
}

/**
 * Разобрать строку ответа из выгрузки.
 *
 * @param type тип вопроса
 * @param raw значение колонки «Полученный ответ»
 * @returns ответ в форме хоста либо `null`, если ответа нет или строка неразбираема
 */
export function decodeLearnerResponse(type: string, raw: string): LearnerAnswer | null {
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
    const out: Record<number, number> = {};
    for (const pair of s.split(",")) {
      const [i, v] = pair.split("[.]").map(toInt);
      if (i === null || v === null || i < 0) return null;
      out[i] = v;
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
 * @returns строка `learner_response`
 */
export function encodeLearnerResponse(type: string, answer: LearnerAnswer): string {
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
    const m = answer as Record<number, number>;
    return Object.keys(m)
      .map(Number)
      .sort((a, b) => a - b)
      .map((i) => `${i}[.]${m[i]}`)
      .join(",");
  }

  return "";
}
