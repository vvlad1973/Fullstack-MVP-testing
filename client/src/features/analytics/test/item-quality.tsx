/**
 * @module features/analytics/test/item-quality
 * @description PRD-66: вкладка «Качество заданий» — годится ли задание как измерительный
 * инструмент.
 *
 * Соседняя вкладка «Вопросы» отвечает на другой вопрос — что с заданием ПРОИСХОДИТ: сколько
 * ответов, сколько пропусков, как часто выдаётся. Здесь — пригодность: отделяет ли задание
 * сильных от слабых, не испорчен ли ключ, надёжен ли тест и можно ли доверять вердикту у
 * порога. Двух таблиц заданий с расходящимися числами не заводится: у каждой свой вопрос.
 *
 * ТЕРМИНЫ НЕ ПЕРЕСКАЗЫВАЮТСЯ (FR-14a). У величины есть имя — «Трудность»,
 * «Дискриминативность», «Надёжность», — и методист заказчика должен его узнать. Толкование
 * живёт в подсказке у заголовка и в окне «Термины», а не подменяет название.
 *
 * ПРИЗНАК НАЗЫВАЕТ СИМПТОМ, А НЕ ПРИЧИНУ (FR-16a, FR-31a). «Сильные ошибаются чаще» — это то,
 * что видно в числах; «ошибка в ключе» — догадка, которую расчёт проверить не может, и она
 * идёт подписью с числами, а не заголовком.
 */
import { useState } from "react";

import {
  Banner, Button, Card, CardBody, CardFooter, CardHeader, DataGrid, Grid, ModalDialog,
  SegmentedControl, Stack, Tag, Text, Tooltip,
} from "@skillum/ui-kit";
import { Download, Info } from "lucide-react";

import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import type { QuestionType } from "@shared/questions/question-type";
import { pluralize } from "@/lib/i18n";

/** Наблюдений, начиная с которых коэффициент вообще выводится (движок: COEFFICIENT_MIN). */
const COEFFICIENT_MIN = 30;

/** Уровень доверия к числу — то же, что считает движок. */
type Confidence = "insufficient" | "tentative" | "reliable";

/** Признаки задания, посчитанные движком. */
export interface ItemQualityFlags {
  tooHard: boolean;
  tooEasy: boolean;
  negativeDiscrimination: boolean;
  atChanceLevel: boolean;
}

/** Строка вкладки — задание с его психометрикой. */
export interface ItemQualityRow {
  questionId: string;
  observations: number;
  difficulty: number | null;
  correctedDifficulty: number | null;
  itemRest: number | null;
  discrimination: number | null;
  declaredDifficulty: number | null;
  difficultyConfidence: Confidence;
  coefficientConfidence: Confidence;
  flags: ItemQualityFlags;
  timingFlags: { rushed: boolean; slow: boolean };
  /** Подписи приходят с сервера: текст задания и тема живут там же, где задание. */
  prompt?: string;
  topicName?: string;
  questionType?: string;
}

/** Надёжность теста либо причина, по которой её нет. */
export type ReliabilityView =
  | { alpha: number; items: number; respondents: number; totalSd: number; dichotomous: boolean }
  | "too-few-items" | "too-few-respondents" | "no-variance";

export interface ItemQualityView {
  items: ItemQualityRow[];
  reliability: ReliabilityView;
  sem: number | null;
  cutBand: { low: number; high: number; z: number } | null;
  sample: {
    respondents: number;
    responses: number;
    bySource: Record<string, number>;
    unknownVersionShare: number;
  };
  firstAttemptOnly: boolean;
  /** Поводы к баннеру смещения (FR-39, FR-40); отсутствует у старых ответов ручки. */
  bias?: { unevenDelivery: boolean; importShare: number };
}

export interface ItemQualityPanelProps {
  view: ItemQualityView;
  /** Ссылки выгрузок: отчёт и матрица. Без них кнопки не рисуются. */
  exportHref?: string;
  matrixHref?: string;
  /** Открыть разбор задания. Без обработчика строка никуда не ведёт. */
  onOpenItem?: (questionId: string) => void;
}

/** Как источник наблюдений подписывается человеку. */
const SOURCE_TITLE: Record<string, string> = {
  web: "веб",
  telemetry: "телеметрия LMS",
  import: "импорт выгрузок",
};

/** Число с запятой и двумя знаками; прочерк там, где величины нет. */
function num(value: number | null, digits = 2): string {
  return value === null ? "—" : value.toFixed(digits).replace(".", ",");
}

