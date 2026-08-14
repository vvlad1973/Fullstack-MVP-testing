/**
 * @module features/tests/editor/sections/__tests__/topics-structure-section-groups.test
 * @description PRD-50 FR-11/FR-12/FR-43: the «Блоки итогов» list (add/rename/delete a
 * test-wide block) and the per-section «Блок» selector in the «Состав» tab.
 */
import type * as React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompositionSection } from "../topics-structure-section";
import type { TestEditorModel, EditorSection } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

const TOPICS = [
  { id: "top-1", name: "Основы ИБ", questionCount: 4 },
  { id: "top-2", name: "Сетевая безопасность", questionCount: 6 },
];

function baseModel(overrides: Partial<TestEditorModel> = {}): TestEditorModel {
  return {
    version: 1,
    mode: "standard",
    flowMode: "linear_flat",
    flowSettings: {},
    folderId: null,
    basic: {
      title: "Sample",
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
      timeLimitMinutes: null, maxAttempts: null, showCorrectAnswers: false,
      allowReturnToUnanswered: true, allowAnswerChange: false, showSectionResults: true,
      skipReviewWhenComplete: false, quickAdvance: false, copyProtection: true,
      protectionWatermark: false, protectionHideOnBlur: false,
    },
    passRules: { decisionPolicy: "overall_only", overall: { type: "percent", value: 70 }, byTopic: {} },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [], scales: [], measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    ...overrides,
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
  client.setQueryData(["/api/questions"], []);
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

function runUpdater(
  updateModel: ReturnType<typeof vi.fn>,
  model: TestEditorModel,
  call = 0,
): TestEditorModel {
  const updater = updateModel.mock.calls[call][0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

function selectOption(testId: string, label: string | RegExp) {
  const wrap = screen.getByTestId(testId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: label }));
}

describe("«Блоки итогов» (PRD-50 FR-11/FR-43)", () => {
  it("тест без блоков: списка нет, кнопка «Добавить блок» есть, у раздела нет селектора «Блок»", () => {
    const model = baseModel({ sections: [buildSection()] });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(screen.queryByTestId("section-groups-list")).not.toBeInTheDocument();
    expect(screen.getByTestId("section-group-add")).toBeInTheDocument();
    expect(screen.queryByTestId("topic-group-top-1")).not.toBeInTheDocument();
  });

  it("«Добавить блок» заводит блок со служебным ключом и подписью по умолчанию", () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [buildSection()] });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("section-group-add"));
    const next = runUpdater(updateModel, model);
    expect(next.sectionGroups).toEqual([{ key: "group-1", label: "Блок 1" }]);
  });

  it("второй блок получает следующий свободный ключ, не выдуманный автором", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection()],
      sectionGroups: [{ key: "group-1", label: "Вводный" }],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("section-group-add"));
    const next = runUpdater(updateModel, model);
    expect(next.sectionGroups).toEqual([
      { key: "group-1", label: "Вводный" },
      { key: "group-2", label: "Блок 2" },
    ]);
  });

  it("правка подписи блока меняет только её, не ключ", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection()],
      sectionGroups: [{ key: "group-1", label: "Блок 1" }],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.change(screen.getByTestId("section-group-label-group-1"), {
      target: { value: "Вводная часть" },
    });
    const next = runUpdater(updateModel, model);
    expect(next.sectionGroups).toEqual([{ key: "group-1", label: "Вводная часть" }]);
  });

  it("удаление блока убирает его из списка и снимает ссылку у разделов, которые на него ссылались", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [
        buildSection({ topicId: "top-1", groupKey: "group-1" }),
        buildSection({ topicId: "top-2", topicName: "Сетевая безопасность", groupKey: "group-2" }),
      ],
      sectionGroups: [
        { key: "group-1", label: "Блок 1" },
        { key: "group-2", label: "Блок 2" },
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("section-group-remove-group-1"));
    const next = runUpdater(updateModel, model);
    expect(next.sectionGroups).toEqual([{ key: "group-2", label: "Блок 2" }]);
    expect(next.sections.find((s) => s.topicId === "top-1")?.groupKey).toBeNull();
    // A section pointing at a DIFFERENT, still-existing block is untouched.
    expect(next.sections.find((s) => s.topicId === "top-2")?.groupKey).toBe("group-2");
  });

  it("селектор «Блок» появляется у раздела, когда есть хотя бы один блок, с умолчанием «Без блока»", () => {
    const model = baseModel({
      sections: [buildSection()],
      sectionGroups: [{ key: "group-1", label: "Блок 1" }],
    });
    renderWithClient(<CompositionSection model={model} updateModel={() => {}} />);
    expect(
      within(screen.getByTestId("topic-group-top-1")).getByRole("button"),
    ).toHaveTextContent("Без блока");
  });

  it("выбор блока у раздела уходит в модель, доступен и «Без блока» обратно", () => {
    const updateModel = vi.fn();
    const model = baseModel({
      sections: [buildSection({ groupKey: null })],
      sectionGroups: [
        { key: "group-1", label: "Вводный" },
        { key: "group-2", label: "Основной" },
      ],
    });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    selectOption("topic-group-top-1", "Основной");
    let next = runUpdater(updateModel, model);
    expect(next.sections[0].groupKey).toBe("group-2");

    // Reselect "Без блока" on the model updated by the previous change.
    updateModel.mockClear();
    cleanup();
    renderWithClient(<CompositionSection model={next} updateModel={updateModel} />);
    selectOption("topic-group-top-1", "Без блока");
    next = runUpdater(updateModel, next);
    expect(next.sections[0].groupKey).toBeNull();
  });

  it("новая тема заводится без блока", async () => {
    const updateModel = vi.fn();
    const model = baseModel({ sections: [], sectionGroups: [{ key: "group-1", label: "Блок 1" }] });
    renderWithClient(<CompositionSection model={model} updateModel={updateModel} />);
    fireEvent.click(screen.getByTestId("composition-add-topic"));
    await waitFor(() => expect(screen.getByTestId("topic-picker-item-top-1")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("topic-picker-item-top-1"));
    const next = runUpdater(updateModel, model);
    expect(next.sections[0].groupKey).toBeNull();
  });
});
