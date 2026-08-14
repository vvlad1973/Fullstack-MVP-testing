/**
 * @module tests/breakdown-adaptive
 * @description PRD-50 FR-17: разрезы считаются и в адаптивном режиме. До этой работы
 * `adaptiveResultAsStandard` их не считал, а теги адаптивных вопросов уже выпекались в
 * каждый пакет и никем не читались.
 */
import { describe, it, expect } from "vitest";
import { adaptiveResultAsStandard, type AdaptiveResult } from "../shared/scoring/aggregate";
import { TEST_SCOPE, sectionScope } from "../shared/breakdown/compute";
import type { BreakdownItem } from "../shared/breakdown/types";
import { adaptiveAttemptResultSchema } from "../shared/schema";

const topic = (topicId: string, answered: number, correct: number) => ({
  topicId,
  topicName: topicId,
  achievedLevelIndex: 0,
  achievedLevelName: "Базовый",
  levelPercent: 100,
  totalQuestionsAnswered: answered,
  totalCorrect: correct,
  levelsAttempted: [],
  feedback: null,
  recommendedLinks: [],
});

const result = {
  mode: "adaptive" as const,
  overallPassed: true,
  topicResults: [topic("law", 2, 1), topic("sec", 1, 1)],
} as AdaptiveResult;

const item = (sectionId: string, tags: string[], earned: number): BreakdownItem => ({
  sectionId, axisKeys: { tag: tags }, earned, possible: 1, answered: true,
});

describe("adaptiveResultAsStandard + разрезы", () => {
  it("без элементов даёт пустые списки и прежний пересказ (обратная совместимость)", () => {
    const flat = adaptiveResultAsStandard(result);
    expect(flat.breakdowns).toEqual([]);
    expect(flat.topicResults.map((t) => t.breakdown)).toEqual([[], []]);
    expect(flat.percent).toBe((2 / 3) * 100);
  });

  it("кладёт записи раздела на тему, записи теста — в результат", () => {
    const flat = adaptiveResultAsStandard(result, [
      item("law", ["ПДн"], 1),
      item("law", ["ПДн"], 0),
      item("sec", ["ПДн"], 1),
    ]);
    expect(flat.topicResults[0].breakdown).toEqual([
      expect.objectContaining({ scope: sectionScope("law"), key: "ПДн", items: 2, percentUnits: 50 }),
    ]);
    expect(flat.topicResults[1].breakdown).toEqual([
      expect.objectContaining({ scope: sectionScope("sec"), key: "ПДн", items: 1, percentUnits: 100 }),
    ]);
    expect(flat.breakdowns).toEqual([
      expect.objectContaining({ scope: TEST_SCOPE, key: "ПДн", items: 3, percentUnits: (2 / 3) * 100 }),
    ]);
  });

  it("тема без единого тега получает пустой список, а не отсутствующее поле", () => {
    const flat = adaptiveResultAsStandard(result, [item("law", ["ПДн"], 1)]);
    expect(flat.topicResults[1].breakdown).toEqual([]);
  });
});

describe("хранение адаптивного результата", () => {
  const topicRow = {
    topicId: "law", topicName: "Право", achievedLevelIndex: 0, achievedLevelName: "Базовый",
    levelPercent: 100, totalQuestionsAnswered: 2, totalCorrect: 1, levelsAttempted: [],
    feedback: null, recommendedLinks: [],
  };
  const entry = {
    scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1,
    possible: 2, unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50,
  };

  it("тема несёт свои записи, результат — записи области теста", () => {
    const parsed = adaptiveAttemptResultSchema.parse({
      mode: "adaptive", overallPassed: true,
      topicResults: [{ ...topicRow, breakdown: [entry] }],
      breakdowns: [{ ...entry, scope: "test" }],
    });
    expect(parsed.topicResults[0].breakdown).toHaveLength(1);
    expect(parsed.breakdowns).toHaveLength(1);
  });

  it("адаптивная попытка, завершённая до этой работы, остаётся валидной", () => {
    const parsed = adaptiveAttemptResultSchema.parse({
      mode: "adaptive", overallPassed: true, topicResults: [topicRow],
    });
    expect(parsed.topicResults[0].breakdown).toEqual([]);
    expect(parsed.breakdowns).toBeUndefined();
  });
});
