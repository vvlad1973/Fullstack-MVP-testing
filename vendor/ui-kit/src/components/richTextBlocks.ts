/**
 * @module richTextBlocks
 * @description Paragraph styles of the formatted mode of `RichTextEditor`: which style the
 * selection sits in, and the markup of the field after a style is applied.
 *
 * WHY NOT `formatBlock`. The browser command restyles one block correctly but GLUES several
 * selected paragraphs into one (`<h2>One<br>Two<br>Three</h2>`) and wraps a whole list into
 * the heading. Changing a class through the DOM is precise but never reaches the browser's
 * undo stack. So the change is computed here, on a detached copy, block by block, and the
 * caller swaps the field's content for it with ONE `insertHTML` — a single undo step.
 *
 * The caret survives the swap as a pair of TEXT offsets from the start of the field, with
 * one character counted between lines: a restyle never adds or removes characters, only
 * the elements around them.
 *
 * The module knows nothing about the product's class names: the list of styles comes from
 * the host.
 */

/** One paragraph style the host offers in the toolbar. */
export interface RichTextBlockStyle {
  /** Stable id; the value of the style list. */
  id: string;
  /** Label in the style list. */
  label: string;
  /** Block tag the style produces: `p`, `h2`, `h3`, `h4`, … */
  tag: string;
  /** Class the style puts on the block; absent = a bare tag. */
  className?: string;
  /** Digit of the `Ctrl+Alt+<digit>` shortcut, e.g. `'1'`. */
  shortcut?: string;
}

/** A selection inside the field as text offsets from its start. */
export interface TextSelection {
  start: number;
  end: number;
}

/** Tags a paragraph style may replace. Lists, tables and the rest stay as they are. */
const RESTYLABLE = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6']);

/** Elements that are blocks in their own right; anything else is inline content. */
const BLOCK_TAGS = new Set([
  'P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE',
  'FIGURE', 'HR', 'SECTION', 'ARTICLE', 'DL', 'ADDRESS',
]);

/** Attribute that marks, on the detached copy, the blocks the selection touches. */
const HIT = 'data-rte-hit';

function isBlock(node: Node): boolean {
  return node.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((node as Element).tagName);
}

/**
 * A line of the field: one top-level block, or a run of inline content lying directly in
 * the field. Lines are what a paragraph style applies to.
 */
interface Line {
  nodes: ChildNode[];
  texts: Text[];
  /** Offset of the line's first character; lines are one character apart. */
  start: number;
}

function textsOf(node: Node): Text[] {
  if (node.nodeType === Node.TEXT_NODE) return [node as Text];
  const out: Text[] = [];
  const walker = node.ownerDocument!.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) out.push(n as Text);
  return out;
}

const lengthOf = (line: Line) => line.texts.reduce((sum, t) => sum + t.length, 0);

/**
 * Splits the field into lines. Between two lines the offsets count ONE extra character, as
 * a line break would: without it the end of one paragraph and the start of the next are
 * the same offset, and a caret restored after a restyle could jump to the other paragraph.
 */
function linesOf(root: Node): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;
  let currentIsBlock = false;
  for (const child of Array.from(root.childNodes)) {
    const block = isBlock(child);
    if (!current || block || currentIsBlock) {
      const start: number = current ? current.start + lengthOf(current) + 1 : 0;
      current = { nodes: [], texts: [], start };
      lines.push(current);
      currentIsBlock = block;
    }
    current.nodes.push(child);
    current.texts.push(...textsOf(child));
  }
  return lines;
}

/** The top-level child of `root` that holds `node`. */
function topChildOf(root: Node, node: Node): ChildNode | null {
  let n: Node | null = node;
  while (n && n.parentNode !== root) n = n.parentNode;
  return n as ChildNode | null;
}

/**
 * Offset of a point inside `root`, counted in characters with one character between lines.
 *
 * @param root The field.
 * @param node Container of the point.
 * @param offset Offset of the point inside `node`.
 * @returns The offset.
 */
export function textOffsetOf(root: Node, node: Node, offset: number): number {
  const lines = linesOf(root);
  if (lines.length === 0) return 0;
  let child: ChildNode | null;
  if (node === root) {
    if (offset >= root.childNodes.length) {
      const last = lines[lines.length - 1];
      return last.start + lengthOf(last);
    }
    child = root.childNodes[offset];
  } else {
    child = topChildOf(root, node);
  }
  const line = lines.find((l) => child && l.nodes.includes(child)) ?? lines[0];
  const range = root.ownerDocument!.createRange();
  range.setStartBefore(line.nodes[0]);
  range.setEnd(node, offset);
  return line.start + range.toString().length;
}

