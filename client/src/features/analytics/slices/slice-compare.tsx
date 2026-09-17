/**
 * @module features/analytics/slices/slice-compare
 * @description PRD-56 FR-07, FR-07a, FR-07g: режим сравнения срезов.
 *
 * Сравниваемые срезы названы явно — их имена стоят в заголовках столбцов, и читателю не нужно
 * помнить, что с чем сравнивается. Это и есть причина, по которой «база» из продукта убрана:
 * невидимая величина, с которой всё молча сравнивалось, порождала числа, необъяснимые на месте.
 */
import { useEffect, useMemo, useState } from "react";

import { Button, Card, CardBody, Chip, Cluster, EmptyState, Stack, Text } from "@skillum/ui-kit";

import { conditionsToFilter, describeConditions } from "../registry/filter-state";
import { useRegistryDictionaries } from "../registry/use-dictionaries";

import type { SliceRow, SliceTopic } from "./slice-list";

export interface SliceCompareProps {
  /** Тест — общее условие сравнения (FR-07e): он один для всех сравниваемых срезов. */
  testId: string;
  from?: string;
  to?: string;
}

/**
 * Сколько срезов можно сравнивать.
 *
 * Предел содержательный, а не вёрсточный: пятая колонка перестаёт читаться, а «сравнить все
 * группы разом» — это разбиение по оси (список срезов), а не сравнение (FR-07g).
 */
const MAX_SLICES = 4;

/** Показатели сравнения: что именно сопоставляется построчно. */
const ROWS: Array<{
  key: keyof SliceRow;
  label: string;
  /** Доля — у неё разницу считать можно; объём — нельзя. */
  share: boolean;
}> = [
  { key: "assigned", label: "Назначено", share: false },
  { key: "started", label: "Начато", share: false },
  { key: "completed", label: "Завершено", share: false },
  { key: "participants", label: "Участников", share: false },
  { key: "passRate", label: "Сдали", share: true },
  { key: "avgPercent", label: "Средний результат", share: true },
];

/** Значение показателя в ячейке. */
function cell(slice: SliceRow, key: keyof SliceRow, share: boolean): string {
  if (share && !slice.enoughData) return "мало данных";
  const value = slice[key];
  if (value === null || value === undefined) return "—";
  return share ? `${Math.round(Number(value))} %` : String(value);
}

/**
 * Разница между двумя срезами — только у долей и только когда обе доли есть.
 *
 * Разница ОБЪЁМОВ говорит о размере группы, а не о качестве обучения: «в рознице на двоих
 * больше» — не вывод, а состав штата, и ставить это число рядом с разницей долей значит
 * приглашать читателя сложить их в одну мысль.
 */
function difference(a: SliceRow, b: SliceRow, key: keyof SliceRow): string | null {
  if (!a.enoughData || !b.enoughData) return null;
  const first = a[key];
  const second = b[key];
  if (typeof first !== "number" || typeof second !== "number") return null;
  const delta = Math.round(first - second);
  return `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)} п.п.`;
}

/**
 * Сколько условий помещается в карточке среза до свёртки (FR-07f).
 *
 * Три — не вёрсточный предел, а читательский: карточка должна опознаваться взглядом, а не
 * читаться построчно. Остальные не исчезают: они названы в «ещё N» и целиком видны подсказкой.
 */
const VISIBLE_CONDITIONS = 3;

/**
 * Карточка сравниваемого среза: имя и условия, по которым он отобран (FR-07f).
 *
 * Условия показаны рядом с именем, потому что имя даёт срезу автор и оно может обещать не то,
 * что срез считает. Читатель сравнения обязан видеть, ЧТО именно сравнивается, не уходя в
 * форму отбора.
 */
