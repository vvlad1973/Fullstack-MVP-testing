/**
 * @module features/analytics/attention/attention-queue
 * @description PRD-56 FR-10, FR-11: очередь «требует внимания».
 *
 * Единственный экран аналитики, который говорит «сделай». Отсюда два правила показа: у каждой
 * позиции названа ПРИЧИНА, по которой она здесь, и из каждой есть ход к участнику и его
 * прохождению. Список дел без причины превращается в список претензий.
 */
import { useEffect, useState } from "react";

import { Button, Card, CardBody, CardHeader, DataGrid, Tag, Text } from "@skillum/ui-kit";

/** Вид дела. Совпадает с `AttentionKind` сервера. */
export type AttentionKind = "overdue" | "failed" | "abandoned" | "exhausted";

export interface AttentionRow {
  kind: AttentionKind;
  participantId: string | null;
  participant: string;
  testId: string | null;
  testTitle: string;
  observationId?: string;
  dueAt?: string;
  startedAt?: string;
}

export interface AttentionQueueProps {
  /** Открыть прохождение позиции. Там, где прохождения нет, ход не предлагается. */
  onOpenPassage?: (row: AttentionRow) => void;
}

/** Причина, по которой дело попало в очередь: словами, а не кодом. */
const REASON: Record<AttentionKind, string> = {
  overdue: "Срок истёк, к тесту не приступали",
  failed: "Не сдал, попытки остались",
  abandoned: "Начал и не завершил",
  exhausted: "Попытки исчерпаны, тест не сдан",
};

/** Тон причины: исчерпанные попытки требуют решения человека, остальное — напоминания. */
const TONE: Record<AttentionKind, "error" | "warning" | "neutral"> = {
  overdue: "warning",
  failed: "warning",
  abandoned: "neutral",
  exhausted: "error",
};

/** Дата для человека. */
function formatDate(iso?: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function AttentionQueue({ onOpenPassage }: AttentionQueueProps) {
  const [rows, setRows] = useState<AttentionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/analytics/attention", { credentials: "include" });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { items: AttentionRow[] };
        if (alive) setRows(data.items);
      } catch {
        // Ошибку нельзя показывать как пустую очередь: «дел нет» — это разрешение
        // заниматься чем-то другим, и выдавать его по сбою загрузки нечестно.
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  if (failed) {
    return <Text tone="error">Не удалось загрузить очередь. Обновите страницу.</Text>;
  }

  const columns = [
    {
      key: "participant",
      header: "Участник",
      frozen: true,
      render: (row: AttentionRow) => (row.observationId && onOpenPassage ? (
        <Button variant="ghost" size="s" onClick={() => onOpenPassage(row)}>
          {row.participant}
        </Button>
      ) : (
        <span className="ou-grid__cell-strong">{row.participant}</span>
      )),
    },
    { key: "test", header: "Тест", render: (row: AttentionRow) => row.testTitle },
    {
      key: "reason",
      header: "Что случилось",
      render: (row: AttentionRow) => <Tag tone={TONE[row.kind]}>{REASON[row.kind]}</Tag>,
    },
    {
      key: "when",
      header: "Когда",
      render: (row: AttentionRow) => formatDate(row.dueAt ?? row.startedAt),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Требует внимания"
        subtitle="Дела, по которым нужно действие: напомнить, назначить пересдачу, разобраться"
      />
      <CardBody>
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={row => `${row.kind}:${row.participantId ?? row.participant}:${row.testId ?? ""}`}
          emptyMessage={loading ? "Собираем очередь…" : "Дел нет"}
        />
      </CardBody>
    </Card>
  );
}