/** Оценка альфы словами — ориентиры FR-19. */
function alphaVerdict(alpha: number): string {
  if (alpha >= 0.95) return "подозрение на дубли заданий";
  if (alpha >= 0.8) return "хорошо";
  if (alpha >= 0.7) return "приемлемо";
  return "ниже приемлемого";
}

/** Почему надёжности нет — словами, а не пустой плиткой. */
const RELIABILITY_GAP: Record<string, string> = {
  "too-few-items": "в наборе меньше двух заданий",
  "too-few-respondents": "меньше двух участников с полным набором",
  "no-variance": "все набрали поровну",
};

/**
 * Признак задания: заголовок-симптом и числа, которые его вызвали (FR-50).
 *
 * Порядок проверок — это и есть «сила подозрения»: прямой дефект вперёд, спокойное задание в
 * конец. Первым идёт отрицательная дискриминативность: сильные, ошибающиеся чаще слабых, почти
 * всегда означают испорченный ключ, и это чинят раньше всего остального.
 */
function flagOf(row: ItemQualityRow): { tone: "error" | "warning" | "info"; title: string; detail: string } | null {
  if (row.flags.negativeDiscrimination) {
    return {
      tone: "error",
      title: "Сильные ошибаются чаще",
      detail: `дискриминативность ${num(row.itemRest)}, индекс ${num(row.discrimination)}`,
    };
  }
  if (row.flags.atChanceLevel) {
    return {
      tone: "error",
      title: "На уровне угадывания",
      detail: `с поправкой ${num(row.correctedDifficulty)}`,
    };
  }
  if (row.timingFlags.rushed) {
    return { tone: "warning", title: "Отвечают не читая", detail: "ответ быстрее, чем задание можно прочесть" };
  }
  if (row.flags.tooHard) {
    return { tone: "warning", title: "Слишком трудное", detail: `трудность ${num(row.difficulty)}` };
  }
  if (row.flags.tooEasy) {
    return { tone: "warning", title: "Слишком лёгкое", detail: `трудность ${num(row.difficulty)}` };
  }
  if (row.timingFlags.slow) {
    return { tone: "warning", title: "Тормозит прогон", detail: "время заметно выше медианы теста" };
  }
  if (row.coefficientConfidence === "insufficient") {
    // Сколько СОБРАНО и сколько НУЖНО — оба числа, иначе «мало данных» не подсказывает
    // действия: ждать ещё неделю или бросать задание вовсе (AC-05).
    const needed = COEFFICIENT_MIN - row.observations;
    return {
      tone: "info",
      title: "Мало данных",
      detail: `${row.observations} из ${COEFFICIENT_MIN} · нужно ещё ${needed} ${pluralize(needed, "наблюдение", "наблюдения", "наблюдений")}`,
    };
  }
  return null;
}

/** Есть ли у задания хоть один признак — по нему считается «под подозрением». */
function suspicious(row: ItemQualityRow): boolean {
  const flag = flagOf(row);
  return flag !== null && flag.tone !== "info";
}

/**
 * Ранг признака — порядок FR-48: сначала прямые дефекты, потом эвристики, потом спокойные.
 *
 * Сортировка идёт по РАНГУ, а не по алфавиту ярлыков (FR-48a): «На уровне угадывания» стоит
 * впереди «Слишком лёгкого» не потому, что буква раньше, а потому что чинят его первым.
 * Задания с пометкой «мало данных» — последние в обоих направлениях: признака у них нет не
 * потому, что они здоровы, а потому, что судить не на чем.
 */
function suspicionRank(row: ItemQualityRow): number {
  if (row.coefficientConfidence === "insufficient") return 90;
  if (row.flags.negativeDiscrimination) return 1;
  if (row.flags.atChanceLevel) return 2;
  if (row.timingFlags.rushed) return 3;
  if (row.flags.tooHard) return 4;
  if (row.flags.tooEasy) return 5;
  if (row.timingFlags.slow) return 6;
  return 50;
}

/**
 * Внутри одного ранга — по величине, вызвавшей признак (FR-48a).
 *
 * У отрицательной дискриминации это сама дискриминативность: чем глубже минус, тем раньше
 * строка. У прочих рангов — трудность, потому что именно она вызвала признак.
 */
function withinRank(row: ItemQualityRow): number {
  if (row.flags.negativeDiscrimination) return row.itemRest ?? 0;
  if (row.flags.atChanceLevel) return row.correctedDifficulty ?? 0;
  return row.difficulty ?? 0;
}

