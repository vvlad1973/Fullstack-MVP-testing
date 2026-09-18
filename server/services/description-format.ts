/**
 * @module server/services/description-format
 * @description PRD-59 §8: the ONE place the test description's markup is cleaned.
 *
 * The description is written from more than one place — the editor's drawer, the
 * Excel workbook import, a test transfer — so cleaning on the client alone would
 * leave two of the three doors open. Every writer goes through here.
 *
 * The policy is not a new one: it is the same sanitiser the content-page fields use
 * ({@link module:shared/security/html-sanitize}), because the source is the same
 * person — the test's author — and one source must not be read two ways.
 */
import { sanitizeHtml } from "@shared/security/html-sanitize";
import type { RichTextFormat } from "@shared/template/rich-text";

/**
 * Region the description renders into. A pasted `<style>` is confined to it, so an
 * author's stray `body { … }` restyles their description instead of the whole player.
 */
export const DESCRIPTION_SCOPE = ".tb-cover__desc";

/**
 * @param text Author's description as it arrived.
 * @param format Its format. `plain` is NOT markup: it is returned untouched, tags and
 *   all, because a plain description shows them as text rather than running them.
 * @returns The description, safe to print as markup.
 */
export function sanitizeDescription(
  text: string,
  format: RichTextFormat | null | undefined,
): string {
  if (format !== "richText" && format !== "html") return text;
  return sanitizeHtml(text, { scope: DESCRIPTION_SCOPE });
}
