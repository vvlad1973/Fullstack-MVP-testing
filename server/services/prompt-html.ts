/**
 * @module server/services/prompt-html
 *
 * Готовая разметка текста задания для ХОСТОВ (PRD-57 FR-03a).
 *
 * Один вход для обоих путей выдачи: веб-хост получает её вместе с вопросами попытки,
 * пакет — запечённой в `test.json`. Оба пути серверные, и это то, что позволяет держать
 * подсветку синтаксиса на сервере, не отправляя библиотеку ни в чей браузер.
 *
 * Исходный текст ОСТАЁТСЯ на месте и никуда не девается: по нему считается хеш
 * содержимого, работает книга Excel, печатается обзор через `renderPlainText` и живут
 * пины комментариев рецензента. Разметка — производная, и хост берёт её только для показа.
 */
import { renderBlockMarkdown, renderInlineMarkdown } from "@shared/text/markdown";

import { highlightCodeBlocks } from "./code-highlight";

/** Есть ли в тексте задания то, ради чего разметку вообще стоит считать заранее. */
function needsPrerender(prompt: unknown): prompt is string {
  return typeof prompt === "string" && prompt.indexOf("`") !== -1;
}

/**
 * Поле `promptHtml` вопроса — или ничего, когда считать нечего.
 *
 * Пустой объект, а не `undefined` в поле: вопрос без листинга уезжает хосту байт в байт
 * таким же, каким уезжал до этого этапа, и ни один снимок, ни один тест паритета от
 * появления пустого ключа не дрогнет.
 *
 * @param question Вопрос, как его отдаёт хранилище.
 */
export function promptHtmlOf(question: { prompt?: unknown }): { promptHtml?: string } {
  if (!needsPrerender(question.prompt)) return {};
  // Блочный рендер: листинг — блочный узел, и в инлайновом выводе его нет по устройству.
  const html = question.prompt.indexOf("```") === -1
    ? renderInlineMarkdown(question.prompt)
    : renderBlockMarkdown(question.prompt);
  return { promptHtml: highlightCodeBlocks(html) };
}
