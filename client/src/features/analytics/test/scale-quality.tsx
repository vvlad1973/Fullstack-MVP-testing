/**
 * @module features/analytics/test/scale-quality
 * @description PRD-66 FR-29 — FR-32: качество измерительных ШКАЛ.
 *
 * У заданий без эталона нет ни трудности, ни дискриминации: проверять нечего. Единица анализа
 * для них — шкала, и вопрос к пункту другой: согласован ли он с остальными пунктами своей
 * шкалы и различает ли он людей вообще.
 *
 * РАСПРЕДЕЛЕНИЕ РИСУЕТСЯ ГИСТОГРАММОЙ, а не строкой долей через разделитель (FR-30a): пять
 * чисел подряд читаются как текст, и форму распределения по ним не увидеть. Мёртвый пункт
 * виден мгновенно — один столбик почти во всю высоту.
 *
 * ПРИЗНАК НЕ УТВЕРЖДАЕТ ПРИЧИНУ (FR-31a). Отрицательная корреляция пункта с остатком шкалы
 * означает ровно одно: пункт ведёт себя противоположно шкале. Причин минимум четыре, и
 * различить их можно только прочитав формулировку, чего расчёт не делает. Поэтому подпись
 * даёт ВЫЧИСЛИМОЕ следствие — какой стала бы альфа с перевёрнутым вкладом.
 */
import {
  Card, CardBody, CardHeader, DataGrid, Stack, Tag, Text, Tooltip,
} from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

/** Пункт шкалы с его психометрикой. */
export interface ScaleItemRow {
  questionId: string;
  prompt: string;
  observations: number;
  itemRest: number | null;
  distribution: number[];
  gradeLabels: string[];
  dead: boolean;
  againstScale: boolean;
  alphaIfMirrored: number | null;
}

/** Шкала целиком. */
export interface ScaleQualityRow {
  scaleKey: string;
  label: string;
  reliability:
    | { alpha: number; items: number; respondents: number; totalSd: number; dichotomous: boolean }
    | "too-few-items" | "too-few-respondents" | "no-variance";
  respondents: number;
  ipsative: boolean;
  items: ScaleItemRow[];
}

export interface ScaleQualityPanelProps {
  scales: ScaleQualityRow[];
}

/** Число с запятой; прочерк там, где величины нет. */
function num(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits).replace(".", ",");
}

/** Почему альфы нет — словами, а не пустым местом. */
const RELIABILITY_GAP: Record<string, string> = {
  "too-few-items": "в шкале меньше двух пунктов",
  "too-few-respondents": "меньше двух участников с полным набором пунктов",
  "no-variance": "все ответили одинаково",
};

/**
 * Мини-гистограмма распределения по градациям (FR-30a — FR-30c).
 *
 * До пяти градаций каждый столбик подписан словами; от шести подписи словами наезжают друг на
 * друга, поэтому под столбиками стоят номера, а словами подписаны только КРАЯ. Высота
 * отсчитывается от общей шкалы 0 — 100 %, поэтому строки таблицы сравнимы между собой.
 */
function GradeHistogram({ distribution, labels }: { distribution: number[]; labels: string[] }) {
  if (distribution.length === 0) return <Text variant="body-xs" tone="muted">—</Text>;
  const wordy = distribution.length <= 5;
  const hint = distribution
    .map((share, i) => `${labels[i] ?? i + 1}: ${Math.round(share * 100)} %`)
    .join(", ");

  return (
    <Tooltip content={hint} placement="bottom">
      <span
        className="tb-psy-hist"
        style={{ gridTemplateColumns: `repeat(${distribution.length}, 1fr)` }}
      >
        {distribution.map((share, i) => (
          <span key={i} className="tb-psy-hist__box">
            <span className="tb-psy-hist__bar" style={{ height: `${Math.round(share * 100)}%` }} />
          </span>
        ))}
        {distribution.map((_, i) => (
          <span key={`label-${i}`} className="tb-psy-hist__label ou-text ou-text--body-xs">
            {wordy
              ? labels[i] ?? String(i + 1)
              // Края — словами, середина — номерами: так подписи не наезжают друг на друга.
              : i === 0 || i === distribution.length - 1
                ? labels[i] ?? String(i + 1)
                : String(i + 1)}
          </span>
        ))}
      </span>
    </Tooltip>
  );
}

