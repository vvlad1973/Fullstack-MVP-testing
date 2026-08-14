/**
 * @module features/tests/editor/sections/__tests__/basic-settings-breakdown.test
 * @description PRD-50 FR-13: the «Подытоги по ключам» control in the «Правила
 * прохождения» pane — visibility selector present, defaults to «Не показывать»,
 * and reports `{ visibility, basis }` through `updateModel` on change.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render as rtlRender, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SettingsSection } from "../basic-settings-section";
import type { TestEditorModel } from "../../test-editor.types";
import { defaultRetakePolicy } from "../../test-editor.mappers";

/** Same wrapper the neighbouring settings-section tests use: the pane fetches
 *  the PRD-27 report-variant catalog, so every render needs a query provider. */
function render(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

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
    },
    passRules: {
      decisionPolicy: "overall_only",
      overall: { type: "percent", value: 70 },
      byTopic: {},
    },
    sections: [],
    adaptive: { showDifficultyLevel: true, testSettings: { showDifficultyLevel: true }, topics: [] },
    resultVariables: [],
    scales: [],
    measurements: [],
    retakePolicy: defaultRetakePolicy(),
    scoring: { defaultQuestionPoints: null, questionOverrides: [] },
    ...overrides,
  };
}

function runUpdater(
  updateModel: ReturnType<typeof vi.fn>,
  model: TestEditorModel,
  call = 0,
): TestEditorModel {
  const updater = updateModel.mock.calls[call][0] as (m: TestEditorModel) => TestEditorModel;
  return updater(model);
}

/** Opens the ui-kit Select identified by its wrapper testid, then clicks the
 *  option with the given visible label (same helper as the neighbouring test). */
function selectOption(selectTestId: string, optionLabel: string | RegExp) {
  const wrap = screen.getByTestId(selectTestId);
  fireEvent.click(within(wrap).getByRole("button"));
  fireEvent.click(screen.getByRole("option", { name: optionLabel }));
}

const openPassRulesPane = () => fireEvent.click(screen.getByTestId("settings-rail-pass-rules"));

describe("<SettingsSection /> — Подытоги по ключам (PRD-50 FR-13)", () => {
  it("рендерит селектор видимости в панели «Правила прохождения»", () => {
    render(<SettingsSection model={baseModel()} updateModel={() => {}} />);
    openPassRulesPane();
    expect(screen.getByTestId("settings-breakdown-visibility-select")).toBeInTheDocument();
  });

  it("умолчание — «Не показывать», и селектор базы скрыт", () => {
    render(<SettingsSection model={baseModel()} updateModel={() => {}} />);
    openPassRulesPane();
    expect(
      within(screen.getByTestId("settings-breakdown-visibility-select")).getByRole("button"),
    ).toHaveTextContent("Не показывать");
    expect(screen.queryByTestId("settings-breakdown-basis-select")).not.toBeInTheDocument();
  });

  it("выбор «Полоса» отдаёт наверх { visibility: \"bar\", basis: \"units\" }", () => {
    const updateModel = vi.fn();
    const model = baseModel();
    render(<SettingsSection model={model} updateModel={updateModel} />);
    openPassRulesPane();
    selectOption("settings-breakdown-visibility-select", "Полоса");
    expect(runUpdater(updateModel, model).runtime.breakdownDisplay).toEqual({
      visibility: "bar",
      basis: "units",
    });
  });

  it("показывает селектор базы, когда видимость не «hidden»", () => {
    render(
      <SettingsSection
        model={baseModel({
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
            breakdownDisplay: { visibility: "bar", basis: "units" },
          },
        })}
        updateModel={() => {}}
      />,
    );
    openPassRulesPane();
    expect(screen.getByTestId("settings-breakdown-basis-select")).toBeInTheDocument();
  });
});

/**
 * PRD-50 FR-28/FR-44 (Э4): положение показа — там же, где видимость, отдельным полем.
 * Настройка, сохранённая до Э4, положения не несёт и обязана читаться как «В карточках
 * тем», то есть ровно как сегодня.
 */
describe("<SettingsSection /> — где показывать подытоги (PRD-50 FR-44)", () => {
  const withDisplay = (breakdownDisplay?: Record<string, string>) =>
    baseModel({
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
        ...(breakdownDisplay ? { breakdownDisplay } : {}),
      },
    } as Partial<TestEditorModel>);

  it("селектора нет, пока разрез не показывается", () => {
    render(<SettingsSection model={withDisplay()} updateModel={() => {}} />);
    openPassRulesPane();
    expect(screen.queryByTestId("settings-breakdown-placement-select")).not.toBeInTheDocument();
  });

  it("настройка без положения читается как «В карточках тем»", () => {
    render(<SettingsSection model={withDisplay({ visibility: "bar", basis: "units" })} updateModel={() => {}} />);
    openPassRulesPane();
    expect(
      within(screen.getByTestId("settings-breakdown-placement-select")).getByRole("button"),
    ).toHaveTextContent("В карточках тем");
  });

  it("выбор сводного блока отдаёт наверх placement, не трогая остальное", () => {
    const updateModel = vi.fn();
    const model = withDisplay({ visibility: "bar_and_value", basis: "points" });
    render(<SettingsSection model={model} updateModel={updateModel} />);
    openPassRulesPane();
    selectOption("settings-breakdown-placement-select", "Сводным блоком по тесту");
    expect(runUpdater(updateModel, model).runtime.breakdownDisplay).toEqual({
      visibility: "bar_and_value",
      basis: "points",
      placement: "block",
    });
  });
});
