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

import { TermHint } from "./term-hint";

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
 * Предел длины подписи градации, при котором её ещё можно ставить под столбиком.
 *
 * Двадцать четыре знака — это «полностью согласен» с запасом, то есть вся шкала Ликерта и
 * любая градация в два-три слова. Вариант-предложение в него не помещается, и правильно:
 * под столбиком ему не место.
 */
const MAX_GRADE_LABEL = 24;

/**
 * Как подписаны столбики гистограммы (FR-30b, FR-30c): словами все, словами только края или
 * номерами все. Одно правило для гистограммы и для подсказки заголовка — иначе подсказка
 * описывала бы подписи, которых под столбиками нет.
 */
type GradeLabelMode = "words" | "ends" | "numbers";

function gradeLabelMode(distribution: number[], labels: string[]): GradeLabelMode {
  // Читаемость подписи решает не только ЧИСЛО градаций, но и их ДЛИНА. У шкалы Ликерта
  // подпись в два слова, и пять таких помещаются; у опросника, где варианты — целые
  // предложения, та же подпись растягивает колонку на тысячи пикселей и выталкивает за
  // горизонтальную прокрутку связь с остатком и признак (вскрыто на стенде). Длинные
  // градации подписываются номерами, а расшифровка остаётся в подсказке строки.
  const short = labels.slice(0, distribution.length)
    .every(label => (label ?? "").length <= MAX_GRADE_LABEL);
  if (!short) return "numbers";
  return distribution.length <= 5 ? "words" : "ends";
}

/**
 * Подсказки к терминам таблиц шкал — дословно из эскиза `prd66-item-quality.html` (FR-14b).
 *
 * Внутри шкалы опросника единица — «пункт», а не «вопрос».
 */
const HINT = {
  items: "Сколько пунктов опросника вносят вклад в шкалу. Альфа по двум-трём пунктам ненадёжна сама по себе.",
  alpha: "Насколько согласованно пункты шкалы меряют одно и то же. Приемлемо от 0,70, хорошо от 0,80. У ипсативной методики занижена по построению и дефектом не считается.",
  respondents: "Сколько участников ответили на все пункты шкалы: по ним считается альфа.",
  verdict: "Годится ли шкала: альфа от 0,70 — приемлемо, от 0,80 — хорошо. Ниже — пункты шкалы меряют разное.",
  itemRest: "Связь ответа на этот пункт с суммой по ОСТАЛЬНЫМ пунктам той же шкалы. Показывает, тянет ли пункт в ту же сторону, что шкала целиком. Отрицательная — пункт работает против своей шкалы: чаще всего у обратного пункта забыли поставить отрицательный вклад.",
  quality: "Что не так с пунктом: «Работает против шкалы» — ответы идут противоположно остальным пунктам; «мёртвый» — почти все выбирают одну градацию.",
} as const;

/** Число градаций словом — как в эскизе («Градаций семь»); за пределами списка — цифрами. */
const GRADE_COUNT_WORD: Record<number, string> = {
  6: "шесть", 7: "семь", 8: "восемь", 9: "девять", 10: "десять",
};

/**
 * Подсказка к «Распределению ответов» — о подписях ЭТОЙ шкалы (FR-30b, FR-30c).
 *
 * Эскиз даёт два текста: для подписей словами (с перечнем градаций) и для номеров с краями
 * словами (с числом градаций). Градации берутся у первого пункта шкалы, у которого они есть:
 * пункты одной шкалы обычно отвечают по одной и той же шкале ответа.
 */
