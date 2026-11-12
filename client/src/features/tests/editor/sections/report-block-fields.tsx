/**
 * @module features/tests/editor/sections/report-block-fields
 * @description ПОЛЯ РАСКРЫТОЙ СТРОКИ блока документа отчёта (PRD-51 §7.2, FR-17) и их
 * содержимое ПО ИСХОДУ теста.
 *
 * Эскиз: `docs/wireframes/approved/report-block-outcome.html`, состояния `s-common`,
 * `s-outcome`, `s-outcome-off`, `s-no-verdict`; карточки состояний —
 * `docs/specs/report-block-outcome/wireframe-states.md`.
 *
 * Состав полей объявляет ВАРИАНТ блока, а не продукт: «Три колонки» и «Текст и картинка» —
 * разные наборы, и знать их наперёд нельзя. Вариант без единого поля показывает не пустую
 * форму, а объяснение: раскладка, которой нечего сказать, выглядит как сломанная.
 *
 * Содержимое по исходу повторяет карточку «Вводный текст на экране итогов»: три группы
 * «При любом исходе / Если тест пройден / Если тест не пройден». Длинный текст по исходу
 * ДОПИСЫВАЕТСЯ к общему, короткое поле ЗАМЕНЯЕТ общее — правило печати живёт в
 * `shared/report/report-outcome`, здесь только его подписи.
 *
 * Контрол поля один на продукт ({@link PlaceholderControl}): длинный текст правится им же,
 * только внутри окна, а в строке показан свёрнутым видом с карандашом — три встроенных
 * редактора делали раскрытый блок бесконечным.
 */
import { useState } from "react";
import { Info } from "lucide-react";
import { Button, Input, ModalDialog, Switch } from "@skillum/ui-kit";
import type { ContentTemplatePlaceholder } from "../use-content-pages";
import { PlaceholderControl } from "./placeholder-control";
import { FeedbackField, FeedbackPreview } from "./feedback-preview";
import type { DraftBlock } from "../use-report-document";
import {
  APPENDED_FIELD_TYPES,
  hasReportBlockOutcome,
  normalizeReportBlockOutcome,
  type ReportBlockOutcome,
  type ReportOutcomeKey,
} from "@shared/report/report-outcome";

export interface ReportBlockFieldsProps {
  block: DraftBlock;
  /** Поля варианта в порядке объявления шаблоном. */
  placeholders: ContentTemplatePlaceholder[];
  onChange: (next: DraftBlock) => void;
  readOnly?: boolean;
  index: number;
  /**
   * Умолчания по исходу, объявленные вариантом шаблона (`outcomeDefaults`). Действуют, пока
   * автор содержимым по исходу не распорядился (`block.outcome` — `null`).
   */
  outcomeDefaults?: ReportBlockOutcome;
  /**
   * Выносит ли тест вердикт. Нет — содержимое по исходу не печатается, и переключатель
   * недоступен с объяснением (состояние `s-no-verdict`). По умолчанию считается, что выносит.
   */
  verdictPossible?: boolean;
  /** Название блока для окна подтверждения; по умолчанию — ключ блока. */
  blockTitle?: string;
}

/** Начертания полей: живут рядом со значениями, как и у страницы «Структуры». */
type Styles = Record<string, { fontSize?: number }>;

/** Группа содержимого: общее или одна из ветвей исхода. */
type Group = "any" | ReportOutcomeKey;

const GROUP_LABEL: Record<Group, string> = {
  any: "При любом исходе",
  passed: "Если тест пройден",
  failed: "Если тест не пройден",
};

/** Длинный ли это текст — тот, что правится в окне и по исходу дописывается к общему. */
function isLongText(ph: ContentTemplatePlaceholder): boolean {
  return APPENDED_FIELD_TYPES.includes(ph.type);
}

/** Пусто ли значение поля для показа. */
function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

