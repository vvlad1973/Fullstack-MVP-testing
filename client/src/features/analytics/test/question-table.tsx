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
import { useEffect, useMemo, useState } from "react";

import { Ban } from "lucide-react";

import {
  Button, Card, CardBody, CardHeader, DataGrid, ModalDialog, SegmentedControl, Stack, Text,
} from "@skillum/ui-kit";

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
  /** PRD-56 FR-17a: задание исключено из выдачи ЭТОГО теста. */
  excludedFromDelivery?: boolean;
}

export interface QuestionTableProps {
  questions: QuestionRow[];
  /** Уйти в реестр к прохождениям, где на этом задании ошиблись (FR-17). */
  onOpenRegistry?: (questionId: string) => void;
  /** Переключить состояние «исключён из выдачи» (FR-17a). Без него действие не предлагается. */
  onDeliveryChange?: (questionId: string, excluded: boolean) => void;
  /** Тест, у которого спрашиваются последствия исключения. */
  testId?: string;
}

/** Последствия исключения — то, что отдаёт `GET .../delivery-impact` (FR-17b). */
interface DeliveryImpact {
  topicName: string;
  remaining: number;
  drawCount: number;
  allowed: boolean;
}

type View = "all" | "review" | "excluded";
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

export function QuestionTable({
  questions, onOpenRegistry, onDeliveryChange, testId,
}: QuestionTableProps) {
  const [view, setView] = useState<View>("all");
  const [sortKey, setSortKey] = useState("correct");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  /** Задание, для которого открыто окно подтверждения исключения. */
  const [pending, setPending] = useState<QuestionRow | null>(null);
  const [impact, setImpact] = useState<DeliveryImpact | null>(null);

  const flagged = useMemo(
    () => questions.filter(question => question.reviewFlags.length > 0),
    [questions],
  );
  const excludedRows = useMemo(
    () => questions.filter(question => question.excludedFromDelivery),
    [questions],
  );

  // Последствия спрашиваются у сервера при открытии окна: считать остаток пула на клиенте
  // значило бы завести вторую копию правил выдачи, которая однажды разойдётся с первой.
  useEffect(() => {
    if (!pending) {
      setImpact(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/tests/${testId}/questions/${pending.questionId}/delivery-impact`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as DeliveryImpact;
        if (alive) setImpact(data);
      } catch {
        // Вслепую окно подтверждения не спрашивает: без последствий кнопка остаётся
        // выключенной, а читателю сказано, что считаем.
        if (alive) setImpact(null);
      }
    })();
    return () => { alive = false; };
  }, [pending, testId]);

  const rows = useMemo(() => {
    const shown = view === "review" ? flagged : view === "excluded" ? excludedRows : questions;
    return [...shown].sort((a, b) => {
      const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [questions, flagged, excludedRows, view, sortKey, sortDir]);

  const columns = [
    {
      key: "question",
      header: "Задание",
      frozen: true,
      render: (row: QuestionRow) => (
        <Stack gap={1}>
          <Stack direction="row" gap={2} align="center">
            <QuestionTypeIcon type={row.questionType as QuestionType} />
            {/*
              FR-17a: состояние выдачи метится перечёркнутым кругом с подсказкой, а НЕ тегом:
              тег стоит в одном ряду с темой и подтемой и читается как ярлык содержания, а
              речь идёт о состоянии выдачи.
            */}
            {row.excludedFromDelivery && (
              <span
                className="tb-qscoring__qtype"
                title="Исключён из выдачи — в новые прохождения не попадает"
                aria-label="Исключён из выдачи"
              >
                <Ban size={16} color="var(--ou-error-default)" aria-hidden="true" />
              </span>
            )}
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
      key: "delivery",
      header: "",
      render: (row: QuestionRow) => {
        if (!onDeliveryChange) return null;
        return row.excludedFromDelivery ? (
          <Button
            variant="ghost"
            size="s"
            // Возврат ничего не отнимает и подтверждения не требует (FR-17b).
            aria-label={`Вернуть в выдачу: ${row.questionPrompt}`}
            onClick={() => onDeliveryChange(row.questionId, false)}
          >
            Вернуть в выдачу
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="s"
            aria-label={`Исключить из выдачи: ${row.questionPrompt}`}
            onClick={() => setPending(row)}
          >
            Исключить
          </Button>
        );
      },
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
              { value: "excluded", label: "Исключённые", badge: excludedRows.length },
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
            : view === "excluded"
              ? "Из выдачи ничего не исключено"
              : "Заданий в выдаче пока нет"}
        />
      </CardBody>

      {/*
        FR-17b: исключение подтверждается отдельным окном, и окно называет последствия числами.
        Невыполнимая выдача ЗАПРЕЩАЕТ действие, а не сопровождает его предупреждением: тест,
        который нельзя собрать, ломается у участника на старте попытки.
      */}
      <ModalDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        size="s"
        title="Исключить задание из выдачи?"
        description={pending?.questionPrompt}
        footer={
          <>
            <Button variant="ghost" size="m" onClick={() => setPending(null)}>Отмена</Button>
            <Button
              variant="primary"
              size="m"
              disabled={!impact?.allowed}
              onClick={() => {
                if (pending && onDeliveryChange) onDeliveryChange(pending.questionId, true);
                setPending(null);
              }}
            >
              Исключить
            </Button>
          </>
        }
      >
        <Stack gap={3}>
          {impact === null ? (
            <Text tone="muted">Считаем, сколько заданий останется в теме…</Text>
          ) : (
            <>
              <Text>
                В теме «{impact.topicName}» останется {impact.remaining} заданий, а выдавать
                нужно {impact.drawCount}.
              </Text>
              {!impact.allowed && (
                <Text tone="error">
                  Выдачу собрать будет нельзя: заданий в теме меньше, чем требует раздел.
                  Уменьшите число выдаваемых заданий или добавьте новые.
                </Text>
              )}
            </>
          )}
          <Text variant="body-s" tone="muted">
            Опубликованная версия не меняется: пока тест не опубликован заново, и веб, и
            выгруженный пакет SCORM продолжают выдавать это задание по снимку.
          </Text>
        </Stack>
      </ModalDialog>
    </Card>
  );
}
