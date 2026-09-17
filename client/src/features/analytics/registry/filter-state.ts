/**
 * @module features/analytics/registry/filter-state
 * @description PRD-56 FR-03: условия отбора реестра живут в адресе страницы.
 *
 * Ссылку на выборку пересылают коллеге, и он должен увидеть ровно ту же — поэтому адрес несёт
 * все условия и переживает круговой рейс без потерь. Обратная сторона: ссылка приходит извне,
 * с чужими метками рассылок и опечатками, и разбор обязан пережить любой мусор. Всё, что не
 * похоже на условие, игнорируется молча: экран аналитики не место для сообщений об ошибках
 * чужого адреса.
 *
 * Модуль чистый — ни React, ни истории браузера: так его можно проверить без DOM, а страница
 * решает сама, когда писать адрес.
 */

/** Источник прохождения. Совпадает с `ObservationSource` сервера. */
export type RegistrySource = "web" | "telemetry" | "import";

/** Исход прохождения. Совпадает с `ObservationOutcome` сервера. */
export type RegistryOutcome = "passed" | "failed" | "completed" | "incomplete";

/** Условия отбора реестра. Пустые массивы и отсутствующие даты означают «без условия». */
export interface RegistryFilter {
  testIds: string[];
  groupIds: string[];
  sources: RegistrySource[];
  outcomes: RegistryOutcome[];
  /** Границы периода в формате `ГГГГ-ММ-ДД`; каждая необязательна. */
  from?: string;
  to?: string;
}

const SOURCES: readonly string[] = ["web", "telemetry", "import"];
const OUTCOMES: readonly string[] = ["passed", "failed", "completed", "incomplete"];

/** Пустой фильтр — то, что видит пользователь, открывший реестр без ссылки. */
export const EMPTY_FILTER: RegistryFilter = {
  testIds: [], groupIds: [], sources: [], outcomes: [],
};

/**
 * Значения параметра: он может прийти повторами (`?testId=a&testId=b`) или списком
 * (`?testId=a,b`). Оба вида встречаются в ссылках, набранных руками, и оба читаются.
 */
function valuesOf(params: URLSearchParams, name: string): string[] {
  return params
    .getAll(name)
    .flatMap(value => value.split(","))
    .map(value => value.trim())
    .filter(Boolean);
}

/** Дата вида `ГГГГ-ММ-ДД`, если это действительно дата. */
function dateOf(raw: string | null): string | undefined {
  if (!raw || !/^\d{4}-\d{2}-\d{2}$/.test(raw)) return undefined;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return undefined;
  // `2026-13-45` разбирается в «валидную» дату другого месяца — сверяем обратной сборкой.
  return parsed.toISOString().slice(0, 10) === raw ? raw : undefined;
}

/** Разобрать строку запроса в условия отбора. */
export function parseFilter(search: string): RegistryFilter {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const from = dateOf(params.get("from"));
  const to = dateOf(params.get("to"));

  return {
    testIds: valuesOf(params, "testId"),
    groupIds: valuesOf(params, "groupId"),
    sources: valuesOf(params, "source").filter((s): s is RegistrySource => SOURCES.includes(s)),
    outcomes: valuesOf(params, "outcome").filter((o): o is RegistryOutcome => OUTCOMES.includes(o)),
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
  };
}

/**
 * Собрать строку запроса из условий.
 *
 * Пустые условия в адрес не пишутся: `?testId=&source=` выглядит как отбор, которого нет, и
 * такую ссылку неприятно и пересылать, и читать.
 */
export function filterToSearch(filter: Partial<RegistryFilter>): string {
  const params = new URLSearchParams();
  for (const id of filter.testIds ?? []) params.append("testId", id);
  for (const id of filter.groupIds ?? []) params.append("groupId", id);
  for (const source of filter.sources ?? []) params.append("source", source);
  for (const outcome of filter.outcomes ?? []) params.append("outcome", outcome);
  if (filter.from) params.set("from", filter.from);
  if (filter.to) params.set("to", filter.to);

  const search = params.toString();
  return search ? `?${search}` : "";
}

