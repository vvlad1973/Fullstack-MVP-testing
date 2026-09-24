/**
 * @module features/analytics/test/item-breakdown
 * @description PRD-66 FR-24 — FR-26: разбор одного задания.
 *
 * Таблица вкладки говорит, ЧТО с заданием не так; разбор — ГДЕ именно. Трудность и
 * дискриминативность стоят плитками в одном ряду со временем и замыслом автора: у каждой
 * величины два-три числа, и отдельная карточка под каждую осталась бы пустой на три четверти.
 *
 * Разрез по крайним группам — не украшение: именно он показывает, ЧЕМ дистрактор привлекателен.
 * Доли считаются ОТ СВОЕЙ ГРУППЫ (FR-26b) — колонка целиком даёт сто процентов, — и это главный
 * источник непонимания, поэтому знаменатель назван в подсказке заголовка.
 *
 * Группы различают КОЛОНКИ и подписи, а не цвет (FR-26c): проверка палитры показала, что пара
 * «акцент + синий» неразличима при дейтеранопии.
 */
import {
  Button, Card, CardBody, CardHeader, DataGrid, Grid, Stack, Tag, Text, Tooltip,
} from "@skillum/ui-kit";
import { ArrowLeft, Info } from "lucide-react";

import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import type { QuestionType } from "@shared/questions/question-type";
import { pluralize } from "@/lib/i18n";

/** Вариант ответа с частотами и признаками. */
export interface OptionRow {
  index: number;
  label: string;
  correct: boolean;
  share: number;
  bottomShare: number | null;
  topShare: number | null;
  restCorrelation: number | null;
  dead: boolean;
  inverted: boolean;
}

/** Разбор задания — то, что отдаёт `GET .../psychometrics/:testId/items/:questionId`. */
export interface ItemBreakdownView {
  questionId: string;
  prompt: string;
  questionType: string;
  item: {
    observations: number;
    difficulty: number | null;
    correctedDifficulty: number | null;
    itemRest: number | null;
    discrimination: number | null;
    declaredDifficulty: number | null;
    timing: { medianMs: number; q1Ms: number; q3Ms: number; measured: number } | null;
  };
  groups: { size: number; share: number; topDifficulty: number; bottomDifficulty: number } | null;
  options: OptionRow[] | null;
  /** Редакции содержания, встреченные в выборке (FR-49). */
  versions?: VersionRow[];
}

/** Строка таблицы редакций. */
export interface VersionRow {
  psychoHash: string | null;
  observations: number;
  difficulty: number | null;
  firstAt: string;
  lastAt: string;
}

export interface ItemBreakdownPanelProps {
  view: ItemBreakdownView;
  onBack: () => void;
  /** Какая редакция показана: строка-отпечаток, `null` — «версия неизвестна», иначе все. */
  version?: string | null;
  /** Показать другую редакцию — это смена ВЫБОРКИ, а не отдельный экран (FR-49a). */
  onSelectVersion?: (version: string | null | undefined) => void;
}

/** Число с запятой; прочерк там, где величины нет. */
function num(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits).replace(".", ",");
}

