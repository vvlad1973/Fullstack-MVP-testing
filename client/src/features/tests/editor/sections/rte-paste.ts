/**
 * @module features/tests/editor/sections/rte-paste
 * @description Очистка вставки в форматированный редактор (`FeedbackEditorModal`, режим richText).
 *
 * Зачем. Область ввода — `contenteditable`, и вставка из Word, письма или другой страницы
 * приносит с собой встроенные стили (`font-family: 'Times New Roman'`, `font-size: 12pt`,
 * цвета, `mso-*`). Продукт печатает форматированный текст КАК ЕСТЬ (`richTextToHtml`), а
 * встроенный стиль сильнее любого CSS шаблона, поэтому текст автора выходил на экране итогов
 * и в отчёте чужим шрифтом. Чистить нужно на входе: оставляем только то, что умеет сам
 * редактор (абзацы, жирный, курсив, подчёркивание, ссылки, списки), остальное — текст.
 *
 * Чистый модуль относительно React; DOM нужен только для разбора разметки.
 */

/** Теги, которые редактор умеет создавать сам, — они проходят как есть, без атрибутов. */
const KEEP = new Set(["P", "BR", "B", "STRONG", "I", "EM", "U", "UL", "OL", "LI"]);
/** Блочные теги, которых у редактора нет: каждый становится абзацем. */
const BLOCK_TO_P = new Set(["DIV", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "PRE", "SECTION", "ARTICLE", "TR"]);
/** Вырезаются вместе с содержимым: это не текст автора. */
const DROP = new Set(["SCRIPT", "STYLE", "META", "LINK", "TITLE", "HEAD", "XML", "TEMPLATE", "IFRAME", "OBJECT"]);

function safeHref(href: string | null): string | null {
  if (!href) return null;
  const value = href.trim();
  return /^(https?:|mailto:)/i.test(value) ? value : null;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function walk(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return escapeHtml((node.textContent ?? "").replace(/ /g, " "));
  if (node.nodeType !== Node.ELEMENT_NODE) return "";
  const el = node as Element;
  const tag = el.tagName.toUpperCase();
  if (DROP.has(tag)) return "";
  const inner = Array.from(el.childNodes).map(walk).join("");
  if (tag === "A") {
    const href = safeHref(el.getAttribute("href"));
    return href ? `<a href="${escapeHtml(href)}">${inner}</a>` : inner;
  }
  if (tag === "BR") return "<br>";
  if (KEEP.has(tag)) {
    const name = tag.toLowerCase();
    return `<${name}>${inner}</${name}>`;
  }
  if (BLOCK_TO_P.has(tag)) return inner.trim() === "" ? "" : `<p>${inner}</p>`;
  // `span`, `font`, `o:p` и прочее: оболочка с оформлением снимается, текст остаётся.
  return inner;
}

/** Разметка из буфера обмена → только то, что редактор умеет сам. */
export function sanitizePastedHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const out = Array.from(doc.body.childNodes).map(walk).join("");
  // Пустые абзацы, оставшиеся от обёрток Word, не нужны.
  return out.replace(/<p>(?:\s|<br>)*<\/p>/g, "");
}

/** Обычный текст из буфера → абзацы по строкам. */
export function plainTextToHtml(text: string): string {
  return text
    .split(/\r?\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join("");
}
