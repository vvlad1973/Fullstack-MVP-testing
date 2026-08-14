/**
 * @module tests/breakdown-gate
 * @description PRD-50 FR-19 - FR-23: тема пройдена, когда выполнен порог раздела И все
 * заданные пороги её ключей. Порог всегда в баллах, ключ без выдачи вердикт не роняет,
 * в области теста гейта нет.
 */
import { describe, it, expect } from "vitest";
import { aggregateStandardResult, type AggregateSection } from "../shared/scoring/aggregate";
import { applyBreakdownGate, resolveBreakdownRules } from "../shared/scoring/pass-rule";
import type { BreakdownEntry } from "../shared/breakdown/types";

/** Один вопрос: цена `points`, ответ верен при `ok`. */
const q = (ok: boolean, tags: string[] | null, points = 1) => ({
  type: "single" as const,
  correct: { correctIndex: 0 },
  scoring: null,
  points,
  answer: ok ? 0 : 1,
  ...(tags ? { axisKeys: { tag: tags } } : {}),
});

const section = (
  topicId: string,
  questions: AggregateSection["questions"],
  extra: Partial<AggregateSection> = {},
): AggregateSection => ({
  topicId,
  topicName: topicId,
  topicPassRule: null,
  questions,
  ...extra,
});

const entry = (key: string, percentPoints: number, items = 1): BreakdownEntry => ({
  scope: "section:law",
  axis: "tag",
  key,
  items,
  answered: items,
  earned: percentPoints / 100,
  possible: 1,
  unitEarned: percentPoints / 100,
  unitPossible: items,
  percentPoints,
  percentUnits: percentPoints,
});

describe("resolveBreakdownRules", () => {
  it("пустые и неопознанные правила означают отсутствие гейта", () => {
    expect(resolveBreakdownRules(null)).toBeNull();
    expect(resolveBreakdownRules({ axis: "tag" })).toBeNull();
    expect(resolveBreakdownRules("нет")).toBeNull();
  });

  it("явный «none» у ключа перебивает умолчание (FR-20)", () => {
    const rules = resolveBreakdownRules({
      axis: "tag",
      default: { type: "percent", value: 60 },
      keys: { "ПДн": { type: "none" } },
    });
    expect(rules).not.toBeNull();
    expect(rules!.byKey.get("ПДн")).toBeNull();
    expect(rules!.fallback).toBe(60);
  });
});

describe("applyBreakdownGate", () => {
  it("проставляет вердикт каждой записи и отвечает за раздел", () => {
    const rows = [entry("ПДн", 80), entry("Коррупция", 40)];
    const verdict = applyBreakdownGate(rows, { axis: "tag", default: { type: "percent", value: 60 } });
    expect(rows.map((r) => r.passed)).toEqual([true, false]);
    expect(verdict).toBe(false);
  });

  it("ключ без выданных вопросов не проверяется и вердикт не роняет (FR-22)", () => {
    const rows = [entry("ПДн", 0, 0)];
    const verdict = applyBreakdownGate(rows, { axis: "tag", default: { type: "percent", value: 60 } });
    expect(rows[0].passed).toBeNull();
    expect(verdict).toBeNull();
  });

  it("правил нет — ни одной пометки и ни одного гейта", () => {
    const rows = [entry("ПДн", 10)];
    expect(applyBreakdownGate(rows, null)).toBeNull();
    expect(rows[0].passed).toBeNull();
  });
});

describe("aggregateStandardResult + гейт по ключам", () => {
  it("порог ключа роняет тему, у которой порог раздела выполнен (FR-19)", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(true, ["ПДн"]), q(true, ["ПДн"]), q(false, ["Коррупция"]), q(true, ["Коррупция"])], {
          topicPassRule: { source: "custom", type: "percent", value: 70 },
          breakdownRules: { axis: "tag", keys: { "Коррупция": { type: "percent", value: 80 } } },
        }),
      ],
      overallPassRule: { type: "percent", value: 70 },
    });
    expect(agg.topicResults[0].percent).toBe(75);
    expect(agg.topicResults[0].passed).toBe(false);
    const rows = agg.topicResults[0].breakdown;
    expect(rows.find((r) => r.key === "ПДн")!.passed).toBeNull();
    expect(rows.find((r) => r.key === "Коррупция")!.passed).toBe(false);
  });

  it("порог сравнивается с балльной долей, а не с долей вопросов (FR-21)", () => {
    // Дешёвый вопрос верен, дорогой — нет: доля вопросов 50 %, доля баллов 25 %.
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(true, ["ПДн"], 1), q(false, ["ПДн"], 3)], {
          breakdownRules: { axis: "tag", default: { type: "percent", value: 40 } },
        }),
      ],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].breakdown[0].percentUnits).toBe(50);
    expect(agg.topicResults[0].breakdown[0].percentPoints).toBe(25);
    expect(agg.topicResults[0].passed).toBe(false);
  });

  it("тема без правила раздела становится оцениваемой по одним ключам", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(true, ["ПДн"]), q(true, ["ПДн"])], {
          breakdownRules: { axis: "tag", default: { type: "percent", value: 60 } },
        }),
      ],
      overallPassRule: null,
    });
    expect(agg.topicResults[0].passed).toBe(true);
  });

  it("в области теста гейта нет (FR-23)", () => {
    const agg = aggregateStandardResult({
      sections: [
        section("law", [q(false, ["ПДн"])], {
          breakdownRules: { axis: "tag", default: { type: "percent", value: 60 } },
        }),
      ],
      overallPassRule: null,
    });
    expect(agg.breakdowns[0].passed ?? null).toBeNull();
  });

  it("раздел без правил ведёт себя ровно как до Э2", () => {
    const agg = aggregateStandardResult({
      sections: [section("law", [q(false, ["ПДн"])], { topicPassRule: { source: "none" } })],
      overallPassRule: { type: "percent", value: 70 },
    });
    expect(agg.topicResults[0].passed).toBeNull();
    expect(agg.topicResults[0].breakdown[0].passed ?? null).toBeNull();
  });
});
