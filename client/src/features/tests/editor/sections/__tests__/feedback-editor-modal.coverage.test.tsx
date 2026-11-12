/**
 * @module features/tests/editor/sections/__tests__/feedback-editor-modal.coverage.test
 * @description Additional branch coverage for {@link FeedbackEditorModal}
 * (PRD-7 FR-36 / FR-37). Complements `feedback-editor-modal.test.tsx` by
 * exercising the interactive paths the smoke test only renders:
 *   - toolbar commands (bold / italic) and the formatted area's `onInput`;
 *   - the link-insert dialog across its branches (wrap an existing selection via
 *     `createLink`, insert `<a>` at a collapsed caret, the URL as the text);
 *   - editing link / event / asset fields and asserting the emitted value;
 *   - the description subtitle, the richText open-init effect and the value reset.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FeedbackEditorModal } from "../feedback-editor-modal";
import type { FeedbackEditorValue } from "../feedback-editor-modal";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function baseValue(overrides: Partial<FeedbackEditorValue> = {}): FeedbackEditorValue {
  return { format: "plain", text: "", links: [], assets: [], ...overrides };
}

function renderModal(props: Partial<Parameters<typeof FeedbackEditorModal>[0]> = {}) {
  const onCancel = vi.fn();
  const onSave = vi.fn();
  render(
    <FeedbackEditorModal
      open
      title="Обратная связь"
      value={baseValue()}
      onCancel={onCancel}
      onSave={onSave}
      {...props}
    />,
  );
  return { onCancel, onSave };
}

// ─── Formatted editor + link-insert (execCommand-backed) ───────────────────────

describe("<FeedbackEditorModal /> — formatted editing", () => {
  let execCommandMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    execCommandMock = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, "execCommand", { value: execCommandMock, configurable: true, writable: true });
  });
  afterEach(() => {
    Object.defineProperty(document, "execCommand", { value: undefined, configurable: true, writable: true });
    window.getSelection()?.removeAllRanges();
  });

  it("bold / italic toolbar buttons run the matching execCommand", () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    fireEvent.click(screen.getByRole("button", { name: "Полужирный" }));
    expect(execCommandMock).toHaveBeenCalledWith("bold", false, undefined);
    fireEvent.click(screen.getByRole("button", { name: "Курсив" }));
    expect(execCommandMock).toHaveBeenCalledWith("italic", false, undefined);
  });

  it("typing into the area feeds the draft text emitted on save", () => {
    const { onSave } = renderModal({ value: baseValue({ format: "richText" }) });
    const area = screen.getByTestId("feedback-editor-text-area");
    area.innerHTML = "<b>bold</b>";
    fireEvent.input(area);
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ text: "<b>bold</b>" }));
  });

  it("wraps an existing selection via createLink on submit", async () => {
    renderModal({ value: baseValue({ format: "richText", text: "<p>hello</p>" }) });
    const area = screen.getByTestId("feedback-editor-text-area");
    const range = document.createRange();
    range.selectNodeContents(area);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    fireEvent.click(screen.getByRole("button", { name: "Ссылка" }));
    // The selected text is offered as the link text.
    expect(((await screen.findByTestId("rte-link-text")) as HTMLInputElement).value).toBe("hello");
    fireEvent.change(screen.getByTestId("rte-link-url"), { target: { value: "https://a.b" } });
    fireEvent.click(screen.getByTestId("rte-link-submit"));

    await waitFor(() => expect(execCommandMock).toHaveBeenCalledWith("createLink", false, "https://a.b"));
    expect(screen.queryByTestId("rte-link-url")).not.toBeInTheDocument();
  });

  it("types the given text at a collapsed caret and turns it into a link", async () => {
    renderModal({ value: baseValue({ format: "richText", text: "<p>abc</p>" }) });
    const area = screen.getByTestId("feedback-editor-text-area");
    const range = document.createRange();
    range.setStart(area.querySelector("p")!.firstChild!, 1);
    range.collapse(true);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);

    fireEvent.click(screen.getByRole("button", { name: "Ссылка" }));
    fireEvent.change(await screen.findByTestId("rte-link-url"), { target: { value: "https://x.y" } });
    fireEvent.change(screen.getByTestId("rte-link-text"), { target: { value: "Link" } });
    fireEvent.click(screen.getByTestId("rte-link-submit"));

    await waitFor(() => expect(execCommandMock).toHaveBeenCalledWith("createLink", false, "https://x.y"));
    expect(execCommandMock).toHaveBeenCalledWith("insertText", false, "Link");
  });

  it("uses the URL as the link text when the text field is left empty", async () => {
    renderModal({ value: baseValue({ format: "richText" }) });
    window.getSelection()?.removeAllRanges();

    fireEvent.click(screen.getByRole("button", { name: "Ссылка" }));
    fireEvent.change(await screen.findByTestId("rte-link-url"), { target: { value: "https://z.z" } });
    fireEvent.click(screen.getByTestId("rte-link-submit"));

    await waitFor(() => expect(execCommandMock).toHaveBeenCalledWith("createLink", false, "https://z.z"));
    expect(execCommandMock).toHaveBeenCalledWith("insertText", false, "https://z.z");
  });

  it("initializes the area with the incoming text on open", () => {
    renderModal({ value: baseValue({ format: "richText", text: "<p>привет</p>" }) });
    expect(screen.getByTestId("feedback-editor-text-area").innerHTML).toContain("привет");
  });
});

// ─── Field editing → emitted value ─────────────────────────────────────────────

describe("<FeedbackEditorModal /> — field editing", () => {
  it("edits a link title + url and emits them", () => {
    const { onSave } = renderModal({ value: baseValue({ links: [{ title: "", url: "" }] }) });
    fireEvent.change(screen.getByTestId("feedback-editor-link-title-0"), { target: { value: "Курс 1" } });
    fireEvent.change(screen.getByTestId("feedback-editor-link-url-0"), { target: { value: "https://c.1" } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ links: [{ title: "Курс 1", url: "https://c.1" }] }),
    );
  });

  it("edits an event title + url and emits them", () => {
    const { onSave } = renderModal({ value: baseValue({ events: [{ title: "", url: "" }] }) });
    fireEvent.change(screen.getByTestId("feedback-editor-event-title-0"), { target: { value: "Митап" } });
    fireEvent.change(screen.getByTestId("feedback-editor-event-url-0"), { target: { value: "https://m" } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ events: [{ title: "Митап", url: "https://m" }] }),
    );
  });

  it("edits an asset title and emits it (UI-only fields stripped)", () => {
    const { onSave } = renderModal({
      value: baseValue({ assets: [{ title: "Old", fileName: "d.pdf", mimeType: "application/pdf" }] }),
    });
    fireEvent.change(screen.getByTestId("feedback-editor-asset-title-0"), { target: { value: "New" } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ assets: [expect.objectContaining({ title: "New", fileName: "d.pdf" })] }),
    );
  });
});

// ─── Misc props / lifecycle ────────────────────────────────────────────────────

describe("<FeedbackEditorModal /> — misc", () => {
  it("renders the description subtitle", () => {
    renderModal({ description: "Подсказка для автора" });
    expect(screen.getByText("Подсказка для автора")).toBeInTheDocument();
  });

  it("resets the draft when a new value prop is supplied", () => {
    const { rerender } = render(
      <FeedbackEditorModal open title="T" value={baseValue({ text: "A" })} onCancel={vi.fn()} onSave={vi.fn()} />,
    );
    expect((screen.getByTestId("feedback-editor-text-input") as HTMLTextAreaElement).value).toBe("A");
    rerender(
      <FeedbackEditorModal open title="T" value={baseValue({ text: "B" })} onCancel={vi.fn()} onSave={vi.fn()} />,
    );
    expect((screen.getByTestId("feedback-editor-text-input") as HTMLTextAreaElement).value).toBe("B");
  });
});