/** Заголовок-термин с подсказкой: без значка подсказка невидима (FR-14b). */
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

type View = "all" | "suspicious" | "thin";

/** Вкладка «Качество заданий». */
export function ItemQualityPanel({ view, exportHref, matrixHref, onOpenItem }: ItemQualityPanelProps) {
  const [tab, setTab] = useState<View>("all");
  const [glossary, setGlossary] = useState(false);

  const suspiciousCount = view.items.filter(suspicious).length;
  const thinCount = view.items.filter(r => r.coefficientConfidence === "insufficient").length;
  const reliableCount = view.items.filter(r => r.coefficientConfidence === "reliable").length;

  const rows = view.items
    .filter(row =>
      tab === "all" ? true
        : tab === "suspicious" ? suspicious(row)
          : row.coefficientConfidence === "insufficient")
    // Порядок по умолчанию — сила подозрения (FR-48): список открывается тем, что чинят первым.
    .slice()
    .sort((a, b) => suspicionRank(a) - suspicionRank(b) || withinRank(a) - withinRank(b));

  const reliability = typeof view.reliability === "string" ? null : view.reliability;

  /**
   * Поводы к баннеру смещения (FR-39, FR-40).
   *
   * Баннер один, поводов два, и каждый назван своими словами: «выдача неоднородна» и «заметная
   * доля наблюдений из импорта» чинятся по-разному, и склеить их в одну фразу значило бы
   * оставить автора гадать, о чём речь.
   */
  const biasReasons: string[] = [];
  if (view.bias?.unevenDelivery) {
    biasReasons.push("Выдача неоднородна: участники видели разные наборы заданий, и корреляции считаются по пересекающимся, но разным выборкам.");
  }
  if ((view.bias?.importShare ?? 0) >= 0.2) {
    biasReasons.push(`Заметная доля наблюдений пришла из импорта (${Math.round((view.bias?.importShare ?? 0) * 100)} %): там исход бинарный вместо доли балла, а редакция задания неизвестна.`);
  }

  const columns = [
    {
      key: "question",
      header: "Задание",
      frozen: true,
      render: (row: ItemQualityRow) => (
        <Stack gap={1}>
          <span className="ou-stack ou-stack--row ou-stack--gap-1 ou-stack--ai-center">
            {row.questionType
              ? <QuestionTypeIcon type={row.questionType as QuestionType} size={16} />
              : null}
            <span>{row.prompt ?? row.questionId}</span>
          </span>
          {row.topicName ? <Text variant="body-xs" tone="muted">{row.topicName}</Text> : null}
        </Stack>
      ),
    },
    {
      key: "flag",
      header: <TermHeader
        term="Признак"
        hint="Что не так с заданием. Признак ставится по числам этой же строки: он называет симптом, а причину оставляет автору."
      />,
      render: (row: ItemQualityRow) => {
        const flag = flagOf(row);
        if (!flag) return <Text variant="body-xs" tone="muted">—</Text>;
        return (
          <Stack gap={1}>
            <Tag tone={flag.tone} size="s">{flag.title}</Tag>
            <Text variant="body-xs" tone="muted">{flag.detail}</Text>
          </Stack>
        );
      },
    },
    {
      key: "difficulty",
      header: <TermHeader
        term="Трудность"
        hint="Средняя доля набранного балла: 0 — не решил никто, 1 — решили все. Приемлемо 0,20 — 0,80; выше 0,90 задание ничего не отсеивает."
      />,
      numeric: true,
      // Трудность живёт при пороге наблюдений инстанса, а коэффициенты — при 30 и 100
      // (FR-38a). Поэтому у задания с дюжиной наблюдений она есть, а дискриминативности нет.
      render: (row: ItemQualityRow) => (
        <Text variant="body-s" tone={row.difficultyConfidence === "insufficient" ? "muted" : undefined}>
          {row.difficultyConfidence === "insufficient" ? "мало данных" : num(row.difficulty)}
        </Text>
      ),
    },
    {
      key: "itemRest",
      header: <TermHeader
        term="Дискриминативность"
        hint="Отделяет ли задание сильных от слабых: корреляция балла за него с баллом за остальные задания формы. Хорошо от 0,30, отрицательная — почти всегда ошибка в ключе."
      />,
      numeric: true,
      render: (row: ItemQualityRow) => (
        <Text variant="body-s" tone={row.coefficientConfidence === "insufficient" ? "muted" : undefined}>
          {row.coefficientConfidence === "insufficient" ? "мало данных" : num(row.itemRest)}
        </Text>
      ),
    },
    {
      key: "observations",
      header: <TermHeader
        term="n"
        hint="Сколько участников выборки видели это задание. Коэффициенты считаются с 30 наблюдений, надёжными становятся со 100."
      />,
      numeric: true,
      render: (row: ItemQualityRow) => <Text variant="body-s">{row.observations}</Text>,
    },
  ];

  return (
    <Stack gap={4}>
      <Grid minItem="sm" gap={1}>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{reliability ? num(reliability.alpha) : "—"}</Text>
              <Text variant="body-s" tone="muted">Надёжность (альфа)</Text>
              <Text variant="body-xs" tone="subtle">
                {reliability
                  ? `${alphaVerdict(reliability.alpha)} · ${reliability.respondents} ${pluralize(reliability.respondents, "участник", "участника", "участников")}`
                  : RELIABILITY_GAP[view.reliability as string] ?? "посчитать не на чем"}
              </Text>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{num(view.sem)}</Text>
              <Text variant="body-s" tone="muted">Ошибка измерения</Text>
              <Text variant="body-xs" tone="subtle">в долях балла</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{suspiciousCount}</Text>
              <Text variant="body-s" tone="muted">Под подозрением</Text>
              <Text variant="body-xs" tone="subtle">из {view.items.length} {pluralize(view.items.length, "задания", "заданий", "заданий")}</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{reliableCount}</Text>
              <Text variant="body-s" tone="muted">Заданий с надёжной оценкой</Text>
              <Text variant="body-xs" tone="subtle">n не меньше 100</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>

      {biasReasons.length > 0 ? (
        <Banner
          variant="subtle"
          tone="info"
          title="Показатели дискриминации ослаблены"
          description={`${biasReasons.join(" ")} Числа остаются полезными для отбора подозрительных заданий, но сравнивать их с показателями теста, где выдача однородна, нельзя.`}
        />
      ) : null}

      {view.cutBand ? (
        <Banner
          variant="subtle"
          tone="warning"
          title="Проходной балл попадает внутрь интервала ошибки измерения"
          description={`Интервал ${num(view.cutBand.low)} — ${num(view.cutBand.high)} в долях балла. Решение «сдал / не сдал» у участников внутри него определяется ошибкой измерения, а не подготовкой.`}
        />
      ) : null}

      <Card variant="outlined">
        <CardBody>
          <Stack direction="row" gap={1} align="center" wrap>
            <Text variant="body-s" weight="semibold">Выборка:</Text>
            {/* Числа здесь — НАБЛЮДЕНИЯ (ответы), а не прохождения: «веб — 26» рядом с
                «Попытки 10» читалось как двадцать шесть прохождений (вскрыто приёмкой). */}
            {Object.entries(view.sample.bySource).map(([source, count]) => (
              <Tag key={source} tone="neutral" size="s">
                {SOURCE_TITLE[source] ?? source} — {count} {pluralize(count, "наблюдение", "наблюдения", "наблюдений")}
              </Tag>
            ))}
            {view.sample.unknownVersionShare > 0 ? (
              <Tag tone="warning" size="s">
                редакция неизвестна — {Math.round(view.sample.unknownVersionShare * 100)} %
              </Tag>
            ) : null}
            <Tag tone="neutral" size="s">
              {view.firstAttemptOnly ? "только первая попытка" : "все попытки"}
            </Tag>
          </Stack>
        </CardBody>
      </Card>

      <Card variant="outlined">
        <CardHeader
          title="Задания"
          subtitle={`${view.items.length} ${pluralize(view.items.length, "задание", "задания", "заданий")} · отсортированы по силе подозрения`}
          trail={
            <Stack direction="row" gap={1} align="center">
              <Button variant="ghost" size="s" onClick={() => setGlossary(true)} leadingIcon={<Info size={14} />}>
                Термины
              </Button>
              <SegmentedControl
                size="s"
                value={tab}
                onChange={value => setTab(value as View)}
                items={[
                  { value: "all", label: "Все" },
                  { value: "suspicious", label: "Под подозрением", badge: suspiciousCount },
                  { value: "thin", label: "Мало данных", badge: thinCount },
                ]}
              />
            </Stack>
          }
        />
        <CardBody>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={row => row.questionId}
            onRowClick={onOpenItem ? row => onOpenItem(row.questionId) : undefined}
            emptyMessage={tab === "suspicious"
              ? "Признаки не сошлись ни у одного задания"
              : tab === "thin"
                ? "Данных хватает по всем заданиям"
                : "Наблюдений пока нет"}
          />
        </CardBody>
        {exportHref || matrixHref ? (
          <CardFooter>
            <Stack direction="row" gap={1} align="center">
              {exportHref ? (
                <a className="ou-btn ou-btn--secondary ou-btn--s" href={exportHref} download>
                  <span className="ou-btn__ico"><Download size={14} /></span>
                  <span>Психометрический отчёт</span>
                </a>
              ) : null}
              {matrixHref ? (
                <a className="ou-btn ou-btn--ghost ou-btn--s" href={matrixHref} download>
                  <span className="ou-btn__ico"><Download size={14} /></span>
                  <span>Матрица ответов</span>
                </a>
              ) : null}
            </Stack>
          </CardFooter>
        ) : null}
      </Card>

      <GlossaryDialog open={glossary} onClose={() => setGlossary(false)} />
    </Stack>
  );
}

