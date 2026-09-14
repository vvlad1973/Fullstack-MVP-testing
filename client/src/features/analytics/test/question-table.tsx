/**
 * @module features/analytics/test/question-table
 * @description PRD-56 FR-15, FR-16, FR-17, FR-22: таблица заданий теста.
 *
 * Одна строка отвечает на вопрос «что с этим заданием»: доля верных, пропуски, экспозиция,
 * время и авторская трудность рядом. Тип задания — пиктограммой, той же, что в дереве контента
 * и в таблице «Оценка» редактора: словом он занимал бы колонку, ничего к ней не добавляя.
 *
 * Вид «требуют ревизии» — отбор по СОШЕДШИМСЯ признакам, и каждый назван словами прямо в
 * строке: вид без объяснения читается как приговор заданию, а решение принимает автор.
 *
 * У измерительного задания доли верных нет вовсе (FR-22): эталона у него не существует, и ноль
 * в этой колонке был бы про него ложью — поэтому прочерк.
 */
import { useMemo, useState } from "react";

import { Button, Card, CardBody, CardHeader, DataGrid, SegmentedControl, Stack, Text } from "@skillum/ui-kit";

import type { QuestionType } from "@shared/questions/question-type";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { pluralize } from "@/lib/i18n";

/** Признак ревизии — то, что отдаёт `GET /api/analytics/tests/:testId`. */
export interface ReviewFlagView {
  kind: string;
  reason: string;
}

/** Строка таблицы заданий. */
export interface QuestionRow {
  questionId: string;
  questionPrompt: string;
  questionType: string;
  topicName: string;
  difficulty: number;
  totalAnswers: number;
  gradedAnswers: number;
  correctAnswers: number;
  /** `null` — оценивать было нечего (измерительное задание). */
  correctPercent: number | null;
  /** Доля пропусков; `null` — состав выдачи неизвестен (прохождения только из LMS). */
  skipShare: number | null;
  exposurePercent: number | null;
  latencyMedianMs: number | null;
  latencySampleSize: number;
  reviewFlags: ReviewFlagView[];
}

export interface QuestionTableProps {
  questions: QuestionRow[];
  /** Уйти в реестр к прохождениям, где на этом задании ошиблись (FR-17). */
  onOpenRegistry?: (questionId: string) => void;
}

type View = "all" | "review";
type SortDir = "asc" | "desc";

/** Процент для чтения человеком; прочерк там, где величины нет. */
function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} %`;
}

/** Время на задание: минуты и секунды, как их читают. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Значение для сортировки: отсутствующее всегда уезжает в конец. */
function sortValue(row: QuestionRow, key: string): number {
  const value = key === "correct" ? row.correctPercent
    : key === "skip" ? row.skipShare
      : key === "exposure" ? row.exposurePercent
        : key === "latency" ? row.latencyMedianMs
          : key === "difficulty" ? row.difficulty
            : row.totalAnswers;
  return value ?? Number.POSITIVE_INFINITY;
}

export function QuestionTable({ questions, onOpenRegistry }: QuestionTableProps) {
  const [view, setView] = useState<View>("all");
  const [sortKey, setSortKey] = useState("correct");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const flagged = useMemo(
    () => questions.filter(question => question.reviewFlags.length > 0),
    [questions],
  );

  const rows = useMemo(() => {
    const shown = view === "review" ? flagged : questions;
    return [...shown].sort((a, b) => {
      const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [questions, flagged, view, sortKey, sortDir]);

  const columns = [
    {
      key: "question",
      header: "Задание",
      frozen: true,
      render: (row: QuestionRow) => (
        <Stack gap={1}>
          <Stack direction="row" gap={2} align="center">
            <QuestionTypeIcon type={row.questionType as QuestionType} />
            <span className="ou-grid__cell-strong">{row.questionPrompt}</span>
          </Stack>
          <Text variant="body-xs" tone="muted">{row.topicName}</Text>
          {/* Признак назван прямо в строке: отбор без объяснения — это приговор без основания. */}
          {row.reviewFlags.map(flag => (
            <Text key={flag.kind} variant="body-xs" tone="warning">{flag.reason}</Text>
          ))}
        </Stack>
      ),
    },
    {
      key: "correct",
      header: "Доля верных",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => percent(row.correctPercent),
    },
    {
      key: "skip",
      header: "Пропуски",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => percent(row.skipShare),
    },
    {
      key: "exposure",
      header: "Выдаётся",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => percent(row.exposurePercent),
    },
    {
      key: "latency",
      header: "Время, медиана",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => duration(row.latencyMedianMs),
    },
    {
      key: "difficulty",
      header: "Трудность",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => row.difficulty,
    },
    {
      key: "actions",
      header: "",
      render: (row: QuestionRow) => (onOpenRegistry && row.correctPercent !== null ? (
        <Button
          variant="ghost"
          size="s"
          // Название задания — в доступном имени, а не в подписи: подпись с полным условием
          // растянула бы колонку на пол-экрана, а без названия кнопка в длинном списке
          // неотличима от соседних на слух.
          aria-label={`Прохождения с ошибкой: ${row.questionPrompt}`}
          onClick={() => onOpenRegistry(row.questionId)}
        >
          Прохождения
        </Button>
      ) : null),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Вопросы теста"
        subtitle={`${questions.length} ${pluralize(questions.length, "задание", "задания", "заданий")} в выдаче · доля пропусков считается по веб-прохождениям: состав выданной формы пакет не сообщает`}
        trail={
          <SegmentedControl
            size="s"
            value={view}
            onChange={value => setView(value as View)}
            items={[
              { value: "all", label: "Все вопросы" },
              { value: "review", label: "Требуют ревизии", badge: flagged.length },
            ]}
          />
        }
      />
      <CardBody>
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={row => row.questionId}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
          emptyMessage={view === "review"
            ? "Признаки проблем не сошлись ни у одного задания: чинить нечего"
            : "Заданий в выдаче пока нет"}
        />
      </CardBody>
    </Card>
  );
}
