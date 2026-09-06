/**
 * @module features/tests/editor/sections/editor-tabs
 * @description Вкладки редактора теста после перестройки ящика (план
 * «перестройка настроек редактора теста», Э3.2-Э3.6).
 *
 * До перестройки ящик резал настройки по происхождению («Настройки», «Оформление»,
 * «Структура», «Шкалы», «Показатели»), и один вопрос автора расходился по трём местам.
 * Теперь вкладка отвечает на ОДИН вопрос — что это за тест, из чего он собран, по каким
 * правилам идёт, как оценивается, что видит участник, как это выглядит, — а рейл внутри
 * вкладки делит этот вопрос на подтемы.
 *
 * Каждая вкладка здесь — тонкая: она объявляет пункты рейла, считает точки состояния и
 * зовёт уже существующие панели. Сами панели живут там, где жили: логика не переезжала,
 * переехали только адреса.
 */
import { useMemo } from "react";
import type * as React from "react";
import { Banner, FormSection } from "@universityrt/ui-kit";
import type { FieldErrorIndex } from "../field-errors";
import type { TestEditorModel } from "../test-editor.types";
import type { UseDesignSettingsResult } from "../use-design-settings";
import type { UseContentPagesResult } from "../use-content-pages";
import { TabRail, useRailState, type RailEntry, type RailItem } from "./tab-rail";
import {
  AdaptivePane,
  BreakdownDisplayPane,
  DuringRunPane,
  DuringTestPane,
  FeedbackTextsPane,
  IntegrationPane,
  LimitsPane,
  MainPane,
  NavigationPane,
  ProtectionPane,
  ReportContentPane,
  ScenarioSettingsPane,
  VerdictPane,
} from "./basic-settings-section";
import { CompositionSection } from "./topics-structure-section";
import { StructureSection } from "./start-pages-section";
import { ScoringSection } from "./scoring-section";
import { ScalesSection } from "./scales-section";
import { ResultVariablesSection } from "./result-variables-section";
import { ResultsLabelsPane } from "./results-labels-pane";
import { ReportLabelsCard, SectionPane } from "./design-section";
import { BreakdownFeedbackCard } from "./breakdown-feedback-card";
import { TopicFeedbackCard } from "./topic-feedback-card";
import { LevelFeedbackCard } from "./level-feedback-card";
import { QuestionFeedbackRegistry } from "./question-feedback-registry";
import { templateBlockOrder } from "@shared/template/results-order";

/** Общий набор props вкладки: черновик, мутатор и ошибки полей. */
export type EditorTabProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
  fieldErrors?: FieldErrorIndex;
};

// ─── «Основное» ───────────────────────────────────────────────────────────────

/**
 * Что это за тест: название, описание, режим и интеграция. Рейла нет — полей мало, и
 * лишний столбец только отодвигал бы их от края (эскиз `wf-basic`).
 */
export function MainTab({ model, updateModel, fieldErrors }: EditorTabProps): React.JSX.Element {
  return (
    <div className="tb-settings-content" data-testid="settings-pane-main">
      <MainPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      <IntegrationPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
    </div>
  );
}

// ─── «Состав и сценарий» ──────────────────────────────────────────────────────

type CompositionRail = "composition" | "adaptive" | "scenario";

/**
 * Из чего собран тест и как он идёт: темы с выборкой и вариантами, лестница уровней
 * адаптивного теста и полотно сценария. «Адаптивные уровни» показываются только
 * адаптивному тесту — у стандартного лестницы нет.
 */