/** Одна статья глоссария: термин, что он значит и какие у него ориентиры. */
const GLOSSARY: Array<{ term: string; what: string; marks: string }> = [
  {
    term: "Трудность (p)",
    what: "Средняя доля набранного балла по заданию: 0 — не решил никто, 1 — решили все.",
    marks: "Приемлемо 0,20 — 0,80. Ниже 0,20 задание слишком трудное, выше 0,90 — никого не отсеивает.",
  },
  {
    term: "Поправка на угадывание",
    what: "Трудность за вычетом доли, которую даёт случайный выбор. Считается только для заданий с одним верным ответом.",
    marks: "Ноль и ниже — задание неотличимо от подбрасывания монетки.",
  },
  {
    term: "Дискриминативность (r)",
    what: "Корреляция балла за задание с баллом за остальные задания формы: отделяет ли задание сильных от слабых.",
    marks: "Хорошо от 0,30, приемлемо от 0,20. Отрицательная — почти всегда ошибка в ключе или двусмысленность.",
  },
  {
    term: "Индекс дискриминации (D)",
    what: "Разница долей набранного балла в сильной и слабой группах.",
    marks: "Отлично от 0,40, хорошо 0,30 — 0,39, слабо ниже 0,20, дефект — отрицательный.",
  },
  {
    term: "Сильные и слабые 27 %",
    what: "Участники сортируются по доле балла на своей форме; берутся верхние 27 % и нижние 27 %.",
    marks: "При таком делении разница между группами самая устойчивая.",
  },
  {
    term: "Надёжность (альфа Кронбаха)",
    what: "Насколько согласованно задания теста меряют одно и то же.",
    marks: "Приемлемо от 0,70, хорошо от 0,80. Выше 0,95 — подозрение на дубли заданий.",
  },
  {
    term: "Ошибка измерения",
    what: "На сколько результат участника может отклониться от его истинного уровня.",
    marks: "Если проходной балл попадает внутрь интервала, решение «сдал / не сдал» определяется ошибкой, а не подготовкой.",
  },
  {
    term: "Наблюдение и n",
    what: "Одно наблюдение — ответ одного участника на одно задание; по умолчанию берётся первая завершённая попытка.",
    marks: "Коэффициенты считаются с 30 наблюдений, надёжными становятся со 100. Трудность показывается с 10.",
  },
  {
    term: "Редакция задания",
    what: "Отпечаток содержания: тип, текст, варианты и верный ответ. Правка любого из них создаёт новую редакцию.",
    marks: "Наблюдения разных редакций не складываются: после правки это психометрически другое задание.",
  },
];

/** Окно «Термины» — развёрнутый разбор величин, который не помещается в подсказку (FR-14b). */
function GlossaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Термины психометрики"
      description="Величины, которые считает вкладка «Качество заданий», и ориентиры к ним"
      size="m"
      footer={<Button variant="secondary" onClick={onClose}>Закрыть</Button>}
    >
      <Stack gap={4}>
        {GLOSSARY.map(entry => (
          <Stack key={entry.term} gap={1}>
            <Text variant="body-m" weight="semibold">{entry.term}</Text>
            <Text variant="body-s">{entry.what}</Text>
            <Text variant="body-xs" tone="muted">{entry.marks}</Text>
          </Stack>
        ))}
      </Stack>
    </ModalDialog>
  );
}
