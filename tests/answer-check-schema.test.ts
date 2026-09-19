import { describe, it, expect } from "vitest";
import { answerRuleSetSchema, shortAnswerDataSchema } from "../shared/schema";

describe("answerRuleSetSchema", () => {
  it("принимает текстовый набор", () => {
    const parsed = answerRuleSetSchema.parse({
      answerKind: "text",
      join: "any",
      rules: [{ kind: "text", match: "wildcard", value: "Ростехнадзор" }],
    });
    expect(parsed.rules).toHaveLength(1);
  });

  it("принимает числовой набор с допуском и единицей", () => {
    const parsed = answerRuleSetSchema.parse({
      answerKind: "number",
      join: "all",
      unit: "°C",
      rules: [{ kind: "number", op: "eq", value: -25, tolerance: { unit: "abs", value: 2 } }],
    });
    expect(parsed.unit).toBe("°C");
  });

  it("принимает пустой набор — правил ещё нет", () => {
    expect(answerRuleSetSchema.parse({ answerKind: "text", join: "any", rules: [] }).rules).toEqual([]);
  });

  it("не принимает regex до Э7", () => {
    const bad = { answerKind: "text", join: "any", rules: [{ kind: "text", match: "regex", value: "^рос" }] };
    expect(() => answerRuleSetSchema.parse(bad)).toThrow();
  });

  it("не принимает операторов сверх «равно» до Э5", () => {
    const bad = { answerKind: "number", join: "any", rules: [{ kind: "number", op: "gt", value: 5 }] };
    expect(() => answerRuleSetSchema.parse(bad)).toThrow();
  });

  it("не принимает набор, где вид ответа и правило расходятся", () => {
    const bad = { answerKind: "number", join: "any", rules: [{ kind: "text", match: "wildcard", value: "пять" }] };
    expect(() => answerRuleSetSchema.parse(bad)).toThrow();
  });
});

describe("shortAnswerDataSchema", () => {
  it("принимает предел длины", () => {
    expect(shortAnswerDataSchema.parse({ maxLength: 40 }).maxLength).toBe(40);
  });

  it("принимает пустой объект — предела нет, действует системный потолок", () => {
    expect(shortAnswerDataSchema.parse({}).maxLength).toBeUndefined();
  });

  it("не принимает ноль, отрицательное и дробное", () => {
    expect(() => shortAnswerDataSchema.parse({ maxLength: 0 })).toThrow();
    expect(() => shortAnswerDataSchema.parse({ maxLength: -5 })).toThrow();
    expect(() => shortAnswerDataSchema.parse({ maxLength: 12.5 })).toThrow();
  });
});