/** Вкладка качества шкал. */
export function ScaleQualityPanel({ scales }: ScaleQualityPanelProps) {
  if (scales.length === 0) {
    return (
      <Card variant="outlined">
        <CardBody>
          <Text variant="body-s" tone="muted">
            Шкал, по которым набраны наблюдения, в этом тесте нет.
          </Text>
        </CardBody>
      </Card>
    );
  }

  return (
    <Stack gap={4}>
      {scales.map(scale => {
        const reliability = typeof scale.reliability === "string" ? null : scale.reliability;

        const columns = [
          {
            key: "item",
            header: "Пункт",
            frozen: true,
            render: (row: ScaleItemRow) => (
              <Stack gap={1}>
                <span>{row.prompt}</span>
                <Text variant="body-xs" tone="muted">
                  {row.observations} {pluralize(row.observations, "ответ", "ответа", "ответов")}
                </Text>
              </Stack>
            ),
          },
          {
            key: "distribution",
            header: "Распределение ответов",
            render: (row: ScaleItemRow) => (
              <GradeHistogram distribution={row.distribution} labels={row.gradeLabels} />
            ),
          },
          {
            key: "itemRest",
            header: (
              <Tooltip
                content="Корреляция вклада пункта с вкладом остальных пунктов этой шкалы. Отрицательная означает, что пункт ведёт себя противоположно своей шкале."
                placement="bottom"
              >
                <span>Связь с остатком шкалы</span>
              </Tooltip>
            ),
            numeric: true,
            render: (row: ScaleItemRow) => <Text variant="body-s">{num(row.itemRest)}</Text>,
          },
          {
            key: "flag",
            header: "Признак",
            render: (row: ScaleItemRow) => {
              if (row.againstScale) {
                return (
                  <Stack gap={1}>
                    <Tag tone="error" size="s">Работает против шкалы</Tag>
                    {row.alphaIfMirrored !== null && reliability ? (
                      // Вычислимое следствие вместо догадки о причине (FR-31b).
                      <Text variant="body-xs" tone="muted">
                        с вкладом −1 альфа {num(reliability.alpha)} → {num(row.alphaIfMirrored)}
                      </Text>
                    ) : null}
                  </Stack>
                );
              }
              if (row.dead) {
                return (
                  <Stack gap={1}>
                    <Tag tone="warning" size="s">Мёртвый пункт</Tag>
                    <Text variant="body-xs" tone="muted">почти все ответили одинаково</Text>
                  </Stack>
                );
              }
              return <Text variant="body-xs" tone="muted">—</Text>;
            },
          },
        ];

        return (
          <Card key={scale.scaleKey} variant="outlined">
            <CardHeader
              title={scale.label}
              subtitle={
                reliability
                  ? `Согласованность ${num(reliability.alpha)} · ${reliability.items} ${pluralize(reliability.items, "пункт", "пункта", "пунктов")} · ${reliability.respondents} ${pluralize(reliability.respondents, "участник", "участника", "участников")}`
                  : `Согласованность не посчитана: ${RELIABILITY_GAP[scale.reliability as string] ?? "данных не хватает"}`
              }
              trail={scale.ipsative
                ? (
                  <Tooltip
                    content="Участник раздаёт фиксированный запас баллов, поэтому высокий балл одному пункту неизбежно означает низкий другому. Вклады связаны по построению, и согласованность здесь систематически занижена."
                    placement="bottom"
                  >
                    <Tag tone="info" size="s">Ипсативная методика</Tag>
                  </Tooltip>
                )
                : null}
            />
            <CardBody>
              <DataGrid
                columns={columns}
                rows={scale.items}
                rowKey={row => row.questionId}
                emptyMessage="Пунктов с наблюдениями в этой шкале нет"
              />
            </CardBody>
          </Card>
        );
      })}
    </Stack>
  );
}
