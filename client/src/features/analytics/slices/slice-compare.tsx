/**
 * @module features/analytics/slices/slice-compare
 * @description PRD-56 FR-07, FR-07a, FR-07g: режим сравнения срезов.
 *
 * Сравниваемые срезы названы явно — их имена стоят в заголовках столбцов, и читателю не нужно
 * помнить, что с чем сравнивается. Это и есть причина, по которой «база» из продукта убрана:
 * невидимая величина, с которой всё молча сравнивалось, порождала числа, необъяснимые на месте.
 */
import { useEffect, useMemo, useState } from "react";

import { Button, Text } from "@skillum/ui-kit";

import type { SliceRow } from "./slice-list";

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

export function SliceCompare({ testId, from, to }: SliceCompareProps) {
  const [available, setAvailable] = useState<SliceRow[]>([]);
  const [chosen, setChosen] = useState<string[]>([]);
  const [failed, setFailed] = useState(false);

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

  return (
    <div>
      <div className="ou-stack ou-stack--row ou-stack--wrap ou-stack--gap-2">
        {available
          .filter(slice => !chosen.includes(slice.id))
          .map(slice => (
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
      </div>

      {full && (
        <Text variant="body-s" tone="muted">
          Сравнивают не больше четырёх срезов: пятая колонка перестаёт читаться, а «сравнить все
          группы разом» — это разбиение по оси, а не сравнение.
        </Text>
      )}

      {selected.length === 0 ? (
        <Text tone="muted">Выберите срезы, которые нужно сравнить.</Text>
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
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selected.length > 0 && (
        <Button variant="ghost" size="s" onClick={() => setChosen([])}>
          Очистить сравнение
        </Button>
      )}
    </div>
  );
}