/** Доля как процент для чтения. */
function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)} %`;
}

/** Время в минутах и секундах — так его и читают. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/**
 * Линейчатая шкала доли: значение, за ним дорожка (FR-26a).
 *
 * Шкалы обеих колонок одной длины, поэтому строки и колонки сравниваются взглядом: у верного
 * ответа длиннее правая шкала, у работающего дистрактора — левая, у мёртвого варианта обе
 * почти пусты.
 */
function ShareScale({ value }: { value: number | null }) {
  if (value === null) return <Text variant="body-s" tone="muted">—</Text>;
  return (
    <span className="tb-psy-scale">
      <span className="tb-psy-scale__value ou-text ou-text--body-s">{percent(value)}</span>
      <span className="tb-psy-scale__track">
        <span className="tb-psy-scale__fill" style={{ width: `${Math.round(value * 100)}%` }} />
      </span>
    </span>
  );
}

/** Признак варианта: симптом словами, без догадки о причине. */
function optionFlag(option: OptionRow): { tone: "success" | "warning" | "error"; label: string } {
  if (option.correct) return { tone: "success", label: "Верный ответ" };
  if (option.dead) return { tone: "warning", label: "Мёртвый вариант" };
  if (option.inverted) return { tone: "error", label: "Выбирают сильные" };
  return { tone: "success", label: "Работает" };
}

/** Заголовок-термин с подсказкой. */
function TermHeader({ term, hint }: { term: string; hint: string }) {
  return (
    <Tooltip content={hint} placement="bottom">
      <span className="ou-stack ou-stack--row ou-stack--gap-1 ou-stack--ai-center">
        {term}
        <Info size={12} aria-hidden />
      </span>
    </Tooltip>
  );
}

/** Карточка разбора задания. */
export function ItemBreakdownPanel({ view, onBack, version, onSelectVersion }: ItemBreakdownPanelProps) {
  const { item, groups, options } = view;
  const versions = view.versions ?? [];

  const columns = [
    {
      key: "option",
      header: "Вариант",
      frozen: true,
      render: (row: OptionRow) => (
        <Stack gap={1}>
          <span>{row.label}</span>
          {row.correct ? <Text variant="body-xs" tone="muted">верный ответ</Text> : null}
        </Stack>
      ),
    },
    {
      key: "share",
      header: "Выбрали",
      numeric: true,
      render: (row: OptionRow) => <Text variant="body-s">{percent(row.share)}</Text>,
    },
    {
      key: "bottom",
      header: <TermHeader
        term={`Слабые ${Math.round((groups?.share ?? 0.27) * 100)} %`}
        hint="Нижние 27 % участников по баллу за весь тест. Число — доля ИЗ ЭТОЙ ГРУППЫ, выбравшая вариант; колонка целиком даёт 100 %. Дистрактор работает, когда здесь больше, чем у сильных."
      />,
      render: (row: OptionRow) => <ShareScale value={row.bottomShare} />,
    },
    {
      key: "top",
      header: <TermHeader
        term={`Сильные ${Math.round((groups?.share ?? 0.27) * 100)} %`}
        hint="Верхние 27 % участников по баллу за весь тест. Число — доля ИЗ ЭТОЙ ГРУППЫ, выбравшая вариант; колонка целиком даёт 100 %. У верного ответа здесь должно быть больше, чем у слабых."
      />,
      render: (row: OptionRow) => <ShareScale value={row.topShare} />,
    },
    {
      key: "rest",
      header: <TermHeader
        term="Корреляция с остатком"
        hint="Корреляция выбора варианта с баллом за остальные задания. У верного ответа должна быть положительной, у дистрактора — отрицательной. Положительная у дистрактора значит, что его выбирают сильные: вариант частично верен либо ключ неверен."
      />,
      numeric: true,
      render: (row: OptionRow) => <Text variant="body-s">{num(row.restCorrelation)}</Text>,
    },
    {
      key: "flag",
      header: "Признак",
      render: (row: OptionRow) => {
        const flag = optionFlag(row);
        return <Tag tone={flag.tone} size="s">{flag.label}</Tag>;
      },
    },
  ];

  return (
    <Stack gap={4}>
      <Stack gap={1} align="start">
        <Button variant="ghost" size="s" onClick={onBack} leadingIcon={<ArrowLeft size={14} />}>
          Ко всем заданиям
        </Button>
        <Text variant="heading-l">
          {view.questionType
            ? <QuestionTypeIcon type={view.questionType as QuestionType} size={20} />
            : null}
          {" "}{view.prompt}
        </Text>
        <Text variant="body-m" tone="muted">
          {item.observations} {pluralize(item.observations, "наблюдение", "наблюдения", "наблюдений")}
        </Text>
      </Stack>

      {/* FR-48b: СТРОГО три в ряд. Автоподбор давал на широком мониторе пять плиток и одну
          на второй строке, а пары величин разъезжались по разным строкам. */}
      <Grid cols={3} gap={1}>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{num(item.difficulty)}</Text>
              <Text variant="body-s" tone="muted">Трудность</Text>
              <Text variant="body-xs" tone="subtle">приемлемо: 0,20 — 0,80</Text>
            </Stack>
          </CardBody>
        </Card>
        {item.correctedDifficulty !== null ? (
          <Card variant="outlined">
            <CardBody>
              <Stack gap={1} align="center">
                <Text variant="display-s" weight="bold">{num(item.correctedDifficulty)}</Text>
                <Text variant="body-s" tone="muted">С поправкой на угадывание</Text>
                <Text variant="body-xs" tone="subtle">ноль и ниже — на уровне случайного выбора</Text>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{num(item.itemRest)}</Text>
              <Text variant="body-s" tone="muted">Дискриминативность (r)</Text>
              <Text variant="body-xs" tone="subtle">корреляция задание-остаток · хорошо от 0,30</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{num(item.discrimination)}</Text>
              <Text variant="body-s" tone="muted">Индекс дискриминации (D)</Text>
              <Text variant="body-xs" tone="subtle">
                {groups
                  ? `крайние ${Math.round(groups.share * 100)} % · по ${groups.size} ${pluralize(groups.size, "участнику", "участника", "участников")}`
                  : "крайние группы не сложились"}
              </Text>
            </Stack>
          </CardBody>
        </Card>
        {item.declaredDifficulty !== null ? (
          <Card variant="outlined">
            <CardBody>
              <Stack gap={1} align="center">
                <Text variant="display-s" weight="bold">
                  {item.declaredDifficulty} → {item.difficulty === null ? "—" : Math.round(item.difficulty * 100)}
                </Text>
                <Text variant="body-s" tone="muted">Замысел и наблюдение</Text>
                <Text variant="body-xs" tone="subtle">заявлено автором → получилось у участников</Text>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
        {item.timing ? (
          <Card variant="outlined">
            <CardBody>
              <Stack gap={1} align="center">
                <Text variant="display-s" weight="bold">{duration(item.timing.medianMs)}</Text>
                <Text variant="body-s" tone="muted">Время, медиана</Text>
                <Text variant="body-xs" tone="subtle">
                  половина ответов {duration(item.timing.q1Ms)} — {duration(item.timing.q3Ms)} · {item.timing.measured} {pluralize(item.timing.measured, "наблюдение", "наблюдения", "наблюдений")}
                </Text>
              </Stack>
            </CardBody>
          </Card>
        ) : null}
      </Grid>

      {versions.length > 1 && onSelectVersion ? (
        <Card variant="outlined">
          <CardHeader
            title="Редакции содержания"
            subtitle="Наблюдения разных редакций не складываются: после правки это психометрически другое задание"
          />
          <CardBody>
            <DataGrid
              columns={[
                {
                  key: "version",
                  header: "Редакция",
                  frozen: true,
                  render: (row: VersionRow) => (
                    <Stack gap={1}>
                      <span>
                        {row.psychoHash === null
                          // FR-49b: серия, собранная до появления штампа, выбирается так же,
                          // как остальные, — иначе эти наблюдения были бы недоступны вовсе.
                          ? "Версия неизвестна"
                          : `Редакция ${row.psychoHash.slice(0, 8)}`}
                      </span>
                      <Text variant="body-xs" tone="muted">
                        {new Date(row.firstAt).toLocaleDateString("ru-RU")} — {new Date(row.lastAt).toLocaleDateString("ru-RU")}
                      </Text>
                    </Stack>
                  ),
                },
                {
                  key: "observations",
                  header: "Наблюдений",
                  numeric: true,
                  render: (row: VersionRow) => <Text variant="body-s">{row.observations}</Text>,
                },
                {
                  key: "difficulty",
                  header: "Трудность",
                  numeric: true,
                  render: (row: VersionRow) => <Text variant="body-s">{num(row.difficulty)}</Text>,
                },
                {
                  key: "action",
                  header: "",
                  render: (row: VersionRow) => {
                    const shown = version !== undefined && version === row.psychoHash;
                    return shown
                      ? <Tag tone="success" size="s">Показана</Tag>
                      : (
                        <Button variant="ghost" size="s" onClick={() => onSelectVersion(row.psychoHash)}>
                          Показать
                        </Button>
                      );
                  },
                },
              ]}
              rows={versions}
              rowKey={row => row.psychoHash ?? "unknown"}
              emptyMessage="Редакций в выборке нет"
            />
            {version !== undefined ? (
              <Stack direction="row" gap={1} align="center">
                <Button variant="ghost" size="s" onClick={() => onSelectVersion(undefined)}>
                  Показать все редакции вместе
                </Button>
                <Text variant="body-xs" tone="muted">
                  Числа карточки посчитаны по выбранной редакции
                </Text>
              </Stack>
            ) : null}
          </CardBody>
        </Card>
      ) : null}

      {options ? (
        <Card variant="outlined">
          <CardHeader
            title="Варианты ответа"
            subtitle={`Частота выбора и связь с остальным баллом · ${item.observations} ${pluralize(item.observations, "наблюдение", "наблюдения", "наблюдений")}`}
          />
          <CardBody>
            <DataGrid
              columns={columns}
              rows={options}
              rowKey={row => String(row.index)}
              emptyMessage="Вариантов ответа у задания нет"
            />
          </CardBody>
        </Card>
      ) : (
        <Card variant="outlined">
          <CardBody>
            {/* FR-27: у сопоставления и ранжирования «вариантов» нет — есть пары и порядок. */}
            <Text variant="body-s" tone="muted">
              Для этого типа задания разбор вариантов не применяется: по нему работают трудность и
              дискриминативность.
            </Text>
          </CardBody>
        </Card>
      )}
    </Stack>
  );
}
