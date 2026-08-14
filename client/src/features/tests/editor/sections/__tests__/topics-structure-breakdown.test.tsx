/**
 * @module features/tests/editor/sections/__tests__/topics-structure-breakdown.test
 * @description PRD-50 FR-42: таблица «раздел x ключ» — квота, порог и попадание ключа в
 * каждый вариант в ОДНОЙ строке. Пороги доступны и в вариантном режиме, где квоты гаснут.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

const TOPICS = [{ id: "top-1", name: "Основы ИБ", questionCount: 4 }];
const QUESTIONS = [
  { id: "q1", topicId: "top-1", type: "single", prompt: "Q1", tags: ["Крипто"] },
  { id: "q2", topicId: "top-1", type: "single", prompt: "Q2", tags: ["Крипто"] },
  { id: "q3", topicId: "top-1", type: "single", prompt: "Q3", tags: ["Сети"] },
  { id: "q4", topicId: "top-1", type: "single", prompt: "Q4", tags: [] },
];

function baseModel(sections: EditorSection[]): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Sample", description: "", status: "draft",
      feedback: { format: "plain", text: "" },
      feedbackLinks: [], feedbackAssets: [], feedbackEvents: [],
      webhookUrl: "", telemetryEnabled: false,
    },
    runtime: {
      timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true,
      skipReviewWhenComplete: false, quickAdvance: false, copyProtection: true,
      protectionWatermark: false, protectionHideOnBlur: false,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections,
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [], scales: [], measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
  };
}

function buildSection(over: Partial<EditorSection> = {}): EditorSection {
  return {
    topicId: "top-1", topicName: "Основы ИБ", maxQuestions: 4, drawCount: 3,
    drawAll: false, required: false, timeLimit: { source: "inherit_test" },
    feedback: { format: "plain", text: "" },
    feedbackLinks: [], feedbackAssets: [], feedbackEvents: [], defaultPoints: null,
    ...over,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;
beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => TOPICS, text: async () => "[]" }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderWithClient(ui: React.JSX.Element) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  client.setQueryData(["/api/questions"], QUESTIONS);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function selectOption(testId: string, label: string | RegExp) {
  const wrap = screen.getByTestId(testId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("таблица «раздел x ключ»", () => {
  it("включение порогов заводит правила с осью тега", () => {
    const updateModel = vi.fn();
    const model = baseModel([buildSection()]);
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("topic-rules-toggle-top-1"));
    const next = (updateModel.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);
    expect(next.sections[0].breakdownRules).toEqual({ axis: "tag", keys: {} });
  });

  it("порог ключа сохраняется процентом", () => {
    const updateModel = vi.fn();
    const model = baseModel([
      buildSection({ breakdownRules: { axis: "tag", keys: { "Крипто": { type: "none" } } } }),
    ]);
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    selectOption("key-threshold-mode-top-1-0", /Не менее/);
    const next = (updateModel.mock.calls[0][0] as (m: TestEditorModel) => TestEditorModel)(model);
    expect(next.sections[0].breakdownRules!.keys!["Крипто"]).toEqual({ type: "percent", value: 60 });
  });

  it("в режиме вариантов квоты заперты, а пороги и попадание в варианты видны (FR-42)", () => {
    const model = baseModel([
      buildSection({
        breakdownRules: { axis: "tag", keys: { "Крипто": { type: "percent", value: 60 } } },
        formSet: {
          forms: [
            { id: "f1", label: "Вариант 1", questionIds: ["q1", "q3"] },
            { id: "f2", label: "Вариант 2", questionIds: ["q3", "q4"] },
          ],
        },
      }),
    ]);
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.getByTestId("key-threshold-mode-top-1-0")).toBeInTheDocument();
    // Ключ «Крипто» есть в первом варианте (q1) и отсутствует во втором.
    expect(screen.getByTestId("key-variants-top-1-0")).toHaveTextContent("Вариант 1: 1");
    expect(screen.getByTestId("key-variants-top-1-0")).toHaveTextContent("Вариант 2: 0");
  });
});
