/**
 * @module tests/section-close-on-leave
 * @description PRD-67 «Закрывать раздел при выходе» — выпечка настройки в SCORM-пакет.
 *
 * Настройка выпекается в `TEST_DATA` ТОЛЬКО когда включена: рантайм читает отсутствие поля
 * как прежнее поведение (выход замораживает время раздела), поэтому пакет теста, который
 * настройки не касался, остаётся байт-в-байт прежним.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../server/scorm/builders/test-json";

const baseTest = {
  id: "t1",
  title: "Тест",
  description: null,
  mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  feedbackJson: null,
  timeLimitMinutes: 30,
  maxAttempts: 3,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

function fixture(closeSectionOnLeave?: boolean) {
  return {
    test: {
      ...baseTest,
      ...(closeSectionOnLeave === undefined ? {} : { closeSectionOnLeave }),
    },
    sections: [
      {
        id: "sec-1", topicId: "t1", drawCount: 1, required: true, feedbackJson: null,
        topic: { id: "t1", name: "Тема", feedback: null, feedbackJson: null },
        questions: [
          { id: "q1", type: "single", prompt: "?", dataJson: {}, correctJson: { correctIndex: 0 },
            points: 1, difficulty: 50, tags: [] },
        ],
        courses: [], events: [],
      },
    ],
  } as never;
}

const bake = (data: unknown): Record<string, unknown> => JSON.parse(buildTestJson(data as never));

describe("PRD-67: выпечка настройки в пакет", () => {
  it("включённая настройка уезжает в TEST_DATA", () => {
    expect(bake(fixture(true)).closeSectionOnLeave).toBe(true);
  });

  it("выключенная и отсутствующая не выпекаются — пакет прежний", () => {
    expect("closeSectionOnLeave" in bake(fixture(false))).toBe(false);
    expect("closeSectionOnLeave" in bake(fixture())).toBe(false);
  });
});
