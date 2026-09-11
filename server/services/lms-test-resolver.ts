/**
 * @module server/services/lms-test-resolver
 * @description Определение теста по идентификаторам вопросов из шапки выгрузки (PRD-54 раздел 6.2).
 *
 * Выбирать тест руками нельзя: файл уже содержит ответ — блоки `q_<uuid>` в первой строке шапки, —
 * а ручной выбор открыл бы дорогу записи прохождений не в тот тест, и обнаружилось бы это только
 * по кривой аналитике.
 *
 * Отдельный модуль, а не часть сервиса импорта, потому что вызывающих ДВА: `/api/workbook/inspect`
 * обязан назвать тест ещё до того, как человек нажал «Импортировать».
 */
import type { IStorage } from "../storage";

export interface ResolvedTest {
  /** Тест, если он определился ОДНОЗНАЧНО, иначе `null`. */
  testId: string | null;
  /** Идентификаторы вопросов, которых в базе нет или которые принадлежат другому тесту. */
  foreign: string[];
}

/**
 * Определить тест, которому принадлежат вопросы выгрузки.
 *
 * Путь один: вопрос -> его тема -> разделы, ссылающиеся на эту тему -> тесты этих разделов. Если
 * тест получился ровно один, он и есть цель; ноль или несколько — отказ, потому что записать
 * прохождения наугад хуже, чем не записать вовсе.
 *
 * Вопросы, которых в базе нет, не считаются ошибкой сами по себе: пакет мог быть собран под более
 * ранней версией теста, часть вопросов с тех пор удалили, и остальные строки всё ещё осмысленны.
 * Такие идентификаторы возвращаются списком, чтобы импорт сказал о них в протоколе.
 *
 * @param questionIds идентификаторы из блоков `q_<uuid>` шапки
 * @param storage слой доступа к данным
 * @returns тест и список чужих вопросов
 */
export async function resolveTestByQuestionIds(
  questionIds: string[],
  storage: IStorage,
): Promise<ResolvedTest> {
  const found = await storage.getQuestionsByIds(questionIds);
  const known = new Set(found.map((q) => q.id));
  const foreign = questionIds.filter((id) => !known.has(id));
  if (found.length === 0) return { testId: null, foreign };

  const topicIds = [...new Set(found.map((q) => q.topicId).filter(Boolean))] as string[];
  const sections = await storage.getTestSectionsByTopicIds(topicIds);
  const testIds = [...new Set(sections.map((s) => s.testId))];
  // Несколько тем ОДНОГО теста — норма (тест из нескольких разделов). Несколько ТЕСТОВ — нет.
  if (testIds.length !== 1) return { testId: null, foreign };
  return { testId: testIds[0], foreign };
}
