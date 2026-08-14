/**
 * @module tests/breakdown-rules-schema
 * @description PRD-50 FR-09/FR-10: пороги ключей — своя структура раздела, отдельная от
 * квот выдачи. Схема принимает форму из §4 спеки и отбивает всё остальное.
 */
import { describe, it, expect } from "vitest";
import { breakdownRulesSchema } from "../shared/schema";

describe("breakdownRulesSchema", () => {
  it("принимает форму из §4 спеки", () => {
    const parsed = breakdownRulesSchema.parse({
      axis: "tag",
      default: { type: "percent", value: 60 },
      keys: {
        "Персональные данные": { type: "percent", value: 80 },
        "Антикоррупционная политика": { type: "none" },
      },
    });
    expect(parsed.keys!["Персональные данные"]).toEqual({ type: "percent", value: 80 });
  });

  it("принимает правила без умолчания и без ключей", () => {
    expect(breakdownRulesSchema.parse({ axis: "tag" })).toEqual({ axis: "tag" });
  });

  it("не принимает другую ось: в этой редакции зарегистрирован только тег (FR-06)", () => {
    expect(breakdownRulesSchema.safeParse({ axis: "difficulty" }).success).toBe(false);
  });

  it("не принимает процент вне 0..100 и порог неизвестного вида", () => {
    expect(
      breakdownRulesSchema.safeParse({ axis: "tag", default: { type: "percent", value: 140 } }).success,
    ).toBe(false);
    expect(
      breakdownRulesSchema.safeParse({ axis: "tag", keys: { a: { type: "count", value: 2 } } }).success,
    ).toBe(false);
  });
});
