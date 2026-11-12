/**
 * @module components/__tests__/rich-text-editor-block-styles.test
 * @description Paragraph styles of the design-system `RichTextEditor` (wireframe
 * `docs/wireframes/approved/rte-paragraph-styles.html`) and the pure block engine behind
 * them (`richTextBlocks`).
 *
 * jsdom has no `execCommand`, so the single-undo-step swap falls back to assigning the
 * markup; the undo step itself is checked in a real browser, not here.
 */
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { RichTextEditor, type RichTextBlockStyle } from "@skillum/ui-kit";
import {
  blockStyleState,
  endOffsetOf,
  pointAtTextOffset,
  restyleBlocks,
  textOffsetOf,
} from "../../../../vendor/ui-kit/src/components/richTextBlocks";

const STYLES: RichTextBlockStyle[] = [
  { id: "paragraph", label: "Обычный текст", tag: "p", shortcut: "0" },
  { id: "heading-1", label: "Заголовок 1", tag: "h2", shortcut: "1" },
  { id: "heading-2", label: "Заголовок 2", tag: "h3", shortcut: "2" },
  { id: "heading-3", label: "Заголовок 3", tag: "h4", shortcut: "3" },
  { id: "text-large", label: "Крупный текст", tag: "p", className: "tb-text-l" },
  { id: "text-small", label: "Мелкий текст", tag: "p", className: "tb-text-s" },
];

/** A detached field with the given markup. */
function field(html: string): HTMLDivElement {
  const el = document.createElement("div");
  el.innerHTML = html;
  return el;
}

/** Offsets of the characters of `needle`, counted the way the editor counts them. */
function around(el: HTMLElement, needle: string) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = (n.textContent ?? "").indexOf(needle);
    if (i >= 0) {
      const start = textOffsetOf(el, n, i);
      return { start, end: start + needle.length };
    }
  }
  throw new Error(`no «${needle}» in the field`);
}

const style = (id: string) => STYLES.find((s) => s.id === id)!;

describe("restyleBlocks", () => {
  it("turns only the touched paragraph into a heading, leaving its content as is", () => {
    const el = field('<p>Один <b>жирный</b></p><p>Два</p>');
    expect(restyleBlocks(el, around(el, "Один"), style("heading-1"), STYLES))
      .toBe("<h2>Один <b>жирный</b></h2><p>Два</p>");
  });

  it("keeps several selected paragraphs as separate blocks (unlike formatBlock)", () => {
    const el = field("<p>Один</p><h3>Два</h3><p>Три</p>");
    const sel = { start: 1, end: endOffsetOf(el) - 1 };
    expect(restyleBlocks(el, sel, style("heading-1"), STYLES)).toBe("<h2>Один</h2><h2>Два</h2><h2>Три</h2>");
  });

  it("a size is a class on the paragraph; switching size replaces the class", () => {
    const el = field('<p class="tb-text-s keep">Т</p>');
    expect(restyleBlocks(el, around(el, "Т"), style("text-large"), STYLES)).toBe('<p class="keep tb-text-l">Т</p>');
  });

  it("«Обычный текст» drops both the heading and the size", () => {
    const el = field('<h3>А</h3><p class="tb-text-l">Б</p>');
    const sel = { start: 0, end: endOffsetOf(el) };
    expect(restyleBlocks(el, sel, style("paragraph"), STYLES)).toBe("<p>А</p><p>Б</p>");
  });

  it("keeps attributes other than the style class", () => {
    const el = field('<p style="text-align: center" dir="ltr">Т</p>');
    expect(restyleBlocks(el, around(el, "Т"), style("heading-2"), STYLES))
      .toBe('<h3 style="text-align: center" dir="ltr">Т</h3>');
  });

  it("does not touch lists", () => {
    const el = field("<ul><li>Пункт</li></ul><p>Т</p>");
    expect(restyleBlocks(el, around(el, "Пункт"), style("heading-1"), STYLES)).toBeNull();
  });

  it("wraps loose text and a div left by the browser into paragraphs", () => {
    const el = field("Свободная строка<div>Строка в div</div>");
    expect(restyleBlocks(el, around(el, "Свободная"), style("heading-3"), STYLES))
      .toBe("<h4>Свободная строка</h4><div>Строка в div</div>");
    expect(restyleBlocks(el, around(el, "в div"), style("heading-3"), STYLES))
      .toBe("<p>Свободная строка</p><h4>Строка в div</h4>");
  });

  it("returns null when the style is already there", () => {
    const el = field("<h2>Т</h2>");
    expect(restyleBlocks(el, around(el, "Т"), style("heading-1"), STYLES)).toBeNull();
  });

  it("an empty field gets one block of the style", () => {
    expect(restyleBlocks(field(""), null, style("text-small"), STYLES)).toBe('<p class="tb-text-s"><br></p>');
  });
});

