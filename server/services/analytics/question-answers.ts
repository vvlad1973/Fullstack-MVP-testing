/**
 * @module server/services/analytics/question-answers
 * @description PRD-57 FR-32: ответы ОДНОГО задания списком.
 *
 * У задания со свободным текстом статистика отвечает «сколько и как длинно», но на вопрос
 * «что именно пишут» отвечают только сами ответы. Список — это и есть ответ: частот у
 * написанного не бывает, а прочитать три десятка работ автор в состоянии.
 *
 * Список собирается из ТЕХ ЖЕ фактов, что и статистика (`test-answer-facts`), и лишь
 * дополняется подписью участника и датой из слоя наблюдений: считать ответы во второй раз
 * значило бы завести второй источник правды о том, что такое «ответ на задание».
 */

import { formatUserAnswerText } from "../../routes/analytics/helpers";

import type { AnswerFact } from "./answers";
import type { ObservationSource } from "./observations";

/** Одна строка списка: что ответили, кто и когда. */
export interface QuestionAnswerRow {
  attemptId: string;
  source: ObservationSource;
  /** Подпись участника: имя, имя из LMS или псевдоним (PRD-54 раздел 12). */
  participant: string;
  /** Когда прохождение завершилось; `null` — дата неизвестна (старая строка телеметрии). */
  at: string | null;
  /** Ответ, приведённый к печати: текст как набран, пропуски — «поле: значение». */
  answer: string;
  /** Длина ответа в символах — по ней список сортируется, когда автор ищет отписки. */
  length: number;
  result: AnswerFact["result"];
  latencyMs: number | null;
}

/** Что известно о прохождении помимо ответа. */
export interface AnswerObservation {
  participant: string;
  finishedAt: Date | null;
  startedAt: Date | null;
  source: ObservationSource;
}

export interface QuestionAnswersInput {
  questionId: string;
  question: { type: string; dataJson?: unknown };
  facts: readonly AnswerFact[];
  /** Прохождения по идентификатору — подпись участника и дата. */
  observations: ReadonlyMap<string, AnswerObservation>;
}

/**
 * Собрать список ответов на одно задание.
 *
 * Пустые ответы отбрасываются: «не отвечал» — факт статистики (доля пропусков), а в списке
 * работ пустая строка занимает место и не сообщает ничего.
 *
 * Порядок — от свежих к старым: автор открывает список, чтобы прочитать то, что написали
 * СЕЙЧАС. Прохождения без даты идут в конец, а не в начало.
 *
 * @param input задание, факты ответов и справочник прохождений
 * @returns строки списка, готовые и к показу, и к выгрузке
 */
export function buildQuestionAnswerRows(input: QuestionAnswersInput): QuestionAnswerRow[] {
  const { questionId, question, facts, observations } = input;

  const rows: QuestionAnswerRow[] = [];
  for (const fact of facts) {
    if (fact.questionId !== questionId) continue;
    const text = formatUserAnswerText(question.type, question.dataJson ?? {}, fact.answer).trim();
    if (text === "" || text === "(нет ответа)") continue;

    const observation = observations.get(fact.attemptId);
    const at = observation?.finishedAt ?? observation?.startedAt ?? null;
    rows.push({
      attemptId: fact.attemptId,
      source: observation?.source ?? fact.source,
      participant: observation?.participant ?? "Неизвестный участник",
      at: at ? at.toISOString() : null,
      answer: text,
      length: text.length,
      result: fact.result,
      latencyMs: fact.latencyMs,
    });
  }

  return rows.sort((a, b) => {
    if (a.at === b.at) return 0;
    if (a.at === null) return 1;
    if (b.at === null) return -1;
    return a.at < b.at ? 1 : -1;
  });
}