/** Есть ли хоть одно условие. От этого зависит вторая строка `FilterBar` и кнопка сброса. */
export function isEmptyFilter(filter: RegistryFilter): boolean {
  return filter.testIds.length === 0
    && filter.groupIds.length === 0
    && filter.sources.length === 0
    && filter.outcomes.length === 0
    && !filter.from
    && !filter.to;
}

/** Как называются источники и исходы там, где условие показывают человеку. */
const SOURCE_LABEL: Record<string, string> = {
  web: "веб",
  telemetry: "телеметрия LMS",
  import: "импорт",
};

const OUTCOME_LABEL: Record<string, string> = {
  passed: "сдал",
  failed: "не сдал",
  completed: "завершено",
  incomplete: "не завершено",
};

/** Справочники названий: без них условие читается идентификатором и не проверяется глазом. */
export interface ConditionDictionaries {
  tests: Array<{ id: string; title: string }>;
  groups: Array<{ id: string; name: string }>;
}

/**
 * Условия отбора словами — одинаково в чипах реестра и в карточке среза (FR-02, FR-07f).
 *
 * Перевод один на оба места намеренно: срез и фильтр — одна и та же сущность (FR-07b), и два
 * описания одного набора условий однажды разошлись бы формулировками, а читатель решил бы,
 * что разошлись сами выборки.
 *
 * Название, а не идентификатор: по «6e10d1e6-0fc9…» отбор нельзя ни проверить, ни объяснить
 * коллеге. Справочник не доехал — остаётся идентификатор: условие названо хуже, но показано.
 */
export function describeConditions(
  filter: RegistryFilter,
  dictionaries: ConditionDictionaries,
): Array<{ id: string; label: string }> {
  const testTitle = (id: string) => dictionaries.tests.find(test => test.id === id)?.title ?? id;
  const groupName = (id: string) => dictionaries.groups.find(group => group.id === id)?.name ?? id;

  const items: Array<{ id: string; label: string }> = [];
  for (const id of filter.testIds) items.push({ id: `test:${id}`, label: `Тест: ${testTitle(id)}` });
  for (const id of filter.groupIds) items.push({ id: `group:${id}`, label: `Группа: ${groupName(id)}` });
  for (const source of filter.sources) {
    items.push({ id: `source:${source}`, label: `Источник: ${SOURCE_LABEL[source] ?? source}` });
  }
  for (const outcome of filter.outcomes) {
    items.push({ id: `outcome:${outcome}`, label: `Исход: ${OUTCOME_LABEL[outcome] ?? outcome}` });
  }
  if (filter.from || filter.to) {
    items.push({ id: "period", label: `Период: ${filter.from ?? "…"} — ${filter.to ?? "…"}` });
  }
  return items;
}

/**
 * Условия сохранённого среза в фильтр реестра.
 *
 * Срез хранит условия тем же языком, что фильтр (FR-07b), но приезжает из базы нетипизированным
 * объектом: он мог быть сохранён прежним выпуском или отредактирован руками. Всё, что не похоже
 * на условие, отбрасывается молча — по тому же правилу, что и разбор адреса страницы.
 */
export function conditionsToFilter(raw: unknown): RegistryFilter {
  const source = (raw ?? {}) as Record<string, unknown>;
  const strings = (value: unknown): string[] =>
    (Array.isArray(value) ? value : []).filter((item): item is string => typeof item === "string");
  const date = (value: unknown): string | undefined =>
    (typeof value === "string" ? dateOf(value) : undefined);

  return {
    testIds: strings(source.testIds),
    groupIds: strings(source.groupIds),
    sources: strings(source.sources).filter((s): s is RegistrySource => SOURCES.includes(s)),
    outcomes: strings(source.outcomes).filter((o): o is RegistryOutcome => OUTCOMES.includes(o)),
    ...(date(source.from) ? { from: date(source.from) } : {}),
    ...(date(source.to) ? { to: date(source.to) } : {}),
  };
}

/** Сколько условий применено — счётчик на кнопке фильтра. */
export function countConditions(filter: RegistryFilter): number {
  return filter.testIds.length
    + filter.groupIds.length
    + filter.sources.length
    + filter.outcomes.length
    + (filter.from || filter.to ? 1 : 0);
}
