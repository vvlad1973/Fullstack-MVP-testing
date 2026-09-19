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
function Harness({
  initial,
  onSave,
  maxLength,
  onMaxLength,
}: {
  initial: AnswerRuleSet | null;
  onSave?: (set: AnswerRuleSet) => void;
  maxLength?: number;
  onMaxLength?: (value: number | undefined) => void;
}) {
  const [draft, setDraft] = useState<AnswerRulesDraft>(() => createDraft(initial));
  const [limit, setLimit] = useState<number | undefined>(maxLength);
  return (
    <>
      <AnswerRulesBlock
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          onSave?.(toCorrectJson(next));
        }}
        maxLength={limit}
        onMaxLength={(value) => {
          setLimit(value);
          onMaxLength?.(value);
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

  it("у сохранённого без правил вопроса автопроверка выключена и список скрыт", () => {
    render(<Harness initial={{ answerKind: "text", join: "any", rules: [] }} />);
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

  it("предел длины вводится и отдаётся наверх", () => {
    const seen: (number | undefined)[] = [];
    render(<Harness initial={TEXT_SET} maxLength={40} onMaxLength={(n) => seen.push(n)} />);
    const input = screen.getByTestId("answer-rules-max-length") as HTMLInputElement;
    expect(input.value).toBe("40");
    fireEvent.change(input, { target: { value: "25" } });
    expect(seen.at(-1)).toBe(25);
    cleanup();
  });

  it("пустое поле означает системный предел, а не ноль", () => {
    const seen: (number | undefined)[] = [];
    render(<Harness initial={TEXT_SET} maxLength={40} onMaxLength={(n) => seen.push(n)} />);
    fireEvent.change(screen.getByTestId("answer-rules-max-length"), { target: { value: "" } });
    expect(seen.at(-1)).toBeUndefined();
    cleanup();
  });
});

const NUMBER_SET: AnswerRuleSet = {
  answerKind: "number",
  join: "any",
  unit: "°C",
  rules: [{ kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } }],
};

/** Раскрыть список оператора первого правила и вернуть его пункты. */
function openOperatorMenu(): HTMLElement[] {
  const trigger = screen.getByTestId("answer-rules-operator-0").querySelector("button");
  fireEvent.click(trigger as HTMLButtonElement);
  return screen.getAllByRole("option");
}

describe("AnswerRulesBlock — числовое правило (PRD-57 §6.6)", () => {
  it("свёрнутая строка называет оператор, значение, единицу и допуск", () => {
    render(<Harness initial={NUMBER_SET} />);
    expect(screen.getByText("равно -25 °C ±2")).toBeTruthy();
    cleanup();
  });

  it("список сравнений открыт и содержит шесть операторов в порядке эскиза", () => {
    render(<Harness initial={NUMBER_SET} />);
    const labels = openOperatorMenu().map((option) => option.textContent);
    expect(labels).toEqual([
      "равно",
      "не равно",
      "больше",
      "больше или равно",
      "меньше",
      "меньше или равно",
    ]);
    cleanup();
  });

  it("у границы поля допуска нет — там он ничего не значит", () => {
    const saved: AnswerRuleSet[] = [];
    render(<Harness initial={NUMBER_SET} onSave={(s) => saved.push(s)} />);
    expect(screen.getByTestId("answer-rules-tolerance-value")).toBeTruthy();
    fireEvent.click(openOperatorMenu()[3]);
    expect((saved.at(-1)?.rules[0] as { op: string }).op).toBe("gte");
    expect(screen.queryByTestId("answer-rules-tolerance-value")).toBeNull();
    cleanup();
  });

  it("значение принимает обыкновенную дробь", () => {
    const saved: AnswerRuleSet[] = [];
    render(<Harness initial={NUMBER_SET} onSave={(s) => saved.push(s)} />);
    fireEvent.change(screen.getByTestId("answer-rules-number-value"), { target: { value: "1/3" } });
    expect((saved.at(-1)?.rules[0] as { value: number }).value).toBeCloseTo(1 / 3, 12);
    cleanup();
  });

  it("недобранное значение не обнуляет правило", () => {
    // «1/» посреди набора — это ещё не число; правило обязано сохранить прежнее
    // значение, а поле — то, что автор печатает.
    const saved: AnswerRuleSet[] = [];
    render(<Harness initial={NUMBER_SET} onSave={(s) => saved.push(s)} />);
    const input = screen.getByTestId("answer-rules-number-value") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "1/" } });
    expect(input.value).toBe("1/");
    expect((saved.at(-1)?.rules[0] as { value: number } | undefined)?.value ?? -25).toBe(-25);
    cleanup();
  });

  it("под условием стоит расшифровка словами (FR-28aa2)", () => {
    render(<Harness initial={NUMBER_SET} />);
    expect(screen.getByText("Засчитывается ответ от -27 до -23 °C")).toBeTruthy();
    cleanup();
  });
});
