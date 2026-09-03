/**
 * @module features/tests/editor/sections/topic-feedback-card
 * @description PRD-29 §7.1a: карточка «По темам» вкладки «Обратная связь и итоги».
 *
 * Обратная связь темы в тесте РАЗРЕШАЕТСЯ одним значением: задан текст раздела — печатается
 * он, не задан — печатается текст самой темы. Сложение двух текстов признано дефектом
 * (ученик получал склейку, которую автор нигде не видел), поэтому карточка показывает
 * именно РАЗРЕШЁННЫЙ текст — ровно то, что получит участник, — и называет его источник.
 *
 * Правка всегда пишется на уровне ТЕСТА (`test_sections.feedback_json`): тема общая для
 * многих тестов, и менять её отсюда значило бы править чужие тесты. «Сбросить до установок
 * темы» снимает эту правку, и текст снова приходит из темы.
 */
import { useState } from "react";
import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Button, Card, CardBody, CardHeader, FormSection, Tag } from "@universityrt/ui-kit";
import { RotateCcw } from "lucide-react";
import { FeedbackEditorModal, type FeedbackEditorValue } from "./feedback-editor-modal";
import { FeedbackPreview } from "./feedback-preview";
import type {
  EditorSection,
  FeedbackAsset,
  FeedbackContent,
  FeedbackEvent,
  FeedbackLink,
  TestEditorModel,
} from "../test-editor.types";

/** Строка темы в том виде, в каком её отдаёт `/api/topics`. */
type TopicRow = {
  id: string;
  name?: string;
  /** Нынешний источник текста темы. */
  feedbackJson?: {
    format?: FeedbackContent["format"];
    text?: string;
    links?: FeedbackLink[];
    assets?: FeedbackAsset[];
    events?: FeedbackEvent[];
  } | null;
  /** Легаси-колонка: у темы, которой редактор тем не касался, весь текст лежит здесь. */
  feedback?: string | null;
};

export type TopicFeedbackCardProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/** Своя правка раздела: хоть что-то из текста и материалов. */
function hasOwnFeedback(section: EditorSection): boolean {
  return (
    section.feedback.text.trim() !== "" ||
    section.feedbackLinks.length > 0 ||
    section.feedbackAssets.length > 0 ||
    section.feedbackEvents.length > 0
  );
}

/**
 * Карточка «По темам»: на каждую тему теста — разрешённый текст, его источник и правка.
 */
export function TopicFeedbackCard({
  model,
  updateModel,
}: TopicFeedbackCardProps): React.JSX.Element {
  const { data: topics = [] } = useQuery<TopicRow[]>({ queryKey: ["/api/topics"] });
  const byId = new Map(topics.map((t) => [t.id, t]));

  if (model.sections.length === 0) {
    return (
      <Banner
        tone="info"
        title="Сначала добавьте темы"
        description="Обратная связь пишется на темы теста. Добавьте их во вкладке «Состав и сценарий», и они появятся здесь."
        data-testid="topic-feedback-no-topics"
      />
    );
  }

  const setSection = (topicId: string, patch: Partial<EditorSection>) =>
    updateModel((m) => ({
      ...m,
      sections: m.sections.map((s) => (s.topicId === topicId ? { ...s, ...patch } : s)),
    }));

  return (
    <Card variant="outlined" size="sm" data-testid="topic-feedback-card">
      <CardHeader
        title="По темам"
        subtitle="Участник получает ОДИН текст на тему: заданный в этом тесте, а если он не задан — текст самой темы."
      />
      <CardBody>
        {model.sections.map((section) => (
          <TopicFeedbackRow
            key={section.topicId}
            section={section}
            topic={byId.get(section.topicId)}
            onSave={(patch) => setSection(section.topicId, patch)}
          />
        ))}
      </CardBody>
    </Card>
  );
}

/** Одна тема: разрешённый текст, подпись источника, правка и сброс. */
function TopicFeedbackRow(props: {
  section: EditorSection;
  topic?: TopicRow;
  onSave: (patch: Partial<EditorSection>) => void;
}): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const { section, topic } = props;
  const own = hasOwnFeedback(section);
  // Разрешение — то же правило, что печатает выдача (`topicFeedbackTexts`): своя правка
  // теста ЗАМЕНЯЕТ текст темы целиком, а не дополняет его.
  const topicBlock = topic?.feedbackJson ?? null;
  const topicLegacy = typeof topic?.feedback === "string" ? topic.feedback : "";
  const resolved = own
    ? {
        format: section.feedback.format,
        text: section.feedback.text,
        links: section.feedbackLinks,
        assets: section.feedbackAssets,
        events: section.feedbackEvents,
      }
    : {
        format: topicBlock?.format ?? "plain",
        text: (topicBlock?.text ?? "").trim() || topicLegacy,
        links: topicBlock?.links ?? [],
        assets: topicBlock?.assets ?? [],
        events: topicBlock?.events ?? [],
      };
  const testId = `topic-feedback-${section.topicId}`;
  return (
    <FormSection title={section.topicName} stacked>
      <div className="ou-formfield">
        <div className="tb-topic-feedback__head">
          <Tag size="s" variant="soft" data-testid={`${testId}-source`}>
            {own ? "Задано в этом тесте" : "Из темы"}
          </Tag>
          {own && (
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<RotateCcw size={14} aria-hidden="true" />}
              onClick={() =>
                props.onSave({
                  feedback: { format: "plain", text: "" },
                  feedbackLinks: [],
                  feedbackAssets: [],
                  feedbackEvents: [],
                })
              }
              data-testid={`${testId}-reset`}
            >
              Сбросить до установок темы
            </Button>
          )}
        </div>
        <FeedbackPreview
          format={resolved.format}
          text={resolved.text}
          links={resolved.links}
          assets={resolved.assets}
          events={resolved.events}
          onEdit={() => setOpen(true)}
          editAriaLabel={`Редактировать обратную связь темы «${section.topicName}»`}
          emptyLabel="Не задано — ни в теме, ни в этом тесте"
          testId={testId}
        />
      </div>
      <FeedbackEditorModal
        open={open}
        title={`Обратная связь темы «${section.topicName}»`}
        description="Текст сохраняется в ЭТОМ тесте и заменяет собой текст темы. Сама тема не меняется — её текст останется у других тестов."
        value={resolved}
        onCancel={() => setOpen(false)}
        onSave={(v: FeedbackEditorValue) => {
          props.onSave({
            feedback: { format: v.format, text: v.text },
            feedbackLinks: v.links,
            feedbackAssets: v.assets,
            feedbackEvents: v.events ?? [],
          });
          setOpen(false);
        }}
        testId={`${testId}-modal`}
      />
    </FormSection>
  );
}
