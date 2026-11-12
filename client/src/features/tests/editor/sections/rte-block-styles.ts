/**
 * @module features/tests/editor/sections/rte-block-styles
 * @description Стили абзаца, которые продукт предлагает в форматированном режиме
 * `RichTextEditor` (эскиз `docs/wireframes/approved/rte-paragraph-styles.html`).
 *
 * Одна константа на все поля: модалку обратной связи и описание теста. Компонент дизайн-системы
 * не знает ни подписей, ни классов — их задаёт продукт, а вид классов на экране участника задаёт
 * шаблон оформления (контракт: «Авторский текст» в спецификации платформы шаблонов).
 *
 * Уровни заголовков начинаются со второго: `h1` на экране занят названием теста.
 */
import type { RichTextBlockStyle } from "@skillum/ui-kit";

/** Класс абзаца «Крупный текст». */
export const TEXT_LARGE_CLASS = "tb-text-l";

/** Класс абзаца «Мелкий текст». */
export const TEXT_SMALL_CLASS = "tb-text-s";

/** Стили абзаца в порядке списка; клавиши — `Ctrl+Alt+<цифра>`, как в Google Документах. */
export const RTE_BLOCK_STYLES: RichTextBlockStyle[] = [
  { id: "paragraph", label: "Обычный текст", tag: "p", shortcut: "0" },
  { id: "heading-1", label: "Заголовок 1", tag: "h2", shortcut: "1" },
  { id: "heading-2", label: "Заголовок 2", tag: "h3", shortcut: "2" },
  { id: "heading-3", label: "Заголовок 3", tag: "h4", shortcut: "3" },
  { id: "text-large", label: "Крупный текст", tag: "p", className: TEXT_LARGE_CLASS },
  { id: "text-small", label: "Мелкий текст", tag: "p", className: TEXT_SMALL_CLASS },
];
