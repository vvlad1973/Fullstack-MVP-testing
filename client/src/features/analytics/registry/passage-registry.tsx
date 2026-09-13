/**
 * @module features/analytics/registry/passage-registry
 * @description PRD-56 FR-01 - FR-03: реестр прохождений — рабочее место оценщика.
 *
 * Плоский список всех источников: участник, тест, дата, попытка, результат, исход, источник,
 * группа. Постраничности нет (FR-01c) — подвал говорит, сколько строк показано из скольких, и
 * следующая порция приходит при прокрутке.
 *
 * Условия отбора компонент не хранит: они приходят сверху и уходят наверх изменёнными, потому
 * что живут в адресе страницы (FR-03) — ссылку на выборку пересылают коллеге.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { DataGrid, FilterBar, Tag, Text } from "@skillum/ui-kit";

import { RegistryFilterDialog } from "./filter-dialog";

import {
  countConditions,
  filterToSearch,
  type RegistryFilter,
  type RegistryOutcome,
  type RegistrySource,
} from "./filter-state";

/** Строка реестра — то, что отдаёт `GET /api/analytics/registry`. */
export interface RegistryRow {
  id: string;
  participant: string;
  participantKey: string | null;
  userId: string | null;
  testId: string | null;
  testTitle: string;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  percent: number | null;
  passed: boolean | null;
  outcome: RegistryOutcome;
  source: RegistrySource;
  groupId: string | null;
}

export interface PassageRegistryProps {
  filter: RegistryFilter;
  onFilterChange: (filter: RegistryFilter) => void;
  /** Открыть разбор прохождения. Без него строка не кликается. */
  onOpenPassage?: (row: RegistryRow) => void;
  /** Что показать справа в первой строке панели фильтра (например, кнопку экспорта). */
  actions?: React.ReactNode;
}

/** Сколько строк просим за раз. Совпадает с умолчанием ручки. */
const PAGE_SIZE = 25;

const SOURCE_LABEL: Record<RegistrySource, string> = {
  web: "веб",
  telemetry: "телеметрия LMS",
  import: "импорт",
};

const OUTCOME_LABEL: Record<RegistryOutcome, string> = {
  passed: "сдал",
  failed: "не сдал",
  completed: "завершено",
  incomplete: "не завершено",
};

/** Дата и время прохождения — как их читает человек. */
function formatMoment(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Тон исхода: цвет несёт тот же смысл, что и слово. */
function outcomeTone(outcome: RegistryOutcome): "success" | "error" | "neutral" {
  if (outcome === "passed") return "success";
  if (outcome === "failed") return "error";
  return "neutral";
}

export function PassageRegistry({
  filter, onFilterChange, onOpenPassage, actions,
}: PassageRegistryProps) {
  const [filterOpen, setFilterOpen] = useState(false);
  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const search = filterToSearch(filter);

  /** Номер запроса: ответ на устаревшие условия не должен затирать свежий список. */
  const request = useRef(0);

  const load = useCallback(async (offset: number) => {
    const ticket = (request.current += 1);
    setLoading(true);
    setFailed(false);
    try {
      const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
      query.set("limit", String(PAGE_SIZE));
      query.set("offset", String(offset));
      const response = await fetch(`/api/analytics/registry?${query.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { rows: RegistryRow[]; total: number };
      if (ticket !== request.current) return;
      setRows(prev => (offset === 0 ? data.rows : [...prev, ...data.rows]));
      setTotal(data.total);
    } catch {
      if (ticket === request.current) setFailed(true);
    } finally {
      if (ticket === request.current) setLoading(false);
    }
  }, [search]);

  // Смена условий начинает список заново: догруженный хвост принадлежал прежней выборке.
  useEffect(() => {
    void load(0);
  }, [load]);

  const applied = useMemo(() => {
    const items: Array<{ id: string; label: string }> = [];
    for (const id of filter.testIds) items.push({ id: `test:${id}`, label: `Тест: ${id}` });
    for (const id of filter.groupIds) items.push({ id: `group:${id}`, label: `Группа: ${id}` });
    for (const source of filter.sources) {
      items.push({ id: `source:${source}`, label: `Источник: ${SOURCE_LABEL[source]}` });
    }
    for (const outcome of filter.outcomes) {
      items.push({ id: `outcome:${outcome}`, label: `Исход: ${OUTCOME_LABEL[outcome]}` });
    }
    if (filter.from || filter.to) {
      items.push({
        id: "period",
        label: `Период: ${filter.from ?? "…"} — ${filter.to ?? "…"}`,
      });
    }
    return items;
  }, [filter]);

  /** Снять одно условие: чип удаляется поштучно, остальные остаются (FR-02). */
  const removeCondition = (id: string) => {
    const [kind, value] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (kind === "test") onFilterChange({ ...filter, testIds: filter.testIds.filter(x => x !== value) });
    else if (kind === "group") onFilterChange({ ...filter, groupIds: filter.groupIds.filter(x => x !== value) });
    else if (kind === "source") onFilterChange({ ...filter, sources: filter.sources.filter(x => x !== value) });
    else if (kind === "outcome") onFilterChange({ ...filter, outcomes: filter.outcomes.filter(x => x !== value) });
    else if (id === "period") {
      const { from: _from, to: _to, ...rest } = filter;
      onFilterChange({ ...rest });
    }
  };

  const columns = [
    {
      key: "participant",
      header: "Участник",
      frozen: true,
      render: (row: RegistryRow) => <span className="ou-grid__cell-strong">{row.participant}</span>,
    },
    { key: "test", header: "Тест", render: (row: RegistryRow) => row.testTitle },
    { key: "date", header: "Дата", render: (row: RegistryRow) => formatMoment(row.startedAt) },
    {
      key: "result",
      header: "Результат",
      numeric: true,
      // Прочерк, а не ноль: у прохождения без оценивания результата нет (PRD-29 §6.7).
      render: (row: RegistryRow) => (row.percent === null ? "—" : `${Math.round(row.percent)} %`),
    },
    {
      key: "outcome",
      header: "Исход",
      render: (row: RegistryRow) => (
        <Tag tone={outcomeTone(row.outcome)}>{OUTCOME_LABEL[row.outcome]}</Tag>
      ),
    },
    {
      key: "source",
      header: "Источник",
      render: (row: RegistryRow) => <Tag>{SOURCE_LABEL[row.source]}</Tag>,
    },
  ];

  const hasMore = rows.length < total;

  return (
    <div>
      <FilterBar
        count={countConditions(filter)}
        applied={applied}
        actions={actions}
        onOpenFilter={() => setFilterOpen(true)}
        onRemove={removeCondition}
        onReset={() => onFilterChange({ testIds: [], groupIds: [], sources: [], outcomes: [] })}
        resetLabel="Сбросить фильтры"
      />

      <RegistryFilterDialog
        open={filterOpen}
        filter={filter}
        onApply={onFilterChange}
        onClose={() => setFilterOpen(false)}
      />

      {failed ? (
        <Text tone="error">Не удалось загрузить прохождения. Обновите страницу.</Text>
      ) : (
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={row => row.id}
          total={total}
          hasMore={hasMore}
          loadingMore={loading}
          onLoadMore={() => void load(rows.length)}
          onRowClick={onOpenPassage ? row => onOpenPassage(row) : undefined}
          emptyMessage={
            loading
              ? "Загружаем прохождения…"
              : countConditions(filter) > 0
                ? "Под эти условия не подошло ни одного прохождения. Снимите условие или расширьте период."
                : "Прохождений пока нет"
          }
        />
      )}
    </div>
  );
}