export function CompositionTab({
  model,
  updateModel,
  fieldErrors,
  testId,
  content,
  savedFlowMode,
  designDraft,
}: EditorTabProps & {
  testId?: string;
  content?: UseContentPagesResult;
  savedFlowMode: string | null;
  designDraft?: UseDesignSettingsResult["draft"];
}): React.JSX.Element {
  const isAdaptive = model.mode === "adaptive";
  // Стоп-фактор адаптивного теста: ни одна тема не включена (лестницы нет вообще).
  const adaptiveError =
    isAdaptive && model.sections.length > 0 && !model.adaptive.topics.some((t) => t.enabled);
  // Замечание: у включённой темы меньше двух уровней — адаптироваться не между чем.
  const adaptiveWarning =
    isAdaptive &&
    !adaptiveError &&
    model.sections.some((section) => {
      const topic = model.adaptive.topics.find((t) => t.topicId === section.topicId);
      return topic?.enabled && topic.levels.length < 2;
    });
  const items: RailItem<CompositionRail>[] = [
    {
      key: "composition",
      label: "Состав",
      dot: fieldErrors?.has("sections") ? "error" : undefined,
    },
    ...(isAdaptive
      ? [
          {
            key: "adaptive" as const,
            label: "Адаптивные уровни",
            dot: (adaptiveError || fieldErrors?.has("adaptive")
              ? "error"
              : adaptiveWarning
                ? "warning"
                : undefined) as RailItem<CompositionRail>["dot"],
          },
        ]
      : []),
    {
      key: "scenario",
      label: "Сценарий",
      dot: fieldErrors?.has("flowMode") ? "error" : undefined,
    },
  ];
  const [active, setActive] = useRailState<CompositionRail>(items, "composition");
  return (
    <TabRail
      items={items}
      active={active}
      onChange={setActive}
      ariaLabel="Подразделы состава и сценария"
      testIdPrefix="composition"
    >
      {active === "composition" && (
        <CompositionSection model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      )}
      {active === "adaptive" && <AdaptivePane model={model} updateModel={updateModel} />}
      {active === "scenario" && (
        <>
          <ScenarioSettingsPane model={model} updateModel={updateModel} />
          <StructureSection
            model={model}
            testId={testId}
            content={content}
            savedFlowMode={savedFlowMode as never}
            updateModel={updateModel}
            designDraft={designDraft}
          />
        </>
      )}
    </TabRail>
  );
}

// ─── «Правила прохождения» ────────────────────────────────────────────────────

type RulesRail = "navigation" | "during" | "limits" | "protection";

const RULES_ITEMS: { key: RulesRail; label: string }[] = [
  { key: "navigation", label: "Навигация" },
  { key: "during", label: "Во время прохождения" },
  { key: "limits", label: "Ограничения" },
  { key: "protection", label: "Защита контента" },
];

/**
 * По каким правилам участник проходит тест: как ходит, что видит на экране вопроса,
 * чем ограничен и как защищено задание.
 */
export function RulesTab({
  model,
  updateModel,
  fieldErrors,
  design,
}: EditorTabProps & { design?: UseDesignSettingsResult }): React.JSX.Element {
  const [active, setActive] = useRailState<RulesRail>(RULES_ITEMS, "navigation");
  return (
    <TabRail
      items={RULES_ITEMS}
      active={active}
      onChange={setActive}
      ariaLabel="Подразделы правил прохождения"
      testIdPrefix="rules"
    >
      {active === "navigation" && <NavigationPane model={model} updateModel={updateModel} />}
      {active === "during" && (
        // Э5.7: заголовок группы называет не момент («по ходу»), а предмет — что именно
        // участник видит на экране вопроса, пока идёт тест.
        <FormSection title="Что видит ученик во время прохождения теста" stacked>
          {/* Прогресс и шапка объявлены МАНИФЕСТОМ шаблона, поэтому рисует их тот же
              механизм, что и в «Оформлении»; сюда параметры переехали адресом, а не
              переписыванием (решение 18). */}
          {design && !design.templateMissing && (
            <SectionPane
              design={design}
              section="progress"
              emptyTitle="В шаблоне нет настроек прогресса"
              emptyDesc={`У выбранного шаблона «${design.template?.manifest.name ?? ""}» не объявлено ни одного параметра прогресса.`}
              testId="rules-progress-pane"
            />
          )}
          <DuringRunPane model={model} updateModel={updateModel} />
        </FormSection>
      )}
      {active === "limits" && (
        <LimitsPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      )}
      {active === "protection" && <ProtectionPane model={model} updateModel={updateModel} />}
    </TabRail>
  );
}

// ─── «Оценка результата» ──────────────────────────────────────────────────────

type ScoringRail = "answer" | "verdict" | "scales-list" | "scales-contrib" | "metrics";

