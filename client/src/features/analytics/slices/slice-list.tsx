/**
 * @module features/analytics/slices/slice-list
 * @description PRD-56 FR-06, FR-06c, FR-06d, FR-08: список срезов.
 *
 * Показывает ФАКТЫ: сколько начали, сколько дошли до конца, сколько сдали и с каким средним.
 * Отклонений от невидимой на экране величины здесь нет (FR-06c) — за сравнением ведёт отдельный
 * режим с явно названными срезами.
 *
 * Ниже порога наблюдений процент не печатается: вместо него «мало данных» и сам объём выборки
 * (FR-06d). Объём показывается всегда — «81 % из 12» и «81 % из 340» читаются по-разному.
 */
import { useEffect, useState } from "react";

import { Button, DataGrid, Text } from "@skillum/ui-kit";

/** Срез с посчитанными величинами — то, что отдаёт `GET /api/analytics/slices`. */
export interface SliceRow {
  id: string;
  name: string;
  conditions: Record<string, unknown>;
  started: number;
  completed: number;
  passed: number;
  participants: number;
  passRate: number | null;
  avgPercent: number | null;
  enoughData: boolean;
}

export interface SliceListProps {
  /** Тест — рамка расчёта. Без него средние не считаются (решение 2 спеки). */
  testId: string;
  /** Период как рамка; пустой означает «за всё время» (FR-07j). */
  from?: string;
  to?: string;
  /** Ось разбиения. Без неё показываются сохранённые срезы. */
  axis?: string;
  /** Перейти в реестр с условиями среза (FR-08). */
  onOpenRegistry?: (conditions: Record<string, unknown>) => void;
}

/** Процент для чтения человеком: без десятых, которых в таких числах всё равно нет. */
function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} %`;
}

export function SliceList({ testId, from, to, axis, onOpenRegistry }: SliceListProps) {
  const [slices, setSlices] = useState<SliceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    const query = new URLSearchParams({ testId });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (axis) query.set("axis", axis);

    void (async () => {
      try {
        const response = await fetch(`/api/analytics/slices?${query.toString()}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { slices: SliceRow[] };
        if (!alive) return;
        setSlices(data.slices);
      } catch {
        // Пустой список на месте ошибки читается как «данных нет» — это разные вещи, и
        // молчать о второй нельзя: по «нет данных» принимают решение, по ошибке — обновляют.
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [testId, from, to, axis]);

  if (failed) {
    return <Text tone="error">Не удалось загрузить срезы. Обновите страницу.</Text>;
  }

  const columns = [
    {
      key: "name",
      header: "Срез",
      frozen: true,
      render: (row: SliceRow) => <span className="ou-grid__cell-strong">{row.name}</span>,
    },
    { key: "started", header: "Начато", numeric: true, render: (row: SliceRow) => row.started },
    {
      key: "completed",
      header: "Завершено",
      numeric: true,
      render: (row: SliceRow) => row.completed,
    },
    {
      key: "participants",
      header: "Участников",
      numeric: true,
      render: (row: SliceRow) => row.participants,
    },
    {
      key: "passRate",
      header: "Сдали",
      numeric: true,
      // «Мало данных» вместо процента — и это не то же самое, что прочерк: прочерк говорит
      // «нечего оценивать», а здесь оценивать есть что, просто выборка мала.
      render: (row: SliceRow) => (row.enoughData
        ? percent(row.passRate)
        : <Text variant="body-s" tone="muted">мало данных</Text>),
    },
    {
      key: "avgPercent",
      header: "Средний результат",
      numeric: true,
      render: (row: SliceRow) => (row.enoughData
        ? percent(row.avgPercent)
        : <Text variant="body-s" tone="muted">мало данных</Text>),
    },
    {
      key: "actions",
      header: "",
      render: (row: SliceRow) => (onOpenRegistry ? (
        <Button
          variant="ghost"
          size="s"
          onClick={() => onOpenRegistry(row.conditions)}
        >
          Прохождения: {row.name}
        </Button>
      ) : null),
    },
  ];

  return (
    <DataGrid
      columns={columns}
      rows={slices}
      rowKey={row => row.id}
      emptyMessage={loading ? "Считаем срезы…" : "Срезов пока нет"}
    />
  );
}
