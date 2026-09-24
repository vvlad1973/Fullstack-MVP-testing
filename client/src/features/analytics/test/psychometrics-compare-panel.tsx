/**
 * @module features/analytics/test/psychometrics-compare-panel
 * @description PRD-66 FR-04b: режим сравнения срезов на вкладке «Качество заданий».
 *
 * Слоты, выбор сохранённого среза и предел в четыре взяты у раздела «Аналитика» (PRD-56
 * FR-07, FR-07g) БЕЗ изменений: один механизм обязан выглядеть одинаково на обоих экранах,
 * иначе автор учит его дважды. Меняется только содержимое таблиц — их рисует
 * {@link PsychometricsCompare}.
 *
 * «Тест целиком» — законный участник сравнения и обычный срез БЕЗ условий (PRD-56 FR-07a):
 * отдельной сущности «эталон» в продукте нет, и вопрос «а как у всех?» решается тем же
 * механизмом, что сравнение двух групп.
 */
import { useEffect, useMemo, useState } from "react";

import { Button, Card, CardBody, Select, Stack, Text } from "@skillum/ui-kit";

import { PsychometricsCompare, type PsychometricsSlice } from "./psychometrics-compare";

export interface PsychometricsComparePanelProps {
  testId: string;
  /** Режим попыток: он меняет числа сильнее любого фильтра и едет в запрос как есть. */
  firstAttemptOnly?: boolean;
}

/**
 * Сколько срезов сравнивается.
 *
 * Предел содержательный, а не вёрсточный: пятая колонка перестаёт читаться, а «сравнить все
 * группы разом» — это разбиение по оси, а не сравнение (PRD-56 FR-07g).
 */
const MAX_SLICES = 4;

export function PsychometricsComparePanel({ testId, firstAttemptOnly = true }: PsychometricsComparePanelProps) {
  const [available, setAvailable] = useState<PsychometricsSlice[]>([]);
  const [slots, setSlots] = useState<Array<string | null>>(["whole", null]);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams({ withWhole: "1" });
    if (!firstAttemptOnly) query.set("firstAttemptOnly", "false");

    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/psychometrics/${testId}/slices?${query.toString()}`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { slices: PsychometricsSlice[] };
        if (alive) setAvailable(data.slices);
      } catch {
        if (alive) setFailed(true);
      }
    })();

    return () => { alive = false; };
  }, [testId, firstAttemptOnly]);

  const selected = useMemo(
    () => slots
      .map(id => (id === null ? undefined : available.find(slice => slice.id === id)))
      .filter((slice): slice is PsychometricsSlice => !!slice),
    [slots, available],
  );

  if (failed) {
    return <Text tone="error">Не удалось загрузить срезы. Обновите страницу.</Text>;
  }

  return (
    <Stack gap={4}>
      <Card variant="outlined">
        <CardBody>
          <Stack direction="row" gap={4} wrap align="start">
            {slots.map((id, index) => {
              const taken = new Set(slots.filter((value): value is string => value !== null && value !== id));
              return (
                <Stack key={index} gap={1}>
                  <Text variant="body-s" weight="medium">{`Срез ${index + 1}`}</Text>
                  <Select
                    size="s"
                    label="Сохранённый срез"
                    value={id ?? ""}
                    onChange={value => setSlots(prev => prev.map((item, at) =>
                      (at === index ? (String(value) === "" ? null : String(value)) : item)))}
                    options={[
                      { value: "", label: "— не выбран —" },
                      ...available
                        .filter(slice => !taken.has(slice.id))
                        .map(slice => ({ value: slice.id, label: slice.name })),
                    ]}
                  />
                  {slots.length > 1 ? (
                    <Button
                      variant="ghost"
                      size="s"
                      onClick={() => setSlots(prev => prev.filter((_, at) => at !== index))}
                    >
                      Убрать
                    </Button>
                  ) : null}
                </Stack>
              );
            })}
            {slots.length < MAX_SLICES ? (
              <Button variant="secondary" size="s" onClick={() => setSlots(prev => [...prev, null])}>
                Добавить срез
              </Button>
            ) : null}
          </Stack>
        </CardBody>
      </Card>

      <PsychometricsCompare slices={selected} />
    </Stack>
  );
}
