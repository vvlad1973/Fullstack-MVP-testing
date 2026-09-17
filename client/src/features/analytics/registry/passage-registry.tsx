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

import {
  Button, Card, CardBody, CardHeader, DataGrid, FilterBar, Input, ModalDialog, Stack, Tag, Text,
  type SortDir,
} from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

import { RegistryFilterDialog } from "./filter-dialog";
import { useRegistryDictionaries, useTestDictionary } from "./use-dictionaries";

import {
  countConditions,
  describeConditions,
  filterToSearch,
  EMPTY_FILTER,
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
  /**
   * Группы прохождения (FR-01, FR-09). Список, а не одно значение: у веб-попытки группа
   * выводится из членства участника, а человек состоит и в отделе, и в потоке обучения.
   */
  groups: string[];
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

/**
 * Подзаголовок реестра: сколько прохождений в выборке и из каких источников.
 *
 * Оговорка «под условия отбора» обязательна: «128 прохождений» без неё читается как весь
 * объём данных, и тогда снятие условия выглядит потерей данных, а не расширением выборки.
 */
function subtitleOf(total: number, conditions: number): string {
  const noun = pluralize(total, "прохождение", "прохождения", "прохождений");
  const scope = conditions > 0 ? "под условия отбора" : "за всё время";
  return `${total} ${noun} ${scope} · веб, телеметрия LMS и импортированные выгрузки`;
}

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
  const [saveOpen, setSaveOpen] = useState(false);
  const [sliceName, setSliceName] = useState("");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [rows, setRows] = useState<RegistryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const search = filterToSearch(filter);
  /** Названия тестов и групп — чтобы условие в чипе читалось, а не значилось кодом (FR-02). */
  const dictionaries = useRegistryDictionaries();
  // Вариант и версия называются по справочнику ТОГО теста, что стоит в условиях: у разных
  // тестов они свои, и общего перечня для них не существует.
  const testDictionary = useTestDictionary(filter.testIds.length === 1 ? filter.testIds[0] : null);

  /** Номер запроса: ответ на устаревшие условия не должен затирать свежий список. */
  const request = useRef(0);

  /**
   * Чем упорядочен реестр (FR-01a).
   *
   * Держится здесь, а не в адресе: порядок — это не выборка, и пересылать «отсортировано по
   * результату» коллеге незачем, а условия отбора в ссылке не должны шуметь.
   */
  const [sortKey, setSortKey] = useState("date");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const load = useCallback(async (offset: number) => {
    const ticket = (request.current += 1);
    setLoading(true);
    setFailed(false);
    try {
      const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
      query.set("limit", String(PAGE_SIZE));
      query.set("offset", String(offset));
      // Сортировка идёт НА СЕРВЕР: строки приходят порциями, и разложить по столбцу можно
      // лишь то, что уже пришло, — худший результат на второй странице так не найти.
      query.set("sort", sortKey);
      query.set("dir", sortDir);
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
  }, [search, sortKey, sortDir]);

  // Смена условий начинает список заново: догруженный хвост принадлежал прежней выборке.
  useEffect(() => {
    void load(0);
  }, [load]);

  // Перевод условий в подписи общий с карточкой среза (FR-07b): срез и фильтр — одна сущность,
  // и говорить о ней двумя наборами формулировок значило бы намекать на две разные выборки.
  const applied = useMemo(
    () => describeConditions(filter, { ...dictionaries, ...testDictionary }),
    [filter, dictionaries, testDictionary],
  );

  /** Снять одно условие: чип удаляется поштучно, остальные остаются (FR-02). */
  const removeCondition = (id: string) => {
    const [kind, value] = [id.slice(0, id.indexOf(":")), id.slice(id.indexOf(":") + 1)];
    if (kind === "test") onFilterChange({ ...filter, testIds: filter.testIds.filter(x => x !== value) });
    else if (kind === "group") onFilterChange({ ...filter, groupIds: filter.groupIds.filter(x => x !== value) });
    else if (kind === "source") onFilterChange({ ...filter, sources: filter.sources.filter(x => x !== value) });
    else if (kind === "outcome") onFilterChange({ ...filter, outcomes: filter.outcomes.filter(x => x !== value) });
    else if (kind === "form") onFilterChange({ ...filter, formIds: filter.formIds.filter(x => x !== value) });
    else if (kind === "snapshot") {
      onFilterChange({ ...filter, snapshotIds: filter.snapshotIds.filter(x => x !== value) });
    }
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
      sortable: true,
      render: (row: RegistryRow) => <span className="ou-grid__cell-strong">{row.participant}</span>,
    },
    { key: "test", header: "Тест", sortable: true, render: (row: RegistryRow) => row.testTitle },
    { key: "date", header: "Дата", sortable: true, render: (row: RegistryRow) => formatMoment(row.startedAt) },
    {
      key: "result",
      sortable: true,
      header: "Результат",
      numeric: true,
      // Прочерк, а не ноль: у прохождения без оценивания результата нет (PRD-29 §6.7).
      render: (row: RegistryRow) => (row.percent === null ? "—" : `${Math.round(row.percent)} %`),
    },
    {
      key: "outcome",
      sortable: true,
      header: "Исход",
      render: (row: RegistryRow) => (
        <Tag tone={outcomeTone(row.outcome)}>{OUTCOME_LABEL[row.outcome]}</Tag>
      ),
    },
    {
      key: "source",
      sortable: true,
      header: "Источник",
      render: (row: RegistryRow) => <Tag>{SOURCE_LABEL[row.source]}</Tag>,
    },
    {
      key: "group",
      header: "Группа",
      // «Без группы» — это факт о прохождении, а не отсутствие данных, поэтому словом, а не
      // прочерком: прочерк здесь читался бы как «группу не посчитали». Так же названа строка
      // среза по группам, и два экрана говорят об одном одинаково (FR-09).
      // Поле читается мягко: строка приходит из сети, и отсутствие списка (ответ ручки прежнего
      // выпуска) должно давать «без группы», а не ронять таблицу целиком.
      render: (row: RegistryRow) => ((row.groups ?? []).length > 0
        ? row.groups.join(", ")
        : <Text variant="body-s" tone="muted">без группы</Text>),
    },
  ];

  const hasMore = rows.length < total;
  const conditionCount = countConditions(filter);

  /** Сохранить текущий отбор срезом (FR-07c). */
  const saveSlice = async () => {
    setSaveError(null);
    try {
      const response = await fetch("/api/analytics/slices", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: sliceName.trim(),
          testId: filter.testIds[0] ?? null,
          conditions: filter,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(data.error ?? "Не удалось сохранить срез");
      }
      setSaveOpen(false);
      setSliceName("");
    } catch (error) {
      setSaveError((error as Error).message);
    }
  };

  return (
    <Card>
      <CardHeader
        title="Реестр прохождений"
        subtitle={subtitleOf(total, conditionCount)}
      />
      <CardBody>
        {/* Тело карточки — обычный блок без собственных отступов между детьми, поэтому строка
            отбора и таблица слипались вплотную. Между РАЗНЫМИ блоками модульная сетка требует
            16px, и расставляет их примитив, а не поля у соседей. */}
        <Stack gap={4}>
          <FilterBar
            count={conditionCount}
            applied={applied}
            actions={
              <>
                {actions}
                <Button
                  variant="ghost"
                  size="s"
                  // FR-07c: сохранять нечего, пока не отобрано ничего. Кнопка выключена, а не
                  // спрятана: спрятанная не объясняет, почему действия нет.
                  disabled={conditionCount === 0}
                  onClick={() => setSaveOpen(true)}
                >
                  Сохранить как срез
                </Button>
              </>
            }
            onOpenFilter={() => setFilterOpen(true)}
            onRemove={removeCondition}
            onReset={() => onFilterChange(EMPTY_FILTER)}
            resetLabel="Сбросить фильтры"
          />

          <ModalDialog
            open={saveOpen}
            onClose={() => setSaveOpen(false)}
            size="s"
            title="Сохранить как срез"
            description="Срез хранит УСЛОВИЯ отбора и пересчитывается при каждом открытии: это не снимок состава участников"
            footer={
              <>
                <Button variant="ghost" size="m" onClick={() => setSaveOpen(false)}>Отмена</Button>
                <Button
                  variant="primary"
                  size="m"
                  disabled={!sliceName.trim()}
                  onClick={() => void saveSlice()}
                >
                  Сохранить
                </Button>
              </>
            }
          >
            <Stack gap={3}>
              <label htmlFor="slice-name">
                <Text variant="body-s">Название среза</Text>
              </label>
              <Input
                id="slice-name"
                value={sliceName}
                onChange={event => setSliceName(event.target.value)}
                placeholder="Например: Розница, не сдали"
              />
              <Text variant="body-xs" tone="muted">
                Условий в отборе: {conditionCount}. Под них сейчас подходит {total} прохождений —
                завтра число может быть другим, потому что срез считается заново.
              </Text>
              {saveError && <Text tone="error">{saveError}</Text>}
          </Stack>
        </ModalDialog>

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
            // Реестр и есть содержимое экрана: без этого он листался бы в окошке на 540px,
            // под которым остаётся пустой монитор.
            fill
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
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
        </Stack>
      </CardBody>
    </Card>
  );
}
