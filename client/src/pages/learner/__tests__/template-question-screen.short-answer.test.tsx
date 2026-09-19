// @vitest-environment jsdom
/**
 * @module client/pages/learner/template-question-screen.short-answer.test
 *
 * PRD-57 §6.5: the web host draws the typed-answer field from the SHARED renderer and
 * hands the raw string back. Both halves are checked here — the markup in the
 * interaction slot, and the answer travelling up on every keystroke, untrimmed.
 */

import { describe, it, expect, vi } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { TemplateQuestionScreen } from "../template-question-screen";
import type { Question } from "@shared/schema";

const LAYOUT = `
<div class="layout-question-wrap">
  <div class="question-card">
    <div class="question-text" data-slot="question-text"></div>
    <div data-slot="question-media"></div>
    <div data-slot="question-interaction"></div>
    <div data-slot="question-feedback"></div>
  </div>
</div>`;

const question = {
  id: "q1",
  type: "short",
  prompt: "Кто выдаёт наряд-допуск?",
  dataJson: {},
  correctJson: {
    answerKind: "text",
    join: "any",
    rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }],
  },
  mediaUrl: null,
  mediaType: null,
} as unknown as Question;

const NAV = {
  flexible: false,
  quickAdvance: true,
  committed: false,
  canPrev: false,
  answerReady: true,
  hasNext: true,
  showAccept: false,
  showReview: false,
};

const baseProps = {
  tpl: { layout: LAYOUT, css: "" },
  testTitle: "Тест",
  counterLabel: "Вопрос 1 из 1",
  progressPercent: 100,
  question,
  answer: undefined,
  shuffleMapping: undefined,
  nav: NAV,
};

function shadowOf(container: HTMLElement): ShadowRoot {
  const host = container.querySelector("[data-template-screen]") as HTMLElement;
  return host.shadowRoot as ShadowRoot;
}

describe("TemplateQuestionScreen — короткий ответ", () => {
  it("рисует одно поле ввода вместо вариантов", () => {
    const { container } = render(<TemplateQuestionScreen {...baseProps} onAnswer={() => {}} />);
    const shadow = shadowOf(container);
    expect(shadow.querySelectorAll('[data-action="short-answer"]').length).toBe(1);
    expect(shadow.querySelectorAll(".ou-radio-card").length).toBe(0);
    cleanup();
  });

  it("отдаёт набранную строку как есть", () => {
    const onAnswer = vi.fn();
    const { container } = render(<TemplateQuestionScreen {...baseProps} onAnswer={onAnswer} />);
    const input = shadowOf(container).querySelector('[data-action="short-answer"]') as HTMLInputElement;

    input.value = "  Ростехнадзор ";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onAnswer).toHaveBeenCalledWith("  Ростехнадзор ");
    cleanup();
  });

  it("показывает сохранённый ответ при возврате к вопросу", () => {
    const { container } = render(<TemplateQuestionScreen {...baseProps} answer="РТН" onAnswer={() => {}} />);
    const input = shadowOf(container).querySelector('[data-action="short-answer"]') as HTMLInputElement;
    expect(input.getAttribute("value")).toBe("РТН");
    cleanup();
  });

  it("не принимает ввод, пока ответ заперт", () => {
    const onAnswer = vi.fn();
    const { container } = render(<TemplateQuestionScreen {...baseProps} locked onAnswer={onAnswer} />);
    const input = shadowOf(container).querySelector('[data-action="short-answer"]') as HTMLInputElement;

    input.value = "поздно";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    expect(onAnswer).not.toHaveBeenCalled();
    cleanup();
  });
});
