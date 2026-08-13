// @vitest-environment node
/**
 * @module server/scorm/__tests__/test-json-prd50
 * @description PRD-50 FR-15/FR-17: теги вопроса доезжают до пакета и для адаптивных
 * разделов — без них разрез в адаптивном режиме посчитать нечем.
 */
import { describe, it, expect } from "vitest";
import { buildTestJson } from "../builders/test-json";

const baseTest = {
  id: "t1",
  title: "Маслач",
  description: null,
  mode: "adaptive",
  overallPassRuleJson: { type: "percent", value: 70 },
  webhookUrl: null,
  feedback: null,
  feedbackJson: null,
  timeLimitMinutes: null,
  maxAttempts: null,
  showCorrectAnswers: false,
  startPageContent: null,
  showDifficultyLevel: true,
};

/** Parse the baked TEST_DATA (buildTestJson returns the serialized JSON). */
function bake(data: unknown): any {
  return JSON.parse(buildTestJson(data as never));
}

function adaptiveFixtureWithTaggedQuestion() {
  return {
    test: baseTest,
    sections: [
      {
        id: "sec-1",
        topicId: "t1",
        drawCount: 1,
        required: true,
        feedbackJson: null,
        topic: { id: "t1", name: "Право", feedback: null, feedbackJson: null },
        questions: [
          {
            id: "q1",
            type: "single",
            prompt: "?",
            dataJson: {},
            correctJson: { correctIndex: 0 },
            points: 1,
            difficulty: 50,
            tags: ["ПДн"],
          },
        ],
        courses: [],
        events: [],
      },
    ],
    adaptiveSettings: { topicSettings: [], levels: [] },
  } as never;
}

describe("buildTestJson: теги адаптивных разделов", () => {
  it("выпекает tags у вопроса адаптивного раздела", () => {
    const json = bake(adaptiveFixtureWithTaggedQuestion());
    expect(json.adaptiveTopics[0].questions[0].tags).toEqual(["ПДн"]);
  });
});
