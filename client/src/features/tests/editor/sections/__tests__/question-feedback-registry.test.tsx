/**
 * @module features/tests/editor/sections/__tests__/question-feedback-registry.test
 * @description Э2.4: реестр «По вопросам» — свёрнут до тем, показывает написанное по
 * режиму вопроса, правку уводит в редактор вопроса.
 */
import { describe, it, expect, vi } from "vitest";
import { render as rtlRender, screen, fireEvent } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { QuestionFeedbackRegistry } from "../question-feedback-registry";
import { defaultRetakePolicy } from "../../test-editor.mappers";
import type { TestEditorModel } from "../../test-editor.types";

const QUESTIONS = [
  {
    id: "q1",
    topicId: "law",
    text: "Что такое персональные данные?",
    feedbackMode: "general",
    feedback: "Смотрите статью 3",
  },
  {
    id: "q2",
    topicId: "law",
    text: "Можно ли передавать данные третьим лицам?",
    feedbackMode: "conditional",
    feedbackCorrect: "Верно, только с согласия",
    feedbackIncorrect: "Нет: нужно согласие субъекта",
  },
  { id: "q3", topicId: "law", text: "Без обратной связи", feedbackMode: "general", feedback: null },
];

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

function render(model: TestEditorModel, onOpenQuestion?: (id: string) => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["/api/questions"], QUESTIONS);
  return rtlRender(
    <QueryClientProvider client={client}>
      <QuestionFeedbackRegistry model={model} onOpenQuestion={onOpenQuestion} />
    </QueryClientProvider>,
  );
}

describe("<QuestionFeedbackRegistry />", () => {
  it("открывается свёрнутым до тем и считает, у скольких вопросов есть текст", () => {
    render(baseModel([section("law", "Право")]));
    const trigger = screen.getByTestId("question-feedback-topic-law");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(trigger).toHaveTextContent("вопросов 3 · с обратной связью 2");
    expect(screen.queryByText("Что такое персональные данные?")).toBeNull();
  });

  it("раскрытая тема показывает тексты по режиму вопроса", () => {
    render(baseModel([section("law", "Право")]));
    fireEvent.click(screen.getByTestId("question-feedback-topic-law"));
    expect(screen.getByText("Смотрите статью 3")).toBeInTheDocument();
    expect(screen.getByText("Верно, только с согласия")).toBeInTheDocument();
    expect(screen.getByText("Нет: нужно согласие субъекта")).toBeInTheDocument();
    // Вопрос без текста честно говорит об этом, а не притворяется заполненным.
    expect(screen.getByText("не задано")).toBeInTheDocument();
  });

  it("«Развернуть все» и «Свернуть все» работают на все темы", () => {
    render(baseModel([section("law", "Право")]));
    fireEvent.click(screen.getByTestId("question-feedback-expand-all"));
    expect(screen.getByTestId("question-feedback-topic-law")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(screen.getByTestId("question-feedback-collapse-all"));
    expect(screen.getByTestId("question-feedback-topic-law")).toHaveAttribute("aria-expanded", "false");
  });

  it("«Открыть вопрос» отдаёт идентификатор наверх, а не правит текст на месте", () => {
    const onOpen = vi.fn();
    render(baseModel([section("law", "Право")]), onOpen);
    fireEvent.click(screen.getByTestId("question-feedback-topic-law"));
    fireEvent.click(screen.getByTestId("question-feedback-open-q1"));
    expect(onOpen).toHaveBeenCalledWith("q1");
  });

  it("без перехода наверх строка кнопки не предлагает", () => {
    render(baseModel([section("law", "Право")]));
    fireEvent.click(screen.getByTestId("question-feedback-topic-law"));
    expect(screen.queryByTestId("question-feedback-open-q1")).toBeNull();
  });

  it("тест без тем объясняет, где их заводят", () => {
    render(baseModel([]));
    expect(screen.getByTestId("question-feedback-no-topics")).toBeInTheDocument();
  });
});
