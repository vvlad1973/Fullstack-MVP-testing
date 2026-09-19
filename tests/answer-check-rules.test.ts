import { describe, it, expect } from "vitest";
import { checkRuleSet, hasRules, type AnswerRuleSet } from "../shared/answer-check/rules";

const textSet = (join: "any" | "all", values: string[]): AnswerRuleSet => ({
  answerKind: "text",
  join,
  rules: values.map((value) => ({ kind: "text", match: "wildcard", value })),
});

describe("checkRuleSet — текст", () => {
  it("связка «любое» зачитывает по одному выполненному правилу", () => {
    const set = textSet("any", ["Ростехнадзор", "РТН"]);
    expect(checkRuleSet(set, "ртн")).toEqual({ passed: true, perRule: [false, true] });
  });

  it("связка «все» требует каждого", () => {
    const set = textSet("all", ["*надзор*", "*ростех*"]);
    expect(checkRuleSet(set, "ростехнадзор")).toEqual({ passed: true, perRule: [true, true] });
    expect(checkRuleSet(set, "госнадзор")).toEqual({ passed: false, perRule: [true, false] });
  });

  it("нормализует обе стороны", () => {
    const set = textSet("any", ["  Приём  "]);
    expect(checkRuleSet(set, "прием").passed).toBe(true);
  });

  it("подстановочный знак работает после нормализации", () => {
    const set = textSet("any", ["Федеральная служба по * надзору"]);
    const answer = "федеральная служба по экологическому, технологическому и атомному надзору";
    expect(checkRuleSet(set, answer).passed).toBe(true);
  });

  it("режим regex не зачитывается на этом этапе", () => {
    const set: AnswerRuleSet = {
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "regex", value: "^рос" }],
    };
    expect(checkRuleSet(set, "ростехнадзор")).toEqual({ passed: false, perRule: [false] });
  });
});

describe("checkRuleSet — число", () => {
  const set: AnswerRuleSet = {
    answerKind: "number",
    join: "any",
    rules: [{ kind: "number", op: "eq", value: 3.14, tolerance: { unit: "abs", value: 0.01 } }],
  };

  it("зачитывает по допуску, а не по написанию", () => {
    expect(checkRuleSet(set, "3,14").passed).toBe(true);
    expect(checkRuleSet(set, "3.1416").passed).toBe(true);
    expect(checkRuleSet(set, "3,2").passed).toBe(false);
  });

  it("нечисловой ответ не выполняет ни одного правила", () => {
    expect(checkRuleSet(set, "около трёх")).toEqual({ passed: false, perRule: [false] });
  });
});

describe("пустой набор", () => {
  const empty: AnswerRuleSet = { answerKind: "text", join: "any", rules: [] };

  it("не зачитывает ничего", () => {
    expect(checkRuleSet(empty, "что угодно")).toEqual({ passed: false, perRule: [] });
  });

  it("распознаётся как отсутствие правил", () => {
    expect(hasRules(empty)).toBe(false);
    expect(hasRules(textSet("any", ["РТН"]))).toBe(true);
    expect(hasRules(null)).toBe(false);
    expect(hasRules({} as AnswerRuleSet)).toBe(false);
  });
});

describe("пустой ответ", () => {
  it("не зачитывается даже образцом из звезды", () => {
    expect(checkRuleSet(textSet("any", ["*"]), "").passed).toBe(false);
    expect(checkRuleSet(textSet("any", ["*"]), "   ").passed).toBe(false);
  });
});