/**
 * Как считается результат: цена ответа, вердикт теста и тем, шкалы и показатели. Четыре
 * разговора об одном — сколько получилось и что это значит, — прежде разнесённые по трём
 * вкладкам и хвосту «Правил прохождения».
 */
export function ScoringTab({
  model,
  updateModel,
  fieldErrors,
  testId,
}: EditorTabProps & { testId?: string }): React.JSX.Element {
  // «Шкалы» — не один экран, а два: сами шкалы и матрица вкладов. Прежде они шли
  // одной колонкой друг под другом, и матрица — самое широкое место ящика, её ширина
  // растёт с каждой шкалой — делила панель с карточками шкал (эскиз ds-rail-nested).
  const hasScales = model.scales.length > 0;
  const scalesDot = fieldErrors?.has("scales") ? ("error" as const) : undefined;
  const items: RailEntry<ScoringRail>[] = [
    {
      key: "answer",
      label: "Оценка ответа",
      dot: fieldErrors?.has("scoring") ? "error" : undefined,
    },
    {
      key: "verdict",
      label: "Вердикт",
      dot: fieldErrors?.has("passRules") ? "error" : undefined,
    },
    {
      label: "Шкалы",
      items: [
        { key: "scales-list", label: "Список шкал", dot: scalesDot },
        {
          key: "scales-contrib",
          label: "Вклады вопросов",
          // Вносить вклад не во что, пока нет ни одной шкалы. Пункт остаётся
          // видимым: исчезнувший читался бы как «такой настройки нет».
          disabled: !hasScales,
          disabledHint: hasScales ? undefined : "Появятся, когда будет хотя бы одна шкала.",
        },
      ],
    },
    {
      key: "metrics",
      label: "Показатели",
      dot: fieldErrors?.has("resultVariables") ? "error" : undefined,
    },
  ];
  const [active, setActive] = useRailState<ScoringRail>(items, "answer");
  return (
    <TabRail
      items={items}
      active={active}
      onChange={setActive}
      ariaLabel="Подразделы оценки результата"
      testIdPrefix="scoring"
    >
      {active === "answer" && (
        <ScoringSection model={model} testId={testId} updateModel={updateModel} />
      )}
      {active === "verdict" && (
        <VerdictPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
      )}
      {(active === "scales-list" || active === "scales-contrib") && (
        <ScalesSection
          pane={active === "scales-contrib" ? "contributions" : "list"}
          model={model}
          testId={testId}
          updateModel={updateModel}
          fieldErrors={fieldErrors}
        />
      )}
      {active === "metrics" && (
        <ResultVariablesSection
          model={model}
          testId={testId}
          updateModel={updateModel}
          fieldErrors={fieldErrors}
        />
      )}
    </TabRail>
  );
}

// ─── «Обратная связь и итоги» ─────────────────────────────────────────────────

type FeedbackRail = "during" | "results" | "texts" | "report";

const FEEDBACK_ITEMS: { key: FeedbackRail; label: string }[] = [
  { key: "during", label: "Во время теста" },
  { key: "results", label: "Состав итогов" },
  { key: "texts", label: "Обратная связь" },
  { key: "report", label: "Отчёт" },
];

/**
 * Что участник узнаёт о своём результате: по ходу теста, на экране итогов, в текстах
 * обратной связи и в документе отчёта. Состав и слова живут здесь, облик — в «Оформлении»
 * (решение 18).
 */
