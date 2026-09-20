/**
 * @module shared/questions/prompt-format
 *
 * Формат, в котором написан текст задания (PRD-57 §4.3).
 *
 * Текст задания перестал быть всегда разметкой: автор набирает его в одном из трёх режимов —
 * «Разметка», «Форматированный», «HTML», — и формат хранится рядом с текстом.
 *
 * Написание повторяет то, что в продукте уже принято для авторских текстов
 * (`feedbackContentSchema.format` у обратной связи, `tests.description_format` у описания
 * теста): второй словарь форматов — это способ завести два разных «Форматированных» и
 * однажды показать автору не тот редактор.
 *
 * `richText` и `html` хранят ОДНО И ТО ЖЕ — разметку. Различаются они не данными, а тем,
 * каким редактором автор её правит, и помнить это надо: набравший текст визуально должен
 * вернуться в визуальный редактор, а не в поле с тегами.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */

/** Режимы ввода текста задания, в порядке переключателя. */
export const PROMPT_FORMATS = ["markdown", "richText", "html"] as const;

export type PromptFormat = (typeof PROMPT_FORMATS)[number];

/** Задание в том виде, в каком его читают хосты и сервер. */
export interface FormattedPrompt {
  promptFormat?: unknown;
}

/**
 * Формат задания.
 *
 * @param question Вопрос из хранилища, из книги или из черновика редактора.
 * @returns Один из трёх режимов; всё непонятное — разметка.
 *
 * Умолчание не косметическое: заданий, написанных до §4.3, тысячи, и у них колонки нет
 * вовсе. Прочитать их как разметку — единственный способ ничего им не изменить.
 */
export function promptFormatOf(question: FormattedPrompt | null | undefined): PromptFormat {
  const value = question?.promptFormat;
  return (PROMPT_FORMATS as readonly unknown[]).indexOf(value) >= 0
    ? (value as PromptFormat)
    : "markdown";
}

/**
 * Хранится ли текст РАЗМЕТКОЙ (а не подмножеством markdown)?
 *
 * По этому признаку каждый потребитель текста решает, снимать ли теги: выдача, проекции в
 * плоский текст, подбор кегля, книга Excel. Спрашивать «формат равен html» в сорока местах
 * значило бы забыть про `richText` в половине из них.
 */
export function isMarkupFormat(format: PromptFormat): boolean {
  return format === "richText" || format === "html";
}