describe("text offsets", () => {
  it("count one character between lines, so a paragraph end and the next start differ", () => {
    const el = field("<p>Аб</p><p>Вг</p>");
    const [first, second] = Array.from(el.querySelectorAll("p")).map((p) => p.firstChild!);
    expect(textOffsetOf(el, first, 2)).toBe(2);
    expect(textOffsetOf(el, second, 0)).toBe(3);
    expect(pointAtTextOffset(el, 2)).toEqual({ node: first, offset: 2 });
    expect(pointAtTextOffset(el, 3)).toEqual({ node: second, offset: 0 });
  });

  it("an empty paragraph is a line of its own", () => {
    const el = field("<p>А</p><p><br></p><p>Б</p>");
    const empty = el.children[1];
    expect(textOffsetOf(el, empty, 0)).toBe(2);
    expect(pointAtTextOffset(el, 2)).toEqual({ node: empty, offset: 0 });
    expect(around(el, "Б").start).toBe(3);
  });
});

describe("blockStyleState", () => {
  it("names the style under the caret", () => {
    const el = field('<p>А</p><h3>Б</h3><p class="tb-text-l">В</p>');
    expect(blockStyleState(el, around(el, "Б"), STYLES)).toEqual({ value: "heading-2", disabled: false });
    expect(blockStyleState(el, around(el, "В"), STYLES)).toEqual({ value: "text-large", disabled: false });
    expect(blockStyleState(el, around(el, "А"), STYLES)).toEqual({ value: "paragraph", disabled: false });
  });

  it("is empty when the selection spans different styles", () => {
    const el = field("<p>А</p><h3>Б</h3>");
    expect(blockStyleState(el, { start: 0, end: endOffsetOf(el) }, STYLES)).toEqual({ value: "", disabled: false });
  });

  it("is unavailable inside a list", () => {
    const el = field("<ul><li>Пункт</li></ul>");
    expect(blockStyleState(el, around(el, "Пункт"), STYLES)).toEqual({ value: "", disabled: true });
  });
});

/** Controlled host, the way the product mounts the editor. */
function Host({ initial, onValue }: { initial: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <RichTextEditor
      value={value}
      onChange={(v) => {
        setValue(v);
        onValue?.(v);
      }}
      modes={["plain", "rich", "html"]}
      mode="rich"
      blockStyles={STYLES}
      data-testid="rte"
    />
  );
}

/** Puts the caret on `needle` and lets the editor see it. */
function placeCaret(area: HTMLElement, needle: string) {
  const walker = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = (n.textContent ?? "").indexOf(needle);
    if (i >= 0) {
      const range = document.createRange();
      range.setStart(n, i);
      range.collapse(true);
      const sel = window.getSelection()!;
      sel.removeAllRanges();
      sel.addRange(range);
      break;
    }
  }
  act(() => {
    document.dispatchEvent(new Event("selectionchange"));
  });
}

describe("<RichTextEditor blockStyles>", () => {
  it("has no style list without the prop", () => {
    render(<RichTextEditor value="" onChange={() => {}} mode="rich" data-testid="plain-rte" />);
    expect(screen.queryByTestId("plain-rte-style")).not.toBeInTheDocument();
  });

  it("shows the style of the paragraph under the caret", () => {
    render(<Host initial="<p>А</p><h3>Б</h3>" />);
    const area = screen.getByTestId("rte-area");
    placeCaret(area, "Б");
    expect(within(screen.getByTestId("rte-style")).getByRole("button")).toHaveTextContent("Заголовок 2");
  });

  it("picking a style in the list restyles the paragraph and reports the value", () => {
    const onValue = vi.fn();
    render(<Host initial="<p>А</p><p>Б</p>" onValue={onValue} />);
    const area = screen.getByTestId("rte-area");
    placeCaret(area, "Б");
    fireEvent.click(within(screen.getByTestId("rte-style")).getByRole("button"));
    // The menu is portalled to the body, not drawn inside the field.
    const option = screen.getByRole("option", { name: "Мелкий текст" });
    expect(screen.getByTestId("rte-style").contains(option)).toBe(false);
    fireEvent.click(option);
    expect(onValue).toHaveBeenLastCalledWith('<p>А</p><p class="tb-text-s">Б</p>');
    expect(area.innerHTML).toBe('<p>А</p><p class="tb-text-s">Б</p>');
  });

  it("Ctrl+Alt+1 makes the paragraph «Заголовок 1»", () => {
    const onValue = vi.fn();
    render(<Host initial="<p>А</p>" onValue={onValue} />);
    const area = screen.getByTestId("rte-area");
    placeCaret(area, "А");
    fireEvent.keyDown(area, { key: "1", code: "Digit1", ctrlKey: true, altKey: true });
    expect(onValue).toHaveBeenLastCalledWith("<h2>А</h2>");
  });

  it("the list is disabled inside a list item", () => {
    render(<Host initial="<ul><li>Пункт</li></ul>" />);
    placeCaret(screen.getByTestId("rte-area"), "Пункт");
    expect(within(screen.getByTestId("rte-style")).getByRole("button")).toBeDisabled();
  });

  it("the link button asks the host instead of window.prompt", async () => {
    const promptSpy = vi.spyOn(window, "prompt");
    const onRequestLink = vi.fn().mockResolvedValue(null);
    render(<RichTextEditor value="<p>Т</p>" onChange={() => {}} mode="rich" onRequestLink={onRequestLink} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Ссылка" }));
    });
    expect(onRequestLink).toHaveBeenCalledWith("");
    expect(promptSpy).not.toHaveBeenCalled();
    promptSpy.mockRestore();
  });
});