function SliceCard(props: {
  slice: SliceRow;
  conditions: Array<{ id: string; label: string }>;
  onRemove: () => void;
}) {
  const visible = props.conditions.slice(0, VISIBLE_CONDITIONS);
  const hidden = props.conditions.slice(VISIBLE_CONDITIONS);

  return (
    <Card>
      <CardBody>
        <Stack gap={2}>
          <Stack direction="row" gap={2} align="center" justify="between">
            <Text variant="body-s" weight="semibold">{props.slice.name}</Text>
            <Button variant="ghost" size="s" onClick={props.onRemove}>Убрать</Button>
          </Stack>
          <Cluster gap={2}>
            {props.conditions.length === 0 ? (
              // Срез без условий — это «тест целиком» (FR-07a), и сказать об этом надо словом:
              // пустая карточка читается как незагрузившаяся.
              <Text variant="body-xs" tone="muted">без условий — тест целиком</Text>
            ) : (
              <>
                {visible.map(condition => (
                  <Chip key={condition.id} size="s">{condition.label}</Chip>
                ))}
                {hidden.length > 0 && (
                  <Chip size="s" title={hidden.map(condition => condition.label).join("; ")}>
                    ещё {hidden.length}
                  </Chip>
                )}
              </>
            )}
          </Cluster>
        </Stack>
      </CardBody>
    </Card>
  );
}

/**
 * Темы, которые есть хотя бы у одного сравниваемого среза (FR-07).
 *
 * Объединение, а не пересечение: тема, не попавшая в выдачу одной из групп, — это факт о
 * сравнении, и прятать её значило бы молча укоротить разговор. У такого среза в ячейке
 * прочерк, и он честно говорит «этих вопросов здесь не было».
 */