/**
 * The point at an offset counted by {@link textOffsetOf}.
 *
 * @param root The field.
 * @param offset The offset.
 * @returns A text node and an offset in it; the start of an empty line; the end of an
 *   empty field.
 */
export function pointAtTextOffset(root: Node, offset: number): { node: Node; offset: number } {
  const lines = linesOf(root);
  if (lines.length === 0) return { node: root, offset: 0 };
  let line = lines[0];
  for (const l of lines) if (l.start <= offset) line = l;
  let left = Math.min(Math.max(0, offset - line.start), lengthOf(line));
  for (const t of line.texts) {
    if (left <= t.length) return { node: t, offset: left };
    left -= t.length;
  }
  const first = line.nodes[0];
  if (first.nodeType === Node.ELEMENT_NODE) return { node: first, offset: 0 };
  return { node: root, offset: Array.from(root.childNodes).indexOf(first) };
}

/**
 * Offset of the very end of the field.
 *
 * @param root The field.
 * @returns The offset {@link textOffsetOf} gives to the end of the last line.
 */
export function endOffsetOf(root: Node): number {
  const lines = linesOf(root);
  const last = lines[lines.length - 1];
  return last ? last.start + lengthOf(last) : 0;
}

/**
 * Reads the selection of the document as text offsets inside `root`.
 *
 * @param root The field.
 * @returns The offsets, or `null` when the selection is not inside the field.
 */
export function readSelection(root: Node): TextSelection | null {
  const sel = root.ownerDocument!.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  return {
    start: textOffsetOf(root, range.startContainer, range.startOffset),
    end: textOffsetOf(root, range.endContainer, range.endOffset),
  };
}

/**
 * Builds a DOM range over `root` from text offsets.
 *
 * @param root The field.
 * @param selection The offsets.
 * @returns The range.
 */
export function rangeFromSelection(root: Node, selection: TextSelection): Range {
  const range = root.ownerDocument!.createRange();
  const start = pointAtTextOffset(root, selection.start);
  const end = pointAtTextOffset(root, selection.end);
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);
  return range;
}

/**
 * Makes the document selection match the offsets.
 *
 * @param root The field.
 * @param selection The offsets.
 */
export function writeSelection(root: Node, selection: TextSelection): void {
  const sel = root.ownerDocument!.getSelection();
  if (!sel) return;
  sel.removeAllRanges();
  sel.addRange(rangeFromSelection(root, selection));
}

/**
 * Top-level children of `root` the range touches.
 *
 * A collapsed range touches the child that contains it; a caret standing between children
 * touches the one after it (or the last one at the very end).
 */
function touchedChildren(root: Element, range: Range): Node[] {
  const kids = Array.from(root.childNodes);
  if (kids.length === 0) return [];
  const hit = kids.filter((k) => range.intersectsNode(k));
  if (hit.length > 0) return hit;
  if (range.startContainer === root) return [kids[Math.min(range.startOffset, kids.length - 1)]];
  return [];
}

/** The style a block carries, or `null` when it carries none of the offered ones. */
function styleOfBlock(block: Element, styles: RichTextBlockStyle[]): RichTextBlockStyle | null {
  const tag = block.tagName.toLowerCase();
  const withClass = styles.find((s) => s.className && s.tag === tag && block.classList.contains(s.className));
  if (withClass) return withClass;
  const bare = styles.find((s) => !s.className && s.tag === tag);
  if (bare && !styles.some((s) => s.className && block.classList.contains(s.className))) return bare;
  if (tag === 'div' || tag === 'p') return styles.find((s) => !s.className && s.tag === 'p') ?? null;
  return null;
}

/** What the style list shows for the current selection. */
export interface BlockStyleState {
  /** Id of the shared style; empty when the blocks differ or carry no offered style. */
  value: string;
  /** The selection touches a list or another block a style cannot replace. */
  disabled: boolean;
}

/**
 * The style of the blocks the selection touches.
 *
 * @param root The field.
 * @param selection The selection as offsets.
 * @param styles The offered styles.
 * @returns Value and availability of the style list.
 */
export function blockStyleState(
  root: Element,
  selection: TextSelection | null,
  styles: RichTextBlockStyle[],
): BlockStyleState {
  const plain = styles.find((s) => !s.className && s.tag === 'p');
  if (!selection || root.childNodes.length === 0) return { value: plain?.id ?? '', disabled: false };
  const touched = touchedChildren(root, rangeFromSelection(root, selection));
  const ids = new Set<string>();
  for (const node of touched) {
    if (!isBlock(node)) {
      if (plain) ids.add(plain.id);
      continue;
    }
    const el = node as Element;
    if (!RESTYLABLE.has(el.tagName)) return { value: '', disabled: true };
    ids.add(styleOfBlock(el, styles)?.id ?? '');
  }
  if (ids.size !== 1) return { value: '', disabled: false };
  return { value: [...ids][0], disabled: false };
}