export function ReportBlockFields(props: ReportBlockFieldsProps) {
  const { block, placeholders, index } = props;
  const values = block.values ?? {};
  const styles = (values.placeholderStyles ?? {}) as Styles;
  const verdictPossible = props.verdictPossible !== false;

  /** Действующее содержимое по исходу: решение автора либо умолчания шаблона. */
  const effective: ReportBlockOutcome =
    block.outcome === null || block.outcome === undefined
      ? normalizeReportBlockOutcome(props.outcomeDefaults)
      : normalizeReportBlockOutcome(block.outcome);
  const hasOutcome = hasReportBlockOutcome(effective);

  // Включённый переключатель без единого значения исхода — законное состояние: автор
  // собирается их задать. В данные оно не пишется (карточка s-outcome), поэтому держится
  // здесь, а не в черновике.
  const [forcedOn, setForcedOn] = useState(false);
  const [confirmOff, setConfirmOff] = useState(false);
  const [editing, setEditing] = useState<{ group: Group; key: string } | null>(null);
  const switchOn = verdictPossible && (hasOutcome || forcedOn);

  const writeValues = (nextValues: Record<string, unknown>) => props.onChange({ ...block, values: nextValues });

  /** Записать значение поля в ветвь исхода; пустое значение ветвь из поля убирает. */
  const writeOutcome = (which: ReportOutcomeKey, key: string, value: unknown) => {
    const next: ReportBlockOutcome = normalizeReportBlockOutcome(effective);
    const branchValues = { ...(next[which]?.values ?? {}) };
    if (isBlank(value)) delete branchValues[key];
    else branchValues[key] = value;
    next[which] = { ...(next[which] ?? {}), values: branchValues };
    props.onChange({ ...block, outcome: normalizeReportBlockOutcome(next) });
  };

  const onSwitch = (checked: boolean) => {
    if (checked) {
      setForcedOn(true);
      return;
    }
    if (hasOutcome) {
      setConfirmOff(true);
      return;
    }
    setForcedOn(false);
  };

  const turnOff = () => {
    // Пустой объект — «автор выключил»: умолчания шаблона после этого не возвращаются.
    props.onChange({ ...block, outcome: {} });
    setForcedOn(false);
    setConfirmOff(false);
  };

  const valueOf = (group: Group, key: string): unknown =>
    group === "any" ? values[key] : effective[group]?.values?.[key];

  /** Длинный текст: свёрнутый вид с карандашом; правится тем же контролом в окне. */
  const longField = (group: Group, ph: ContentTemplatePlaceholder) => {
    const testId =
      group === "any" ? `report-document-field-${index}-${ph.key}` : `report-document-field-${index}-${group}-${ph.key}`;
    return (
      <FeedbackField key={`${group}-${ph.key}`} label={ph.label}>
        <FeedbackPreview
          format="html"
          text={String(valueOf(group, ph.key) ?? "")}
          links={[]}
          assets={[]}
          events={[]}
          onEdit={props.readOnly ? undefined : () => setEditing({ group, key: ph.key })}
          editAriaLabel={`Редактировать: ${ph.label.toLowerCase()}, ${GROUP_LABEL[group].toLowerCase()}`}
          testId={testId}
        />
        {group !== "any" && (
          <p className="ou-formfield__desc">Печатается после текста «При любом исходе».</p>
        )}
      </FeedbackField>
    );
  };

  /** Короткое поле общей группы — тем же контролом, что у страницы «Структуры». */
  const commonShortField = (ph: ContentTemplatePlaceholder) => (
    <div className="ou-formfield" key={`any-${ph.key}`}>
      <PlaceholderControl
        placeholder={ph}
        value={values[ph.key]}
        style={styles[ph.key]}
        onChange={(v) => writeValues({ ...values, [ph.key]: v })}
        onStyleChange={(s) => writeValues({ ...values, placeholderStyles: { ...styles, [ph.key]: s } })}
        testId={`report-document-field-${index}-${ph.key}`}
      />
    </div>
  );

  /**
   * Короткое поле ветви исхода: пустое показывает общее значение подсказкой, заданное
   * получает сброс к общему.
   */
  const outcomeShortField = (which: ReportOutcomeKey, ph: ContentTemplatePlaceholder) => {
    const own = valueOf(which, ph.key);
    const id = `report-field-${index}-${which}-${ph.key}`;
    const common = values[ph.key];
    return (
      <FeedbackField
        key={`${which}-${ph.key}`}
        label={ph.label}
        onReset={!isBlank(own) && !props.readOnly ? () => writeOutcome(which, ph.key, undefined) : undefined}
        resetLabel={`Сбросить ${ph.label.toLowerCase()} к значению «При любом исходе»`}
        resetTestId={`${id}-reset`}
      >
        <Input
          id={id}
          size="m"
          fullWidth
          aria-label={`${ph.label}, ${GROUP_LABEL[which].toLowerCase()}`}
          value={isBlank(own) ? "" : String(own)}
          placeholder={isBlank(common) ? undefined : String(common)}
          onChange={(e) => writeOutcome(which, ph.key, e.target.value)}
          data-testid={id}
        />
      </FeedbackField>
    );
  };

  const editingPh = editing ? placeholders.find((p) => p.key === editing.key) : undefined;
  const [editValue, setEditValue] = useState<unknown>(undefined);
  const openValue = editing ? valueOf(editing.group, editing.key) : undefined;

  const saveEditing = () => {
    if (!editing) return;
    const next = editValue === undefined ? openValue : editValue;
    if (editing.group === "any") writeValues({ ...values, [editing.key]: next });
    else writeOutcome(editing.group, editing.key, next);
    setEditing(null);
    setEditValue(undefined);
  };

  const groupFields = (group: Group) =>
    placeholders.map((ph) =>
      isLongText(ph)
        ? longField(group, ph)
        : group === "any"
          ? commonShortField(ph)
          : outcomeShortField(group, ph),
    );

  if (placeholders.length === 0) {
    return (
      <div className="page-row-expand" data-testid={`report-document-edit-${index}`}>
        <p className="ou-formfield__desc" data-testid={`report-document-edit-empty-${index}`}>
          У этого варианта нет полей: он печатает данные попытки, а не авторский текст.
        </p>
      </div>
    );
  }

  return (
    <div className="page-row-expand" data-testid={`report-document-edit-${index}`}>
      <fieldset
        disabled={props.readOnly}
        className="page-row-expand__fields"
        data-testid={`report-document-edit-fields-${index}`}
      >
        <div className="ou-formfield">
          <Switch
            id={`report-block-outcome-${index}`}
            label="Разное содержимое при разном исходе"
            description={
              verdictPossible
                ? "Включите, чтобы задать блоку свои тексты и настройки для прошедшего и для не прошедшего тест."
                : "У теста нет порога прохождения: исход не выносится, и отчёт печатает одно содержимое для всех."
            }
            checked={switchOn}
            disabled={!verdictPossible || props.readOnly}
            onChange={(e) => onSwitch(e.target.checked)}
            data-testid={`report-block-outcome-switch-${index}`}
          />
        </div>

        {switchOn ? (
          (["any", "passed", "failed"] as const).map((group) => (
            <div className="tb-textgroup" key={group} data-testid={`report-block-outcome-group-${index}-${group}`}>
              <div className="tb-section-label">{GROUP_LABEL[group]}</div>
              {groupFields(group)}
            </div>
          ))
        ) : (
          groupFields("any")
        )}
      </fieldset>

      <ModalDialog
        open={editing !== null && !!editingPh}
        onClose={() => {
          setEditing(null);
          setEditValue(undefined);
        }}
        size="l"
        title={editingPh ? `${editingPh.label}: ${GROUP_LABEL[editing!.group].toLowerCase()}` : ""}
        description={
          editing && editing.group !== "any" ? "Печатается после текста «При любом исходе»." : undefined
        }
        footer={
          <>
            <Button
              variant="secondary"
              size="m"
              onClick={() => {
                setEditing(null);
                setEditValue(undefined);
              }}
              data-testid={`report-document-text-cancel-${index}`}
            >
              Отменить
            </Button>
            <Button variant="primary" size="m" onClick={saveEditing} data-testid={`report-document-text-save-${index}`}>
              Сохранить
            </Button>
          </>
        }
      >
        {editingPh && (
          <PlaceholderControl
            placeholder={editingPh}
            value={editValue === undefined ? openValue : editValue}
            style={styles[editingPh.key]}
            onChange={(v) => setEditValue(v)}
            onStyleChange={(s) => writeValues({ ...values, placeholderStyles: { ...styles, [editingPh.key]: s } })}
            testId={`report-document-text-editor-${index}`}
          />
        )}
      </ModalDialog>

      <ModalDialog
        open={confirmOff}
        onClose={() => setConfirmOff(false)}
        size="s"
        icon={<Info size={20} aria-hidden="true" />}
        iconTone="warning"
        title="Убрать содержимое по исходу?"
        description={`Блок «${props.blockTitle ?? block.block}»`}
        footer={
          <>
            <Button variant="secondary" size="m" onClick={() => setConfirmOff(false)} data-testid={`report-block-outcome-off-cancel-${index}`}>
              Отмена
            </Button>
            <Button variant="destructive" size="m" onClick={turnOff} data-testid={`report-block-outcome-off-confirm-${index}`}>
              Убрать
            </Button>
          </>
        }
      >
        <p>
          Тексты и настройки для «Если тест пройден» и «Если тест не пройден» будут удалены. Останется
          содержимое «При любом исходе».
        </p>
      </ModalDialog>
    </div>
  );
}