function topicsOfAll(slices: readonly SliceRow[]): Array<{ id: string; name: string }> {
  const names = new Map<string, string>();
  for (const slice of slices) {
    for (const topic of slice.topics ?? []) names.set(topic.topicId, topic.topicName);
  }
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Доля верных ответов среза по одной теме. */
function topicOf(slice: SliceRow, topicId: string): SliceTopic | undefined {
  return (slice.topics ?? []).find(topic => topic.topicId === topicId);
}

export function SliceCompare({ testId, from, to }: SliceCompareProps) {
  const [available, setAvailable] = useState<SliceRow[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);
  /** Названия тестов и групп — чтобы условие в карточке среза читалось, а не значилось кодом. */
  const dictionaries = useRegistryDictionaries();

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ testId, withWhole: "1" });
    if (from) query.set("from", from);
    if (to) query.set("to", to);

    void (async () => {
      try {
        const response = await fetch(`/api/analytics/slices?${query.toString()}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { slices: SliceRow[] };
        if (alive) setAvailable(data.slices);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => { alive = false; };
  }, [testId, from, to]);

  const selected = useMemo(
    () => chosen
      .map(id => available.find(slice => slice.id === id))
      .filter((slice): slice is SliceRow => !!slice),
    [chosen, available],
  );

  if (failed) {
    return <Text tone="error">Не удалось загрузить срезы. Обновите страницу.</Text>;
  }

  const full = chosen.length >= MAX_SLICES;
  const showDifference = selected.length === 2;
  const topicRows = topicsOfAll(selected);

  const addable = available.filter(slice => !chosen.includes(slice.id));

  return (
    <Stack gap={4}>
      <Cluster gap={2}>
        {addable.map(slice => (
          <Button
            key={slice.id}
            variant="secondary"
            size="s"
            disabled={full}
            onClick={() => setChosen(prev => [...prev, slice.id])}
          >
            Добавить срез: {slice.name}
          </Button>
        ))}
      </Cluster>

      {full && (
        <Text variant="body-s" tone="muted">
          Сравнивают не больше четырёх срезов: пятая колонка перестаёт читаться, а «сравнить все
          группы разом» — это разбиение по оси, а не сравнение.
        </Text>
      )}

      {/* Карточки сравниваемых срезов с их условиями (FR-07f). */}
      {selected.length > 0 && (
        <Cluster gap={3} align="start">
          {selected.map(slice => (
            <SliceCard
              key={slice.id}
              slice={slice}
              conditions={describeConditions(conditionsToFilter(slice.conditions), dictionaries)}
              onRemove={() => setChosen(prev => prev.filter(id => id !== slice.id))}
            />
          ))}
        </Cluster>
      )}

      {selected.length === 0 ? (
        // Срезов может не быть вовсе: тогда сравнивать нечего, и экран обязан сказать, где их
        // берут, — иначе он выглядит сломанным (кнопок нет, таблицы нет, объяснения нет).
        <EmptyState
          layout="inline"
          title={addable.length === 0
            ? "Сохранённых срезов пока нет"
            : "Выберите срезы, которые нужно сравнить"}
          description={addable.length === 0
            ? "Срез сохраняют на вкладке «Прохождения»: отберите нужные условия в фильтре и нажмите «Сохранить как срез»."
            : "Добавьте два среза — тогда появится столбец «Разница»."}
        />
      ) : (
        <div className="ou-grid">
          <div className="ou-grid__scroll">
            <table className="ou-grid__table" role="table">
              <thead>
                <tr>
                  <th><div className="ou-grid__th">Показатель</div></th>
                  {selected.map(slice => (
                    <th key={slice.id}>
                      <div className="ou-grid__th">{slice.name}</div>
                    </th>
                  ))}
                  {showDifference && <th><div className="ou-grid__th">Разница</div></th>}
                </tr>
              </thead>
              <tbody>
                {ROWS.map(row => (
                  <tr key={String(row.key)}>
                    <td className="ou-grid__cell-strong">{row.label}</td>
                    {selected.map(slice => (
                      <td key={slice.id} className="is-numeric">
                        {cell(slice, row.key, row.share)}
                      </td>
                    ))}
                    {showDifference && (
                      <td className="is-numeric">
                        {/* Разница только у долей: вычитать объёмы — значит называть
                            разницу в составе штата результатом обучения. */}
                        {row.share ? difference(selected[0], selected[1], row.key) ?? "—" : "—"}
                      </td>
                    )}
                  </tr>
                ))}

                {/* FR-07: доли верных ПО ТЕМАМ — ради них сравнение и затевают. Разница по теме
                    считается по тому же правилу, что у прочих долей: обе стороны должны иметь
                    число, иначе сравнивать нечего. Единица счёта названа в подписи строки —
                    это доля ОТВЕТОВ, а не доля прошедших тему (FR-14a). */}
                {topicRows.length > 0 && (
                  <tr>
                    <td className="ou-grid__cell-strong" colSpan={selected.length + (showDifference ? 2 : 1)}>
                      Доля верных ответов по темам
                    </td>
                  </tr>
                )}
                {topicRows.map(topic => {
                  const shares = selected.map(slice => topicOf(slice, topic.id));
                  const comparable = showDifference
                    && shares[0]?.correctShare !== null && shares[0] !== undefined
                    && shares[1]?.correctShare !== null && shares[1] !== undefined;
                  const delta = comparable
                    ? Math.round((shares[0]!.correctShare as number) - (shares[1]!.correctShare as number))
                    : null;
                  return (
                    <tr key={topic.id}>
                      <td>{topic.name}</td>
                      {shares.map((share, index) => (
                        <td key={selected[index].id} className="is-numeric">
                          {share === undefined || share.correctShare === null
                            ? "—"
                            : `${Math.round(share.correctShare)} %`}
                        </td>
                      ))}
                      {showDifference && (
                        <td className="is-numeric">
                          {delta === null
                            ? "—"
                            : `${delta > 0 ? "+" : delta < 0 ? "−" : ""}${Math.abs(delta)} п.п.`}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <Cluster gap={2}>
          <Button variant="ghost" size="s" onClick={() => setChosen([])}>
            Очистить сравнение
          </Button>
        </Cluster>
      )}
    </Stack>
  );
}
