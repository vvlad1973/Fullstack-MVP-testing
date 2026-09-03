/**
 * @module features/tests/review/review-comment-form
 * @description PRD-52 FR-18/FR-18a: форма нового комментария.
 *
 * Три режима, различающиеся ТОЛЬКО источником места:
 *   - `player` — место берётся с текущего экрана прогона и показывается как есть;
 *   - `editor` — место выбирается явно, по умолчанию «тест в целом»;
 *   - `reply`  — места нет вовсе: ответ наследует якорь ветки.
 */
import { useState } from "react";
import { Button, Cluster, Select, Stack, Tag, Text, Textarea } from "@universityrt/ui-kit";
import type { ReviewAnchor } from "@shared/review/anchor";

export interface ReviewCommentFormProps {
  mode: "player" | "editor" | "reply";
  /** Место текущего экрана — режим `player`. */
  screenAnchor?: ReviewAnchor;
  /** Разделы теста для выбора места — режим `editor`. */
  topics?: { id: string; name: string }[];
  busy?: boolean;
  onCancel: () => void;
  onSubmit: (input: { body: string; anchor?: ReviewAnchor }) => void | Promise<void>;
}

/** Человеческое имя места, показываемое в режиме прогона. */
function anchorLabel(anchor?: ReviewAnchor): string {
  if (!anchor) return "Тест в целом";
  if (anchor.kind === "question") return "Текущий вопрос";
  if (anchor.kind === "content-page") return "Текущая страница";
  if (anchor.kind === "topic") return "Текущий раздел";
  if (anchor.kind === "start") return "Стартовый экран";
  if (anchor.kind === "results") return "Экран итогов";
  return "Тест в целом";
}

export function ReviewCommentForm({
  mode, screenAnchor, topics = [], busy, onCancel, onSubmit,
}: ReviewCommentFormProps) {
  const [body, setBody] = useState("");
  const [place, setPlace] = useState<string>("test");

  const anchor: ReviewAnchor | undefined =
    mode === "reply" ? undefined
      : mode === "player" ? (screenAnchor ?? { kind: "test" })
        : place === "test" ? { kind: "test" }
          : place === "start" ? { kind: "start" }
            : place === "results" ? { kind: "results" }
              : { kind: "topic", topicId: place };

  const placeOptions = [
    { value: "test", label: "Тест в целом" },
    ...topics.map((t) => ({ value: t.id, label: `Раздел «${t.name}»` })),
    { value: "start", label: "Стартовый экран" },
    { value: "results", label: "Экран итогов" },
  ];

  return (
    <Stack gap={3} className="rvp__form">
      {mode === "player" ? (
        <Stack gap={1}>
          <Text variant="body-s" tone="muted">Место</Text>
          <span>
            <Tag variant="outline" tone="accent">{anchorLabel(screenAnchor)}</Tag>
          </span>
          <Text variant="body-xs" tone="muted">Подставлено автоматически по текущему экрану.</Text>
        </Stack>
      ) : null}

      {mode === "editor" ? (
        <Select
          label="Место"
          value={place}
          onChange={(value) => setPlace(String(value))}
          options={placeOptions}
          data-testid="anchor-place"
        />
      ) : null}

      <Textarea
        label={mode === "reply" ? "Ответ" : "Комментарий"}
        rows={4}
        value={body}
        placeholder="Что не так и что предлагаете изменить"
        onChange={(e) => setBody(e.target.value)}
        data-testid="comment-body"
      />

      <Cluster gap={2} align="center">
        <Button variant="ghost" size="s" onClick={onCancel}>Отмена</Button>
        <span className="rvp__spacer" />
        <Button
          variant="primary"
          size="s"
          disabled={!body.trim() || busy}
          onClick={() => onSubmit({ body: body.trim(), anchor })}
          data-testid="submit-comment"
        >
          {mode === "reply" ? "Ответить" : "Добавить"}
        </Button>
      </Cluster>
    </Stack>
  );
}
