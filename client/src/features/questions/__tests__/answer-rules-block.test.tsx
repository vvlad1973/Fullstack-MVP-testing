// @vitest-environment jsdom
/**
 * @module features/questions/answer-rules-block.test
 *
 * PRD-57 §6.1, AC-05a: the rule set is a LIST in the question drawer, the join applies to
 * the whole set, a mixed set cannot be built, and switching the answer kind keeps what
 * was typed until the question is saved.
 */

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { AnswerRulesBlock } from "../answer-rules/answer-rules-block";
import { createDraft, toCorrectJson, type AnswerRulesDraft } from "../answer-rules/answer-rules-model";
import type { AnswerRuleSet } from "@shared/answer-check";

/** Host that owns the draft, as the drawer does. */
function Harness({ initial, onSave }: { initial: AnswerRuleSet | null; onSave?: (set: AnswerRuleSet) => void }) {
  const [draft, setDraft] = useState<AnswerRulesDraft>(() => createDraft(initial));
  return (
    <>
      <AnswerRulesBlock
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          onSave?.(toCorrectJson(next));
        }}
      />
    </>
  );
}

const TEXT_SET: AnswerRuleSet = {
  answerKind: "text",
  join: "any",
  rules: [
    { kind: "text", match: "wildcard", value: "Ростехнадзор" },
    { kind: "text", match: "wildcard", value: "РТН" },
  ],
};

describe("AnswerRulesBlock", () => {
  it("показывает набор списком: свёрнутая строка называет, что правило проверяет", () => {
    render(<Harness initial={TEXT_SET} />);
    expect(screen.getByText("Ростехнадзор")).toBeTruthy();
    expect(screen.getByText("РТН")).toBeTruthy();
    expect(screen.getAllByText("Обычное сравнение").length).toBe(2);
    cleanup();
  });

  it("без правил показывает выключенную автопроверку и не показывает список", () => {
    render(<Harness initial={null} />);
    const auto = screen.getByTestId("answer-rules-autocheck") as HTMLInputElement;
    expect(auto.checked).toBe(false);
    expect(screen.queryByTestId("answer-rules-add")).toBeNull();
    cleanup();
  });

  it("связка действует на весь набор", () => {
    const saved: AnswerRuleSet[] = [];
    render(<Harness initial={TEXT_SET} onSave={(s) => saved.push(s)} />);
    fireEvent.click(screen.getByText("Все правила"));
    expect(saved.at(-1)?.join).toBe("all");
    cleanup();
  });

  it("смешанного набора завести нельзя: переключение вида меняет весь список", () => {
    const saved: AnswerRuleSet[] = [];
    render(<Harness initial={TEXT_SET} onSave={(s) => saved.push(s)} />);
    fireEvent.click(screen.getByText("Число"));
    fireEvent.click(screen.getByTestId("answer-rules-add"));
    const set = saved.at(-1);
    expect(set?.answerKind).toBe("number");
    expect(set?.rules.every((r) => r.kind === "number")).toBe(true);
    cleanup();
  });

  it("возврат к прежнему виду возвращает набранные правила целиком (FR-28d)", () => {
    const saved: AnswerRuleSet[] = [];
    render(<Harness initial={TEXT_SET} onSave={(s) => saved.push(s)} />);
    fireEvent.click(screen.getByText("Число"));
    fireEvent.click(screen.getByText("Текст"));
    expect(saved.at(-1)?.rules).toEqual(TEXT_SET.rules);
    cleanup();
  });

  it("режим регулярного выражения показан, но заперт до Э7", () => {
    render(<Harness initial={TEXT_SET} />);
    fireEvent.click(screen.getByText("Ростехнадзор"));
    // Аккордеон держит тела всех строк в DOM, поэтому переключателей столько же,
    // сколько правил: заперт обязан быть каждый.
    const modes = screen.getAllByText("Регулярное выражение");
    expect(modes.length).toBe(TEXT_SET.rules.length);
    for (const mode of modes) {
      expect((mode.closest("button") as HTMLButtonElement).disabled).toBe(true);
    }
    cleanup();
  });
});
