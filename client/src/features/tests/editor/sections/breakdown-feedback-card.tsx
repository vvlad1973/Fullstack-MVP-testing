/**
 * @module features/tests/editor/sections/breakdown-feedback-card
 * @description PRD-50 FR-50: карточка «По подтемам (тегам)» вкладки «Обратная связь и
 * итоги» — текст и рекомендации на каждую подтему теста.
 *
 * До этой правки текст мог висеть только на теме, и компетенции приходилось заводить
 * темами. Теперь подтема — тег вопросов внутри темы — получает свой текст в том же
 * формате, что и тема, и он хранится своей колонкой раздела
 * (`test_sections.breakdown_feedback_json`).
 *
 * Кого из написанного прочитает участник, решает НЕ эта карточка: правило владельца
 * (2026-09-03) — текст выдаётся, когда результат по подтеме ниже общего проходного порога
 * теста, при любом вердикте, — живёт в `shared/breakdown/feedback` и работает одинаково на
 * экране итогов, в отчёте и в SCORM-пакете. Здесь только авторская правка.
 */
import { useMemo, useState } from "react";
import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Card, CardBody, CardHeader, FormSection } from "@universityrt/ui-kit";
import { FeedbackEditorModal, type FeedbackEditorValue } from "./feedback-editor-modal";
import { FeedbackPreview } from "./feedback-preview";
import { buildTagsByTopic, type QuestionTagRow } from "./topics-structure-section";
import type { BreakdownFeedbackEntry, TestEditorModel } from "../test-editor.types";

export type BreakdownFeedbackCardProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/** Пустое содержимое подтемы: так выглядит подтема, о которой автор ещё не писал. */
const EMPTY: BreakdownFeedbackEntry = { format: "plain", text: "", links: [], assets: [], events: [] };

/**
 * Карточка правки текстов подтем: раздел -> его подтемы -> предпросмотр с карандашом.
 *
 * Перечень подтем берётся из ВОПРОСОВ темы, а не из порогов: подтема существует ровно
 * потому, что ею размечены вопросы, и список порогов (легаси с Э1) сказал бы о ней не то.
 */
export function BreakdownFeedbackCard({
  model,
  updateModel,
}: BreakdownFeedbackCardProps): React.JSX.Element {
  const { data: allQuestions = [] } = useQuery<QuestionTagRow[]>({
    queryKey: ["/api/questions"],
  });
  const tagsByTopic = useMemo(() => buildTagsByTopic(allQuestions), [allQuestions]);
  const sections = model.sections.filter(
    (section) => (tagsByTopic.get(section.topicId)?.tags.length ?? 0) > 0,
  );

  if (model.sections.length === 0) {
    return (
      <Banner
        tone="info"
        title="Сначала добавьте темы"
        description="Подтемы — это теги вопросов внутри темы. Добавьте темы во вкладке «Состав и сценарий», и их подтемы появятся здесь."
        data-testid="breakdown-feedback-no-topics"
      />
    );
  }

  if (sections.length === 0) {
    return (
      <Banner
        tone="info"
        title="У вопросов нет подтем"
        description="Подтема — это тег вопроса. Разметьте вопросы тегами в редакторе вопросов, и здесь появится текст на каждую подтему."
        data-testid="breakdown-feedback-no-tags"
      />
    );
  }

  const setKey = (topicId: string, key: string, next: BreakdownFeedbackEntry | null) =>
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((section) => {
        if (section.topicId !== topicId) return section;
        const keys: Record<string, BreakdownFeedbackEntry> = { ...(section.breakdownFeedback ?? {}) };
        // Пустой текст без вложений — это «автор передумал»: ключ снимается, а не остаётся
        // пустой записью. Иначе тест возил бы в базе пустышки, а карточка показывала бы
        // разницу между «не писал» и «стёр», которой нет.
        if (next === null) delete keys[key];
        else keys[key] = next;
        return {
          ...section,
          breakdownFeedback: Object.keys(keys).length > 0 ? keys : null,
        };
      }),
    }));

  return (
    <Card variant="outlined" size="sm" data-testid="breakdown-feedback-card">
      <CardHeader
        title="По подтемам (тегам)"
        subtitle="Текст выдаётся, когда результат по подтеме ниже общего проходного порога теста, — независимо от того, сдан тест или нет."
      />
      <CardBody>
        {sections.map((section) => (
          <FormSection key={section.topicId} title={section.topicName} stacked>
            {(tagsByTopic.get(section.topicId)?.tags ?? []).map((tag) => {
              const value = section.breakdownFeedback?.[tag] ?? EMPTY;
              return (
                <TagFeedbackRow
                  key={tag}
                  topicId={section.topicId}
                  tag={tag}
                  value={value}
                  onSave={(next) => setKey(section.topicId, tag, next)}
                />
              );
            })}
          </FormSection>
        ))}
      </CardBody>
    </Card>
  );
}

/** Одна подтема: предпросмотр написанного и модалка правки — та же, что у темы и теста. */
function TagFeedbackRow(props: {
  topicId: string;
  tag: string;
  value: BreakdownFeedbackEntry;
  onSave: (next: BreakdownFeedbackEntry | null) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { value, tag } = props;
  const testId = `breakdown-feedback-${props.topicId}-${tag}`;
  return (
    <div className="ou-formfield">
      <label className="ou-formfield__lbl">{tag}</label>
      <FeedbackPreview
        format={value.format}
        text={value.text}
        links={value.links ?? []}
        assets={value.assets ?? []}
        events={value.events ?? []}
        onEdit={() => setOpen(true)}
        editAriaLabel={`Редактировать обратную связь подтемы «${tag}»`}
        testId={testId}
      />
      <FeedbackEditorModal
        open={open}
        title={`Обратная связь подтемы «${tag}»`}
        description="Текст и материалы, которые получит участник, если результат по этой подтеме ниже общего проходного порога теста."
        value={{
          format: value.format,
          text: value.text,
          links: value.links ?? [],
          assets: value.assets ?? [],
          events: value.events ?? [],
        }}
        onCancel={() => setOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          const empty =
            v.text.trim() === "" &&
            v.links.length === 0 &&
            v.assets.length === 0 &&
            (v.events ?? []).length === 0;
          props.onSave(
            empty
              ? null
              : {
                  format: v.format,
                  text: v.text,
                  links: v.links,
                  assets: v.assets,
                  events: v.events ?? [],
                },
          );
          setOpen(false);
        }}
        testId={`${testId}-modal`}
      />
    </div>
  );
}