/** Moves `from`'s children and non-class attributes into a fresh block of the style. */
function rebuild(doc: Document, from: Element, style: RichTextBlockStyle, styles: RichTextBlockStyle[]): Element {
  const block = doc.createElement(style.tag);
  for (const attr of Array.from(from.attributes)) {
    if (attr.name !== 'class' && attr.name !== HIT) block.setAttribute(attr.name, attr.value);
  }
  const known = new Set(styles.map((s) => s.className).filter(Boolean) as string[]);
  const kept = Array.from(from.classList).filter((c) => !known.has(c));
  if (style.className) kept.push(style.className);
  if (kept.length > 0) block.className = kept.join(' ');
  while (from.firstChild) block.appendChild(from.firstChild);
  return block;
}

/**
 * Markup of the field after `style` is applied to the blocks the selection touches.
 *
 * Works on a detached copy; the field itself is left untouched. Runs of inline content
 * lying directly in the field (what a browser leaves behind without a paragraph separator)
 * become paragraphs first, so every touched line ends up as a block of its own. Blocks a
 * style cannot replace — lists, tables, quotes — are left as they are.
 *
 * @param root The field.
 * @param selection The selection as offsets; `null` = the end of the field.
 * @param style The style to apply.
 * @param styles All offered styles (to know which classes are style classes).
 * @returns The new markup, or `null` when nothing changes.
 */
export function restyleBlocks(
  root: Element,
  selection: TextSelection | null,
  style: RichTextBlockStyle,
  styles: RichTextBlockStyle[],
): string | null {
  const doc = root.ownerDocument;
  if (root.childNodes.length === 0) {
    const empty = doc.createElement(style.tag);
    if (style.className) empty.className = style.className;
    empty.appendChild(doc.createElement('br'));
    return empty.outerHTML;
  }
  const end = endOffsetOf(root);
  const range = rangeFromSelection(root, selection ?? { start: end, end });
  const touched = new Set(touchedChildren(root, range));

  const copy = root.cloneNode(true) as Element;
  const originals = Array.from(root.childNodes);
  Array.from(copy.childNodes).forEach((node, i) => {
    if (!touched.has(originals[i])) return;
    if (node.nodeType === Node.ELEMENT_NODE) (node as Element).setAttribute(HIT, '');
    else (node as ChildNode & { [HIT]?: boolean })[HIT] = true;
  });

  // Inline runs directly in the field become paragraphs; a run is touched when any of its
  // members is.
  let run: ChildNode[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const onlyBlank = run.every((n) => n.nodeType === Node.TEXT_NODE && !(n.textContent ?? '').trim());
    if (!onlyBlank) {
      const p = doc.createElement('p');
      const hit = run.some((n) =>
        n.nodeType === Node.ELEMENT_NODE ? (n as Element).hasAttribute(HIT) : Boolean((n as ChildNode & { [HIT]?: boolean })[HIT]));
      run[0].before(p);
      for (const n of run) p.appendChild(n);
      if (hit) p.setAttribute(HIT, '');
    }
    run = [];
  };
  for (const node of Array.from(copy.childNodes)) {
    if (isBlock(node)) flush();
    else run.push(node);
  }
  flush();

  let changed = false;
  for (const el of Array.from(copy.querySelectorAll(`:scope > [${HIT}]`))) {
    if (!RESTYLABLE.has(el.tagName)) {
      el.removeAttribute(HIT);
      continue;
    }
    const current = styleOfBlock(el, styles);
    if (current?.id === style.id && el.tagName.toLowerCase() === style.tag) {
      el.removeAttribute(HIT);
      continue;
    }
    el.replaceWith(rebuild(doc, el, style, styles));
    changed = true;
  }
  for (const el of Array.from(copy.querySelectorAll(`[${HIT}]`))) el.removeAttribute(HIT);
  return changed ? copy.innerHTML : null;
}

/**
 * Replaces the whole content of an editable field with `html` as ONE undoable step.
 *
 * Falls back to a plain assignment where the browser has no `insertHTML` (a test DOM):
 * the result is the same, only without the undo step.
 *
 * @param root The focused field.
 * @param html The new markup.
 */
export function replaceContentUndoably(root: HTMLElement, html: string): void {
  const doc = root.ownerDocument;
  const sel = doc.getSelection();
  let done = false;
  if (sel && typeof doc.execCommand === 'function') {
    const all = doc.createRange();
    all.selectNodeContents(root);
    sel.removeAllRanges();
    sel.addRange(all);
    try {
      done = doc.execCommand('insertHTML', false, html);
    } catch {
      done = false;
    }
  }
  if (!done || root.innerHTML !== html) root.innerHTML = html;
}
