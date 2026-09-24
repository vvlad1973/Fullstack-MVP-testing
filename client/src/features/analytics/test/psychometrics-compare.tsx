/**
 * @module features/analytics/test/psychometrics-compare
 * @description PRD-66 FR-04b — FR-04c: сравнение психометрики по срезам.
 *
 * Свой механизм сравнения трек НЕ заводит. Режим, слоты, подписи условий и правила берутся у
 * раздела «Аналитика» (PRD-56 FR-07) — меняется только СОДЕРЖИМОЕ таблиц: вместо «назначено,
 * начато, сдали» здесь надёжность, ошибка измерения, число заданий под подозрением и трудность
 * по заданиям. Один механизм обязан выглядеть одинаково на обоих экранах, иначе автор учит его
 * дважды.
 *
 * КОЛОНКА «РАЗНИЦА» ПОЯВЛЯЕТСЯ ТОЛЬКО ПРИ ДВУХ СРЕЗАХ (FR-04b2). При трёх и четырёх разница
 * между какими двумя из них — вопрос без ответа, а выбирать «эталонный» срез продукт не умеет
 * и такой сущности не заводит. У СЧЁТНЫХ строк её нет и при двух: разность счётчиков говорит о
 * размере группы, а не о качестве теста.
 *
 * РАЗНИЦА НЕ ТОЛКУЕТСЯ КАК ПРОВЕРКА ЗАДАНИЯ НА СПРАВЕДЛИВОСТЬ К ГРУППЕ (FR-04c): она смешивает
 * разную подготовку срезов и разное поведение задания, и таблица их не разделяет. Поэтому
 * колонка даёт число и НЕ называет его причину, а слова DIF на экране нет.
 */
import {
  Card, CardBody, CardHeader, DataGrid, Stack, Text,
} from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

/** Психометрика одного среза — то, что отдаёт `GET .../psychometrics/:testId/slices`. */
export interface PsychometricsSlice {
  id: string;
  name: string;
  alpha: number | null;
  reliabilityGap: string | null;
  sem: number | null;
  respondents: number;
  observations: number;
  itemsCount: number;
  suspiciousCount: number;
  items: Array<{
    questionId: string;
    prompt: string;
    difficulty: number | null;
    itemRest: number | null;
    observations: number;
  }>;
}

export interface PsychometricsCompareProps {
  slices: PsychometricsSlice[];
}

/** Число с запятой; прочерк там, где величины нет. */
function num(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits).replace(".", ",");
}

