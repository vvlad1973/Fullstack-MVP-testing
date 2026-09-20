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
import { renderFormula } from "./formula-render";

/** Есть ли в тексте задания то, ради чего разметку вообще стоит считать заранее. */
function needsPrerender(prompt: unknown): prompt is string {
  return typeof prompt === "string" && (prompt.indexOf("`") !== -1 || prompt.indexOf("$$") !== -1);
}

/** Оболочка формулы, какой её печатает грамматика. */
const FORMULA_SLOT = /<span class="tb-formula" data-latex="([^"]*)">([\s\S]*?)<\/span>/g;

/**
 * Подставить SVG вместо оболочек формул (PRD-57 FR-07).
 *
 * Готовая картинка берётся из ЗАПАСА вопроса, если он есть: требование прямо говорит, что
 * при переносе теста между установками SVG едет вместе с вопросом, а не пересчитывается
 * на приёмнике — иначе вид формулы зависит от версии библиотеки на чужом контуре. Когда
 * запаса нет (старое задание, импорт), формула считается на месте: показать её важнее.
 *
 * Неразобранная запись остаётся ИСХОДНЫМ ТЕКСТОМ (FR-10): участник видит формулу, как её
 * набрал автор, а не пустое место и не сообщение об ошибке — про ошибку узнаёт автор.
 */
function substituteFormulas(html: string, stored: Record<string, string> | null): string {
  FORMULA_SLOT.lastIndex = 0;
  return html.replace(FORMULA_SLOT, (whole, latex: string, fallback: string) => {
    const source = unescapeAttr(latex);
    const ready = stored?.[source];
    if (typeof ready === "string" && ready !== "") return wrapFormula(ready, source);
    const rendered = renderFormula(source);
    return rendered.svg === "" ? whole : wrapFormula(rendered.svg, source);
  });
}

/** Обёртка формулы: класс держит оформление, запись остаётся для правки и для машин. */
function wrapFormula(svg: string, latex: string): string {
  return `<span class="tb-formula" data-latex="${escapeAttr(latex)}">${svg}</span>`;
}

function unescapeAttr(text: string): string {
  return text.replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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
export function promptHtmlOf(question: { prompt?: unknown; dataJson?: unknown }): { promptHtml?: string } {
  if (!needsPrerender(question.prompt)) return {};
  // Блочный рендер: листинг — блочный узел, и в инлайновом выводе его нет по устройству.
  const html = question.prompt.indexOf("```") === -1
    ? renderInlineMarkdown(question.prompt)
    : renderBlockMarkdown(question.prompt);
  const data = (question.dataJson ?? {}) as { formulas?: Record<string, string> };
  const stored = data.formulas && typeof data.formulas === "object" ? data.formulas : null;
  return { promptHtml: substituteFormulas(highlightCodeBlocks(html), stored) };
}

/**
 * Запас готовых формул вопроса — то, что кладётся В ЗАДАНИЕ при сохранении.
 *
 * Хранится именно он, а не подсветка листинга, и это не непоследовательность: требование
 * §4.2 прямо велит возить SVG вместе с вопросом при переносе между установками, тогда как
 * подсветка такого требования не несёт и считается на выдаче.
 *
 * @param prompt Текст задания.
 * @returns Словарь «запись → SVG»; пустой объект, когда формул нет.
 */
export function formulasFor(prompt: unknown): Record<string, string> {
  if (typeof prompt !== "string" || prompt.indexOf("$$") === -1) return {};
  const out: Record<string, string> = {};
  const found = prompt.match(/\$\$([^$]+)\$\$/g) ?? [];
  for (const whole of found) {
    const latex = whole.slice(2, -2).trim();
    if (latex === "" || out[latex]) continue;
    const rendered = renderFormula(latex);
    if (rendered.svg !== "") out[latex] = rendered.svg;
  }
  return out;
}
