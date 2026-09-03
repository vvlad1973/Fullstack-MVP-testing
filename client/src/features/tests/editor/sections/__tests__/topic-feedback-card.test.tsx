/**
 * @module features/tests/editor/sections/__tests__/topic-feedback-card.test
 * @description PRD-29 §7.1a: карточка «По темам» показывает РАЗРЕШЁННЫЙ текст — один на
 * тему, с источником, — правит его на уровне теста и умеет сбросить до текста темы.
 */
import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TopicFeedbackCard } from "../topic-feedback-card";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";

const TOPICS = [
  {
    id: "law",
    name: "Право",
    feedbackJson: { format: "plain", text: "Текст самой темы", links: [], assets: [], events: [] },
  },
  { id: "hist", name: "История", feedbackJson: null, feedback: "Легаси-текст темы" },
];

function section(topicId: string, topicName: string, own = "") {
  return {
    topicId,
    topicName,
    maxQuestions: 10,
    drawCount: 2,
    drawAll: false,
    required: false,
    timeLimit: { source: "inherit_test" as const },
    feedback: { format: "plain" as const, text: own },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
  };
}

function baseModel(sections: ReturnType<typeof section>[]): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_by_topics",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Тест",
      description: "",
      status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [],
      feedbackAssets: [],
      feedbackEvents: [],
      webhookUrl: "",
      telemetryEnabled: false,
    },
    runtime: {
      timeLimitMinutes: null,
      maxAttempts: null,
      showCorrectAnswers: false,
      allowReturnToUnanswered: true,
      allowAnswerChange: false,
      quickAdvance: false,
      showSectionResults: true,
      skipReviewWhenComplete: false,
      copyProtection: true,
      protectionWatermark: false,
      protectionHideOnBlur: false,
      lmsAttemptResult: "best" as const,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections,
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
  } as TestEditorModel;
}

function render(model: TestEditorModel, updateModel: (u: (m: TestEditorModel) => TestEditorModel) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["/api/topics"], TOPICS);
  return rtlRender(
    <QueryClientProvider client={client}>
      <TopicFeedbackCard model={model} updateModel={updateModel} />
    </QueryClientProvider>,
  );
}

const runUpdater = (fn: ReturnType<typeof vi.fn>, model: TestEditorModel) =>
  (fn.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);

describe("<TopicFeedbackCard />", () => {
  it("без своей правки печатает текст ТЕМЫ и называет источник", () => {
    render(baseModel([section("law", "Право")]));
    expect(screen.getByTestId("topic-feedback-law-source")).toHaveTextContent("Из темы");
    expect(screen.getByTestId("topic-feedback-law")).toHaveTextContent("Текст самой темы");
    // Сбрасывать нечего — кнопки нет.
    expect(screen.queryByTestId("topic-feedback-law-reset")).toBeNull();
  });

  it("своя правка теста ЗАМЕНЯЕТ текст темы, а не дописывается к нему", () => {
    render(baseModel([section("law", "Право", "Текст этого теста")]));
    expect(screen.getByTestId("topic-feedback-law-source")).toHaveTextContent("Задано в этом тесте");
    const preview = screen.getByTestId("topic-feedback-law");
    expect(preview).toHaveTextContent("Текст этого теста");
    expect(preview).not.toHaveTextContent("Текст самой темы");
  });

  it("читает легаси-колонку темы, когда feedback_json пуст", () => {
    render(baseModel([section("hist", "История")]));
    expect(screen.getByTestId("topic-feedback-hist")).toHaveTextContent("Легаси-текст темы");
  });

  it("правка сохраняется в РАЗДЕЛ теста, а не в тему", () => {
    const updateModel = vi.fn();
    const model = baseModel([section("law", "Право")]);
    render(model, updateModel);
    // Предпросмотр не пуст (пришёл текст темы) — правку открывает карандаш.
    fireEvent.click(screen.getByTestId("topic-feedback-law-edit"));
    fireEvent.change(screen.getByTestId("feedback-editor-text"), {
      target: { value: "Своя формулировка" },
    });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    expect(runUpdater(updateModel, model).sections[0].feedback.text).toBe("Своя формулировка");
  });

  it("«Сбросить до установок темы» снимает правку теста", () => {
    const updateModel = vi.fn();
    const model = baseModel([section("law", "Право", "Текст этого теста")]);
    render(model, updateModel);
    fireEvent.click(screen.getByTestId("topic-feedback-law-reset"));
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].feedback.text).toBe("");
    expect(next.sections[0].feedbackLinks).toEqual([]);
  });

  it("тест без тем объясняет, где их заводят", () => {
    render(baseModel([]));
    expect(screen.getByTestId("topic-feedback-no-topics")).toBeInTheDocument();
  });
});
