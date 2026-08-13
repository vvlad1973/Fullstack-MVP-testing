/**
 * @module tests/breakdown-formula-context
 * @description PRD-50 FR-35/FR-36: `tag()` and `sectionById()` stop being dead accessors.
 * Both maps used to be handed to the evaluator empty, so a formula reading them returned
 * zeros while passing validation.
 */
import { describe, it, expect } from "vitest";
import { computeAttemptResult } from "../server/services/result-compute";
import { validate } from "../shared/formula/validate";

const base = {
  percent: 50,
  topicResults: [
    { topicId: "law-id", code: "law", topicName: "Право", percent: 50, passed: false, earnedPoints: 1 },
  ],
  breakdowns: [
    { scope: "test", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
      unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50 },
    { scope: "section:law-id", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 2, possible: 2,
      unitEarned: 2, unitPossible: 2, percentPoints: 100, percentUnits: 100 },
  ],
};

const config = (formula: string) => ({
  scales: [],
  measurements: [],
  budgets: {},
  resultVariables: [{ name: "v", type: "number" as const, formula, sortOrder: 0 }],
});

describe("контекст формул", () => {
  it("tag() читает область теста", () => {
    const out = computeAttemptResult(config('tag("ПДн").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(50);
  });

  it("tag() с составным ключом читает область раздела (FR-36)", () => {
    const out = computeAttemptResult(config('tag("law::ПДн").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(100);
  });

  it("tag() с составным ключом принимает и id раздела", () => {
    const out = computeAttemptResult(config('tag("law-id::ПДн").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(100);
  });

  it("sectionById() возвращает результат темы, а не нули", () => {
    const out = computeAttemptResult(config('sectionById("law").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(50);
  });

  it("sectionById() принимает и id раздела", () => {
    const out = computeAttemptResult(config('sectionById("law-id").percent'), {}, {}, base as never);
    expect(out.resultVariables.v).toBe(50);
  });

  it("тег без разрезов остаётся нулём, а не падает", () => {
    const out = computeAttemptResult(config('tag("нет такого").percent'), {}, {}, {
      percent: 50,
      topicResults: [],
    } as never);
    expect(out.resultVariables.v).toBe(0);
  });
});

const refs = { sectionKeys: new Set(["law", "law-id"]), tagKeys: new Set(["ПДн"]) };

describe("валидатор составного ключа", () => {
  it("опечатка в разделе — ошибка", () => {
    const out = validate('tag("нет::ПДн").percent', "number", refs);
    expect(out.valid).toBe(false);
    expect(out.errors.map((e) => e.code)).toContain("unknown-section");
  });

  it("незнакомый ключ при верном разделе — только предупреждение", () => {
    const out = validate('tag("law::нет").percent', "number", refs);
    expect(out.valid).toBe(true);
    expect(out.warnings.map((w) => w.code)).toContain("tag-unresolved");
  });

  it("составной ключ целиком известен — ни ошибок, ни предупреждений", () => {
    const out = validate('tag("law::ПДн").percent', "number", refs);
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });

  it("одиночное двоеточие составным ключом не считается", () => {
    const out = validate('tag("scale:EE").count', "number", refs);
    expect(out.errors).toEqual([]);
    expect(out.warnings).toEqual([]);
  });
});
