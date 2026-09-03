/**
 * @module features/tests/editor/sections/__tests__/breakdown-feedback-card.test
 * @description PRD-50 FR-50: карточка «По подтемам (тегам)» — перечень подтем берётся из
 * вопросов темы, правка уходит в черновик раздела, стёртый текст снимает запись.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BreakdownFeedbackCard } from "../breakdown-feedback-card";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";

const QUESTIONS = [
  { id: "q1", topicId: "law", tags: ["Персональные данные"] },
  { id: "q2", topicId: "law", tags: ["Коммерческая тайна", "Персональные данные"] },
  { id: "q3", topicId: "bare", tags: [] },
];

function render(model: TestEditorModel, updateModel: (u: (m: TestEditorModel) => TestEditorModel) => void = () => {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["/api/questions"], QUESTIONS);
  return rtlRender(
    <QueryClientProvider client={client}>
      <BreakdownFeedbackCard model={model} updateModel={updateModel} />
    </QueryClientProvider>,
  );
}

function section(topicId: string, topicName: string) {
  return {
    topicId,
    topicName,
    maxQuestions: 10,
    drawCount: 2,
    drawAll: false,
    required: false,
    timeLimit: { source: "inherit_test" as const },
    feedback: { format: "plain" as const, text: "" },
    feedbackLinks: [],
    feedbackAssets: [],
    feedbackEvents: [],
    defaultPoints: null,
  };
}

function baseModel(sections: ReturnType<typeof section>[] = []): TestEditorModel {
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
      allowFreeSectionNavigation: false,
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

afterEach(() => vi.restoreAllMocks());

describe("<BreakdownFeedbackCard />", () => {
  it("перечисляет подтемы темы по тегам её вопросов", () => {
    render(baseModel([section("law", "Право")]));
    expect(screen.getByText("Право")).toBeInTheDocument();
    expect(screen.getByText("Коммерческая тайна")).toBeInTheDocument();
    expect(screen.getByText("Персональные данные")).toBeInTheDocument();
  });

  it("тема без размеченных вопросов в карточку не попадает", () => {
    render(baseModel([section("bare", "Без тегов")]));
    expect(screen.getByTestId("breakdown-feedback-no-tags")).toBeInTheDocument();
  });

  it("тест без тем объясняет, где заводят темы", () => {
    render(baseModel());
    expect(screen.getByTestId("breakdown-feedback-no-topics")).toBeInTheDocument();
  });

  it("сохранённый текст подтемы уходит в черновик раздела", () => {
    const updateModel = vi.fn();
    const model = baseModel([section("law", "Право")]);
    render(model, updateModel);
    fireEvent.click(screen.getByTestId("breakdown-feedback-law-Персональные данные"));
    fireEvent.change(screen.getByTestId("feedback-editor-text"), {
      target: { value: "Повторите тему" },
    });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    const next = (updateModel.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);
    expect(next.sections[0].breakdownFeedback).toEqual({
      "Персональные данные": {
        format: "plain",
        text: "Повторите тему",
        links: [],
        assets: [],
        events: [],
      },
    });
  });

  it("стёртый текст снимает запись, а не оставляет пустую", () => {
    const updateModel = vi.fn();
    const model = baseModel([
      {
        ...section("law", "Право"),
        breakdownFeedback: {
          "Персональные данные": { format: "plain" as const, text: "Было", links: [], assets: [], events: [] },
        },
      },
    ] as never);
    render(model, updateModel);
    fireEvent.click(screen.getByTestId("breakdown-feedback-law-Персональные данные-edit"));
    fireEvent.change(screen.getByTestId("feedback-editor-text"), { target: { value: "  " } });
    fireEvent.click(screen.getByTestId("feedback-editor-save"));
    const next = (updateModel.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);
    expect(next.sections[0].breakdownFeedback).toBeNull();
  });
});
