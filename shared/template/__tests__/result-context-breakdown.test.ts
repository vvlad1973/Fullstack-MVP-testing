/**
 * @module shared/template/__tests__/result-context-breakdown
 * @description PRD-50 FR-31 - FR-33: breakdown rows inside the topic card, hidden unless
 * the author turned them on.
 */
import { describe, it, expect } from "vitest";
import { buildResultContext } from "../result-context";

const topic = {
  topicName: "Право", correct: 1, total: 2, percent: 50, earnedPoints: 1, possiblePoints: 2,
  passed: false,
  breakdown: [
    { scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
      unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 40 },
  ],
};
const result = { passed: false, percent: 50, totalQuestions: 2, correct: 1,
  earnedPoints: 1, possiblePoints: 2, topicResults: [topic] };

describe("разрез в карточке темы", () => {
  it("при hidden полос нет", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "hidden", basis: "units" },
    } as never);
    expect((ctx.result.topicResults![0] as never as { breakdown?: unknown[] }).breakdown).toBeUndefined();
  });

  it("при bar печатает полосу по нормированной базе и без числа", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar", basis: "units" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ key: "ПДн", barPercent: 40, showValue: false });
  });

  it("при bar_and_value и базе points печатает балльный процент", () => {
    const ctx = buildResultContext(result as never, "Тест", {
      breakdownDisplay: { visibility: "bar_and_value", basis: "points" },
    } as never);
    const rows = (ctx.result.topicResults![0] as never as { breakdown: Array<Record<string, unknown>> }).breakdown;
    expect(rows[0]).toMatchObject({ barPercent: 50, showValue: true, valueLabel: "50 %" });
  });
});