/** Разница со знаком — читается как направление, а не как модуль. */
function delta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${Math.abs(value).toFixed(2).replace(".", ",")}`;
}

/** Строка сводной таблицы: показатель, значения по срезам и признак сопоставимости. */
interface SummaryRow {
  key: string;
  label: string;
  /**
   * Сопоставимая величина: у неё разницу считать МОЖНО.
   *
   * Счётные строки (участники, наблюдения, число заданий под подозрением) сопоставимыми не
   * считаются: их разность — про размер группы, а не про качество теста.
   */
  comparable: boolean;
  valueOf: (slice: PsychometricsSlice) => number | null;
  format: (value: number | null, slice: PsychometricsSlice) => string;
}

const SUMMARY_ROWS: SummaryRow[] = [
  {
    key: "alpha",
    label: "Надёжность (альфа)",
    comparable: true,
    valueOf: slice => slice.alpha,
    format: (value, slice) => value === null
      // Причина отказа важнее прочерка: «посчитать не на чем» и «низкая надёжность» — разное.
      ? (slice.reliabilityGap ? "не посчитана" : "—")
      : num(value),
  },
  {
    key: "sem",
    label: "Ошибка измерения",
    comparable: true,
    valueOf: slice => slice.sem,
    format: value => num(value),
  },
  {
    key: "suspicious",
    label: "Заданий под подозрением",
    comparable: false,
    valueOf: slice => slice.suspiciousCount,
    format: (value, slice) => `${value ?? 0} из ${slice.itemsCount}`,
  },
  {
    key: "respondents",
    label: "Участников в расчёте",
    comparable: false,
    valueOf: slice => slice.respondents,
    format: value => String(value ?? 0),
  },
];

/** Сравнение психометрики по срезам. */
export function PsychometricsCompare({ slices }: PsychometricsCompareProps) {
  if (slices.length < 2) {
    return (
      <Card variant="outlined">
        <CardBody>
          <Text variant="body-s" tone="muted">
            Для сравнения нужны хотя бы два среза.
          </Text>
        </CardBody>
      </Card>
    );
  }

  // Разница считается ТОЛЬКО при двух срезах: при трёх и четырёх «разница между какими двумя»
  // — вопрос без ответа, и колонки нет вовсе.
  const pairwise = slices.length === 2;

  const summaryColumns = [
    {
      key: "metric",
      header: "Показатель",
      frozen: true,
      render: (row: SummaryRow) => <span>{row.label}</span>,
    },
    ...slices.map(slice => ({
      key: `slice-${slice.id}`,
      header: slice.name,
      numeric: true,
      render: (row: SummaryRow) => (
        <Text variant="body-s">{row.format(row.valueOf(slice), slice)}</Text>
      ),
    })),
    ...(pairwise
      ? [{
        key: "delta",
        header: "Разница",
        numeric: true,
        render: (row: SummaryRow) => {
          // У счётной строки — прочерк даже при двух срезах.
          if (!row.comparable) return <Text variant="body-s" tone="muted">—</Text>;
          const first = row.valueOf(slices[0]);
          const second = row.valueOf(slices[1]);
          if (first === null || second === null) return <Text variant="body-s" tone="muted">—</Text>;
          return <Text variant="body-s">{delta(first - second)}</Text>;
        },
      }]
      : []),
  ];

  /** Задания, встреченные хотя бы в одном срезе: объединение, а не пересечение. */
  const questions = new Map<string, string>();
  for (const slice of slices) {
    for (const item of slice.items) questions.set(item.questionId, item.prompt || item.questionId);
  }
  const itemRows = [...questions].map(([questionId, prompt]) => ({ questionId, prompt }));

  const difficultyOf = (slice: PsychometricsSlice, questionId: string) =>
    slice.items.find(item => item.questionId === questionId)?.difficulty ?? null;

  const itemColumns = [
    {
      key: "question",
      header: "Задание",
      frozen: true,
      width: "40%",
      render: (row: { questionId: string; prompt: string }) => (
        <span className="tb-psy-prompt">{row.prompt}</span>
      ),
    },
    ...slices.map(slice => ({
      key: `slice-${slice.id}`,
      header: slice.name,
      numeric: true,
      render: (row: { questionId: string }) => (
        <Text variant="body-s">{num(difficultyOf(slice, row.questionId))}</Text>
      ),
    })),
    ...(pairwise
      ? [{
        key: "delta",
        header: "Разница",
        numeric: true,
        render: (row: { questionId: string }) => {
          const first = difficultyOf(slices[0], row.questionId);
          const second = difficultyOf(slices[1], row.questionId);
          // Задание, не попавшее в выдачу одного из срезов, — это факт о сравнении, и
          // прочерк честно говорит «здесь его не было».
          if (first === null || second === null) return <Text variant="body-s" tone="muted">—</Text>;
          return <Text variant="body-s">{delta(first - second)}</Text>;
        },
      }]
      : []),
  ];

  return (
    <Stack gap={4}>
      <Card variant="outlined">
        <CardHeader
          title="Надёжность и ошибка измерения"
          subtitle={`${slices.length} ${pluralize(slices.length, "срез", "среза", "срезов")}${pairwise ? "" : " · разница считается только при двух срезах"}`}
        />
        <CardBody>
          <DataGrid
            columns={summaryColumns}
            rows={SUMMARY_ROWS}
            rowKey={row => row.key}
            emptyMessage="Сравнивать нечего"
          />
        </CardBody>
      </Card>

      <Card variant="outlined">
        <CardHeader
          title="Трудность по заданиям"
          subtitle="Задание, не попавшее в выдачу среза, отмечено прочерком"
        />
        <CardBody>
          <DataGrid
            columns={itemColumns}
            rows={itemRows}
            rowKey={row => row.questionId}
            emptyMessage="Заданий с наблюдениями нет"
          />
        </CardBody>
      </Card>
    </Stack>
  );
}