function distributionHint(items: ScaleItemRow[]): string {
  const sample = items.find(row => row.distribution.length > 0);
  if (!sample) {
    return "Доли участников по градациям ответа этого вопроса. Названия берутся из самого вопроса. Если почти все выбирают одну градацию, пункт никого не различает.";
  }
  const count = sample.distribution.length;
  const mode = gradeLabelMode(sample.distribution, sample.gradeLabels);
  if (mode === "words") {
    const labels = sample.distribution.map((_, i) => sample.gradeLabels[i] ?? String(i + 1)).join(", ");
    return `Доли участников по градациям ответа этого вопроса: ${labels}. Названия берутся из самого вопроса. Если почти все выбирают одну градацию, пункт никого не различает.`;
  }
  if (mode === "ends") {
    return `Доли участников по градациям этого вопроса. Градаций ${GRADE_COUNT_WORD[count] ?? count}, поэтому под столбиками стоят номера, а словами подписаны края. Полный список с долями — в подсказке строки.`;
  }
  return "Доли участников по градациям этого вопроса. Подписи градаций длинные, поэтому под столбиками стоят номера. Полный список с долями — в подсказке строки.";
}

/**
 * Вывод по шкале (FR-29): годится ли она, словами и тоном.
 *
 * Ипсативная методика — не дефект: альфа там занижена по построению, и тон предупреждения
 * выносил бы приговор, которого методика не заслуживает.
 */
function ScaleVerdict({ scale }: { scale: ScaleQualityRow }) {
  if (scale.ipsative) {
    return (
      <Stack gap={1}>
        <Tag tone="info" size="s">Ипсативная</Tag>
        <Text variant="body-xs" tone="muted">сумма баллов фиксирована, альфа занижена</Text>
      </Stack>
    );
  }
  if (typeof scale.reliability === "string") {
    return (
      <Text variant="body-xs" tone="muted">
        не посчитана: {RELIABILITY_GAP[scale.reliability] ?? "данных не хватает"}
      </Text>
    );
  }
  const { alpha } = scale.reliability;
  if (alpha >= 0.8) return <Tag tone="success" size="s">Хорошо</Tag>;
  if (alpha >= 0.7) return <Tag tone="success" size="s">Приемлемо</Tag>;
  const against = scale.items.filter(row => row.againstScale).length;
  return (
    <Stack gap={1}>
      <Tag tone="warning" size="s">Ниже приемлемого</Tag>
      <Text variant="body-xs" tone="muted">
        порог 0,70{against > 0 ? `; ${against} ${pluralize(against, "пункт", "пункта", "пунктов")} против шкалы` : ""}
      </Text>
    </Stack>
  );
}

/**
 * Мини-гистограмма распределения по градациям (FR-30a — FR-30c).
 *
 * До пяти КОРОТКИХ градаций каждый столбик подписан словами; от шести подписи словами
 * наезжают друг на друга, а длинные растягивают колонку — в обоих случаях под столбиками
 * стоят номера. Высота отсчитывается от общей шкалы 0 — 100 %, поэтому строки таблицы
 * сравнимы между собой.
 */