export function FeedbackTab({
  model,
  updateModel,
  fieldErrors,
  design,
  onOpenQuestion,
}: EditorTabProps & {
  design?: UseDesignSettingsResult;
  /** Э2.4: открыть редактор вопроса из реестра. Ящик вопроса монтирует хозяин вкладки. */
  onOpenQuestion?: (questionId: string) => void;
}): React.JSX.Element {
  // PRD-49: документ печатает НЕ все объявленные надписи — структура у него своя и
  // фиксированная, поэтому перечень приходит с сервера, посчитанный по макетам отчёта
  // (`reportLabelKeys`). Поля нет (старый сервер, шаблон не прочитался) — показываются
  // все объявления, как раньше.
  const reportLabelDeclarations = useMemo(() => {
    const declared = design?.template?.manifest.labels ?? [];
    const printed = design?.template?.reportLabelKeys;
    if (!printed) return declared;
    const allowed = new Set(printed);
    return declared.filter((d) => allowed.has(d.key));
  }, [design?.template]);
  const [active, setActive] = useRailState<FeedbackRail>(FEEDBACK_ITEMS, "during");
  return (
    <TabRail
      items={FEEDBACK_ITEMS}
      active={active}
      onChange={setActive}
      ariaLabel="Подразделы обратной связи и итогов"
      testIdPrefix="feedback"
    >
      {active === "during" && (
        <>
          <DuringTestPane model={model} updateModel={updateModel} />
          {/* Э2.4: что уже написано у вопросов этого теста. Только чтение: обратная связь
              принадлежит ВОПРОСУ, тот же вопрос стоит и в других тестах. */}
          <QuestionFeedbackRegistry model={model} onOpenQuestion={onOpenQuestion} />
        </>
      )}
      {active === "results" && (
        <>
          <BreakdownDisplayPane model={model} updateModel={updateModel} />
          {design && !design.templateMissing && (
            <ResultsLabelsPane
              declarations={design.template?.manifest.labels ?? []}
              labels={design.draft.labels ?? {}}
              onChange={design.setLabels}
              order={design.draft.resultsBlockOrder}
              // Состав и порядок объявляет ШАБЛОН, и берётся объявление ЭКРАНА ИТОГОВ:
              // настройка одна на все экраны, а адаптивные итоги, например, сводки
              // баллов не печатают вовсе.
              templateOrder={templateBlockOrder(
                design.template?.manifest.resultsBlockOrder,
                "results",
              )}
              onOrderChange={design.setResultsBlockOrder}
            />
          )}
          {design?.templateMissing && (
            <Banner
              tone="warning"
              title="Шаблон недоступен"
              description="Надписи и порядок подблоков объявляет шаблон. Выберите шаблон во вкладке «Оформление» — после этого здесь появятся его надписи."
              data-testid="feedback-labels-no-template"
            />
          )}
        </>
      )}
      {active === "texts" && (
        <>
          <FeedbackTextsPane model={model} updateModel={updateModel} fieldErrors={fieldErrors} />
          {/* PRD-29 §7.1a: тексты тем — РАЗРЕШЁННЫЕ, по одному на тему. Правились они в
              «Составе», среди выборки и квот, где автор искал их последними. */}
          <TopicFeedbackCard model={model} updateModel={updateModel} />
          {/* PRD-50 FR-50: тексты подтем — рядом с текстом теста, а не в «Оценке»: это
              содержание, которое человек прочитает, а не правило, по которому его судят. */}
          <BreakdownFeedbackCard model={model} updateModel={updateModel} />
          {/* Э2.5: тексты адаптивных уровней. Карточка сама решает, показываться ли:
              у стандартного теста лестницы нет, и пустой раздел о ней врал бы. */}
          {model.mode === "adaptive" && (
            <LevelFeedbackCard model={model} updateModel={updateModel} />
          )}
        </>
      )}
      {active === "report" && (
        <>
          <ReportContentPane model={model} updateModel={updateModel} design={design} />
          {/* PRD-49 §7: тот же перечень надписей, но слоем ПЕРЕОПРЕДЕЛЕНИЙ. Пустая строка
              значит «как на экране итогов», поэтому подсказкой поля стоит уже разрешённый
              текст итогов, а не умолчание шаблона. Перечень — только те надписи, которые
              печатает ДОКУМЕНТ (`reportLabelKeys`): структура у него своя и фиксированная,
              и строка про заголовок, которого в нём нет, включалась бы вхолостую. */}
          {design && reportLabelDeclarations.length > 0 && (
            <ReportLabelsCard
              declarations={reportLabelDeclarations}
              sharedLabels={design.draft.labels ?? {}}
              report={model.report ?? {}}
              onChange={(next) => updateModel((m) => ({ ...m, report: next }))}
            />
          )}
        </>
      )}
    </TabRail>
  );
}