function GradeHistogram({ distribution, labels }: { distribution: number[]; labels: string[] }) {
  // Градаций у ответа нет вовсе — так бывает у распределения баллов и ранжирования, где
  // участник не выбирает один вариант. Прочерк молча читался бы как «не посчитали», поэтому
  // причина названа в подсказке.
  if (distribution.length === 0) {
    return (
      <Tooltip
        content="Участник не выбирает один вариант, а раскладывает ответ между утверждениями: градаций, по которым строится распределение, у такого вопроса нет."
        placement="bottom"
      >
        <Text variant="body-xs" tone="muted">—</Text>
      </Tooltip>
    );
  }
  const mode = gradeLabelMode(distribution, labels);
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
            {mode === "words"
              ? labels[i] ?? String(i + 1)
              // Градаций много, но подписи короткие — края словами, середина номерами: так
              // они не наезжают друг на друга, а смысл краёв остаётся виден. Подписи
              // ДЛИННЫЕ — номерами все до одной, иначе край растянет колонку на себя.
              : mode === "ends" && (i === 0 || i === distribution.length - 1)
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

  // Сколько прохождений легло в сводку: у шкал оно может разниться (пункты разных форм),
  // и подзаголовок называет наибольшее — объём выборки вкладки.
  const passes = Math.max(...scales.map(scale => scale.respondents));

  const summaryColumns = [
    {
      key: "scale",
      width: "26%",
      header: "Шкала",
      frozen: true,
      render: (row: ScaleQualityRow) => <span>{row.label}</span>,
    },
    {
      key: "items",
      width: "10%",
      header: <TermHint term="Пунктов" hint={HINT.items} align="end" />,
      align: "right" as const,
      numeric: true,
      render: (row: ScaleQualityRow) => (
        <Text variant="body-s">
          {typeof row.reliability === "string" ? row.items.length : row.reliability.items}
        </Text>
      ),
    },
    {
      key: "alpha",
      width: "10%",
      header: <TermHint term="Альфа Кронбаха" hint={HINT.alpha} align="end" />,
      align: "right" as const,
      numeric: true,
      render: (row: ScaleQualityRow) => (
        <Text variant="body-s">
          {typeof row.reliability === "string" ? "—" : num(row.reliability.alpha)}
        </Text>
      ),
    },
    {
      key: "respondents",
      width: "8%",
      header: <TermHint term="n" hint={HINT.respondents} align="end" />,
      align: "right" as const,
      numeric: true,
      render: (row: ScaleQualityRow) => (
        <Text variant="body-s">
          {typeof row.reliability === "string" ? row.respondents : row.reliability.respondents}
        </Text>
      ),
    },
    {
      key: "verdict",
      width: "46%",
      header: <TermHint term="Вывод по шкале" hint={HINT.verdict} />,
      render: (row: ScaleQualityRow) => <ScaleVerdict scale={row} />,
    },
  ];

  return (
    <Stack gap={4}>
      <Card variant="outlined">
        <CardHeader
          title="Шкалы методики"
          subtitle={`Согласованность пунктов внутри шкалы · ${passes} ${pluralize(passes, "прохождение", "прохождения", "прохождений")}`}
        />
        <CardBody>
          <DataGrid
            columns={summaryColumns}
            rows={scales}
            rowKey={row => row.scaleKey}
            emptyMessage="Шкал в этом тесте нет"
          />
        </CardBody>
      </Card>

      {scales.map(scale => {
        const reliability = typeof scale.reliability === "string" ? null : scale.reliability;

        const columns = [
          {
            key: "item",
            width: "32%",
            header: "Пункт",
            frozen: true,
            render: (row: ScaleItemRow) => (
              <Stack gap={1}>
                <span className="tb-psy-prompt">{row.prompt}</span>
                <Text variant="body-xs" tone="muted">
                  {row.observations} {pluralize(row.observations, "ответ", "ответа", "ответов")}
                </Text>
              </Stack>
            ),
          },
          // Порядок колонок — как в эскизе: число связи рядом с пунктом, гистограмма за ним.
          {
            key: "itemRest",
            width: "14%",
            header: <TermHint term="Корреляция с остатком шкалы" hint={HINT.itemRest} align="end" />,
            align: "right" as const,
            numeric: true,
            render: (row: ScaleItemRow) => <Text variant="body-s">{num(row.itemRest)}</Text>,
          },
          {
            key: "distribution",
            width: "34%",
            header: <TermHint term="Распределение ответов" hint={distributionHint(scale.items)} />,
            render: (row: ScaleItemRow) => (
              <GradeHistogram distribution={row.distribution} labels={row.gradeLabels} />
            ),
          },
          {
            key: "flag",
            width: "20%",
            header: <TermHint term="Качество пункта" hint={HINT.quality} />,
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
              // Согласованность шкалы — в сводке «Шкалы методики»; здесь только её пункты.
              title={`Пункты шкалы «${scale.label}»`}
              subtitle="Связь пункта с остальной частью своей шкалы"
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
