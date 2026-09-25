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
  SegmentedControl, Stack, Tag, Text, Tooltip, type SortDir,
} from "@skillum/ui-kit";
import { Download, Info } from "lucide-react";

import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import type { QuestionType } from "@shared/questions/question-type";
import { pluralize } from "@/lib/i18n";

import { COEFFICIENT_MIN, num } from "./psychometrics-format";

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
  /**
   * FR-41: доля наблюдений, где задание не выдавалось. Может отсутствовать у ответов ручки,
   * выданных до этого требования.
   */
  missingShare?: number;
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
  | {
    alpha: number; items: number; respondents: number; totalSd: number; dichotomous: boolean;
    /**
     * FR-20: способ расчёта — полный набор, общее ядро или оценка по связям заданий
     * (неоднородная выдача). Отсутствует у ответов ручки до этого требования — это полный набор.
     */
    method?: "full" | "core" | "pairwise";
    pairs?: number;
  }
  | "too-few-items" | "too-few-respondents" | "no-variance" | "random-delivery";

export interface ItemQualityView {
  items: ItemQualityRow[];
  reliability: ReliabilityView;
  sem: number | null;
  /** FR-20: альфа по общему ядру рядом с оценкой по связям заданий; `null` — ядра нет. */
  coreReliability?: Exclude<ReliabilityView, string> | null;
  /**
   * FR-22: прогноз длины теста ради целевой надёжности. `null` — надёжности нет, и удлинять
   * нечего; поля может не быть вовсе у ответов ручки, выданных до этого требования.
   */
  lengthForecast?: { target: number; factor: number; itemsDelta: number } | null;
  /** `withinBand` (FR-21a) — скольких участников интервал задел; может не быть у старых ответов. */
  cutBand: { low: number; high: number; z: number; withinBand?: number } | null;
  sample: {
    respondents: number;
    responses: number;
    bySource: Record<string, number>;
    unknownVersionShare: number;
  };
  firstAttemptOnly: boolean;
  /**
   * FR-11: сколько взаимодействий импорта не нашли своего задания — видимая потеря выборки.
   * Может отсутствовать у ответов ручки до этого требования.
   */
  unmatched?: number;
  /**
   * Порог наблюдений инстанса для трудности (FR-38a, `analytics.minObservations`). Нужен
   * состоянию «данных мало»: там сказано, с чего трудность начинает показываться.
   */
  minObservations?: number;
  /** Поводы к баннеру смещения (FR-39, FR-40); отсутствует у старых ответов ручки. */
  /**
   * Поводы усомниться в числах. `mixedAnonymity` (FR-43) — в выборке соседствуют `external_id`
   * нашего вида и заведомо чужого, то есть построенные разными алгоритмами; поля может не быть
   * у ответов ручки до этого требования.
   */
  bias?: { unevenDelivery: boolean; importShare: number; mixedAnonymity?: boolean };
  /** Все задания теста измерительные: трудности и дискриминации у него нет (FR-52). */
  measurementOnly?: boolean;
}

export interface ItemQualityPanelProps {
  view: ItemQualityView;
  /** Ссылки выгрузок: отчёт и матрица. Без них кнопки не рисуются. */
  exportHref?: string;
  matrixHref?: string;
  /** Открыть разбор задания. Без обработчика строка никуда не ведёт. */
  onOpenItem?: (questionId: string) => void;
  /**
   * PRD-66 FR-51: вернуть расчёт по первой попытке. Кнопка стоит в предупреждении «Посчитано по
   * всем попыткам» — это и есть путь назад после снятия чипа в строке фильтра.
   */
  onRestoreFirstAttempt?: () => void;
  /**
   * PRD-66 FR-05, FR-48: эвристики PRD-56 «Требуют ревизии» по идентификатору задания. Без них
   * таблица знает только психометрические признаки.
   */
  heuristics?: Record<string, ReviewHeuristic>;
}

/** Как источник наблюдений подписывается человеку. */
const SOURCE_TITLE: Record<string, string> = {
  web: "веб",
  telemetry: "телеметрия LMS",
  import: "импорт выгрузок",
};

/**
 * Доля наблюдений, где задание не выдавалось (FR-41), — или ничего.
 *
 * Молчит не только при нуле, но и при доле меньше процента: «не выдано 0 %» — строка, которая
 * занимает место и не сообщает ничего. Требование про выборку из импорта, где эта доля
 * исчисляется десятками процентов.
 */
function missingText(share: number | undefined): string | null {
  if (share === undefined) return null;
  const percent = Math.round(share * 100);
  return percent < 1 ? null : `не выдано ${percent} %`;
}

/**
 * Прогноз длины словами (FR-22): чего не хватает или что можно снять.
 *
 * Нулевая разница не печатается: «добавьте 0 заданий» — не совет, а шум. Целевая надёжность
 * названа прямо в строке, потому что без неё «ещё 25 заданий» не значит ничего.
 */
function forecastOf(forecast: { target: number; itemsDelta: number } | null | undefined): string | null {
  if (!forecast || forecast.itemsDelta === 0) return null;
  const target = num(forecast.target);
  if (forecast.itemsDelta > 0) {
    const count = forecast.itemsDelta;
    return `до ${target} — ещё ${count} ${pluralize(count, "вопрос", "вопроса", "вопросов")}`;
  }
  const count = -forecast.itemsDelta;
  return `надёжность выше цели ${target}: ${count} ${pluralize(count, "вопрос", "вопроса", "вопросов")} можно снять`;
}

/** Оценка альфы словами — ориентиры FR-19. */
function alphaVerdict(alpha: number): string {
  if (alpha >= 0.95) return "подозрение на дубли вопросов";
  if (alpha >= 0.8) return "хорошо";
  if (alpha >= 0.7) return "приемлемо";
  return "ниже приемлемого";
}

/** Почему надёжности нет — словами, а не пустой плиткой. */
const RELIABILITY_GAP: Record<string, string> = {
  "too-few-items": "в наборе меньше двух вопросов",
  "too-few-respondents": "меньше двух участников с полным набором",
  "no-variance": "все набрали поровну",
  // FR-20: полного набора нет и не будет, и пары заданий почти не пересекаются.
  "random-delivery": "неприменимо к случайной выдаче: у участников разные наборы и мало общих пар вопросов",
};

/**
 * Подпись под числом надёжности: как оно посчитано и на скольких (FR-20).
 *
 * Оценка по связям заданий — не альфа полного набора, и выдавать её за альфу нельзя: подпись
 * называет способ и длину варианта, для которой число верно.
 */
function reliabilityCaption(reliability: Exclude<ReliabilityView, string>): string {
  if (reliability.method === "pairwise") {
    return `${alphaVerdict(reliability.alpha)} · оценка по связям вопросов · вариант из ${reliability.items} ${pluralize(reliability.items, "вопроса", "вопросов", "вопросов")}`;
  }
  if (reliability.method === "core") {
    return `${alphaVerdict(reliability.alpha)} · по общему ядру · ${reliability.items} ${pluralize(reliability.items, "вопрос", "вопроса", "вопросов")}`;
  }
  return `${alphaVerdict(reliability.alpha)} · ${reliability.respondents} ${pluralize(reliability.respondents, "участник", "участника", "участников")}`;
}

/**
 * Эвристики PRD-56 «Требуют ревизии» одного задания и числа, которые их вызвали (FR-05).
 *
 * Приходят из статистики вопросов «Обзора» (`questionStats`): эвристики считает PRD-56, и
 * второй копии их правил здесь нет.
 */
export interface ReviewHeuristic {
  /** Виды сработавших эвристик: `hard-and-frequent`, `fast-and-wrong`. */
  kinds: string[];
  exposurePercent: number | null;
  correctPercent: number | null;
  latencyMedianMs: number | null;
}

/** Процент без десятых — как в подписях PRD-56. */
function wholePercent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} %`;
}

/** Признак-эвристика словами и числами; подписи — из эскизов PRD-66 и PRD-56. */
function heuristicFlag(heuristic: ReviewHeuristic | undefined): { tone: "warning"; title: string; detail: string } | null {
  if (!heuristic) return null;
  if (heuristic.kinds.includes("hard-and-frequent")) {
    return {
      tone: "warning",
      title: "Заезжено и трудно",
      detail: `${wholePercent(heuristic.exposurePercent)} показов, ${wholePercent(heuristic.correctPercent)} верных`,
    };
  }
  if (heuristic.kinds.includes("fast-and-wrong")) {
    const latency = heuristic.latencyMedianMs === null ? "—" : `${Math.round(heuristic.latencyMedianMs / 1000)} с`;
    return {
      tone: "warning",
      title: "Слишком быстрые ответы",
      detail: `медиана ${latency} при ${wholePercent(heuristic.correctPercent)} верных`,
    };
  }
  return null;
}

/**
 * Признак задания: заголовок-симптом и числа, которые его вызвали (FR-50).
 *
 * Порядок проверок — это и есть «сила подозрения»: прямой дефект вперёд, спокойное задание в
 * конец. Первым идёт отрицательная дискриминативность: сильные, ошибающиеся чаще слабых, почти
 * всегда означают испорченный ключ, и это чинят раньше всего остального.
 */
function flagOf(row: ItemQualityRow, heuristic?: ReviewHeuristic): { tone: "error" | "warning" | "info"; title: string; detail: string } | null {
  if (row.flags.negativeDiscrimination) {
    return {
      tone: "error",
      title: "Сильные ошибаются чаще",
      // FR-16a: заголовок — симптом, подпись — вероятная причина и числа, на которых она стоит.
      detail: `вероятна ошибка в ключе: r = ${num(row.itemRest)}, D = ${num(row.discrimination)}`,
    };
  }
  if (row.flags.atChanceLevel) {
    return {
      tone: "error",
      title: "На уровне угадывания",
      detail: `с поправкой ${num(row.correctedDifficulty)}`,
    };
  }
  // FR-05, FR-48: эвристики PRD-56 — сразу за прямыми дефектами. На малой выборке они стоят
  // вместо «мало данных»: там это единственное, что можно сказать о задании.
  const byHeuristic = heuristicFlag(heuristic);
  if (byHeuristic) return byHeuristic;
  if (row.timingFlags.rushed) {
    return { tone: "warning", title: "Отвечают не читая", detail: "ответ быстрее, чем вопрос можно прочесть" };
  }
  if (row.flags.tooHard) {
    return { tone: "warning", title: "Слишком трудный", detail: `трудность ${num(row.difficulty)}` };
  }
  if (row.flags.tooEasy) {
    return { tone: "warning", title: "Слишком лёгкий", detail: `трудность ${num(row.difficulty)}` };
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
function suspicious(row: ItemQualityRow, heuristic?: ReviewHeuristic): boolean {
  const flag = flagOf(row, heuristic);
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
/** Ранг задания «мало данных» без эвристики: последние в любом порядке (FR-48a). */
const THIN_RANK = 90;

function suspicionRank(row: ItemQualityRow, heuristic?: ReviewHeuristic): number {
  const hasHeuristic = heuristicFlag(heuristic) !== null;
  // Эвристика поднимает задание и на малой выборке (FR-05): «мало данных» — последними, только
  // когда сказать о задании больше нечего.
  if (row.coefficientConfidence === "insufficient") return hasHeuristic ? 3 : THIN_RANK;
  if (row.flags.negativeDiscrimination) return 1;
  if (row.flags.atChanceLevel) return 2;
  if (hasHeuristic) return 3;
  if (row.timingFlags.rushed) return 4;
  if (row.flags.tooHard) return 5;
  if (row.flags.tooEasy) return 6;
  if (row.timingFlags.slow) return 7;
  return 50;
}

/**
 * Внутри одного ранга — по величине, вызвавшей признак (FR-48a).
 *
 * У отрицательной дискриминации это сама дискриминативность: чем глубже минус, тем раньше
 * строка. У прочих рангов — трудность, потому что именно она вызвала признак.
 */
function withinRank(row: ItemQualityRow, heuristic?: ReviewHeuristic): number {
  if (row.flags.negativeDiscrimination) return row.itemRest ?? 0;
  if (row.flags.atChanceLevel) return row.correctedDifficulty ?? 0;
  // У эвристики признак вызвала доля верных: чем она ниже, тем раньше строка.
  if (heuristicFlag(heuristic)) return (heuristic?.correctPercent ?? 0) / 100;
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

/** Колонки, по которым сортируется таблица заданий (FR-48a). */
type SortColumn = "question" | "flag" | "difficulty" | "itemRest" | "observations";

/**
 * Числовое значение колонки для сортировки; `null` — показывать нечего («мало данных» или
 * невычислимо). Такие строки идут последними в обоих направлениях: пустое не меньше и не
 * больше числа, оно просто не сравнивается.
 */
function sortNumber(row: ItemQualityRow, column: SortColumn): number | null {
  if (column === "difficulty") return row.difficultyConfidence === "insufficient" ? null : row.difficulty;
  if (column === "itemRest") return row.coefficientConfidence === "insufficient" ? null : row.itemRest;
  if (column === "observations") return row.observations;
  return null;
}

/**
 * Сравнение двух строк таблицы для выбранной колонки и направления (FR-48a).
 *
 * «Признак» сортируется по рангу подозрения (FR-48), а не по алфавиту ярлыков; обратное
 * направление ведёт от спокойных заданий к самым тревожным. Задания «мало данных» без
 * эвристики — последними в обоих направлениях: признака у них нет не потому, что они здоровы.
 */
function compareRows(
  a: ItemQualityRow,
  b: ItemQualityRow,
  column: SortColumn,
  dir: SortDir,
  heuristics: Record<string, ReviewHeuristic>,
): number {
  const sign = dir === "asc" ? 1 : -1;
  if (column === "flag") {
    const rankA = suspicionRank(a, heuristics[a.questionId]);
    const rankB = suspicionRank(b, heuristics[b.questionId]);
    const lastA = rankA === THIN_RANK;
    const lastB = rankB === THIN_RANK;
    if (lastA !== lastB) return lastA ? 1 : -1;
    return sign * (rankA - rankB
      || withinRank(a, heuristics[a.questionId]) - withinRank(b, heuristics[b.questionId]));
  }
  if (column === "question") {
    return sign * (a.prompt ?? a.questionId).localeCompare(b.prompt ?? b.questionId, "ru");
  }
  const valueA = sortNumber(a, column);
  const valueB = sortNumber(b, column);
  if (valueA === null || valueB === null) {
    if (valueA === valueB) return 0;
    return valueA === null ? 1 : -1;
  }
  return sign * (valueA - valueB);
}

/** Вкладка «Качество заданий». */
export function ItemQualityPanel({ view, exportHref, matrixHref, onOpenItem, onRestoreFirstAttempt, heuristics = {} }: ItemQualityPanelProps) {
  const [tab, setTab] = useState<View>("all");
  const [glossary, setGlossary] = useState(false);
  // Порядок по умолчанию — сила подозрения (FR-48): список открывается тем, что чинят первым.
  const [sortColumn, setSortColumn] = useState<SortColumn>("flag");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  const suspiciousCount = view.items.filter(r => suspicious(r, heuristics[r.questionId])).length;
  const thinCount = view.items.filter(r => r.coefficientConfidence === "insufficient").length;
  const reliableCount = view.items.filter(r => r.coefficientConfidence === "reliable").length;

  const rows = view.items
    .filter(row =>
      tab === "all" ? true
        : tab === "suspicious" ? suspicious(row, heuristics[row.questionId])
          : row.coefficientConfidence === "insufficient")
    .slice()
    .sort((a, b) => compareRows(a, b, sortColumn, sortDir, heuristics));

  const reliability = typeof view.reliability === "string" ? null : view.reliability;
  const forecastText = forecastOf(view.lengthForecast);
  /**
   * FR-46: данных мало на уровне ТЕСТА — участников меньше, чем нужно коэффициентам. Вкладка
   * всё равно показывается, но вместо плиток и признаков говорит, сколько собрано и сколько
   * добрать: плитки с прочерками читались бы как поломка.
   */
  const thin = view.sample.respondents < COEFFICIENT_MIN;

  /**
   * Скольких участников задел интервал у порога (FR-21a).
   *
   * Число берётся из расчёта, а не выводится из доли: «внутри интервала» — это про сумму
   * баллов конкретного человека, и прикидка по проценту здесь была бы выдумкой.
   */
  const within = view.cutBand?.withinBand;
  const affectedText = within === undefined
    ? ""
    : within === 0
      ? "Пока в него не попал никто."
      // Знаменатель — участники С ПОЛНЫМ НАБОРОМ, по которым считалась надёжность, а НЕ вся
      // выборка: у видевшего не все задания сумма меньше по построению, и в интервал он не
      // сравнивается. «16 из 60» при надёжности, посчитанной по двадцати, — разные выборки в
      // одной фразе (вскрыто приёмкой).
      // FR-20: при оценке по связям заданий полного набора нет ни у кого, и сравниваются итоги
      // участников с вариантом той же длины.
      : `Затронуто ${within} из ${reliability?.respondents ?? view.sample.respondents} ${pluralize(reliability?.respondents ?? view.sample.respondents, "участника", "участников", "участников")} ${reliability?.method === "pairwise"
        ? `с вариантом из ${reliability.items} ${pluralize(reliability.items, "вопроса", "вопросов", "вопросов")}`
        : "с полным набором вопросов"}.`;

  /**
   * Поводы к баннеру смещения (FR-39, FR-40).
   *
   * Баннер один, поводов два, и каждый назван своими словами: «выдача неоднородна» и «заметная
   * доля наблюдений из импорта» чинятся по-разному, и склеить их в одну фразу значило бы
   * оставить автора гадать, о чём речь.
   */
  const biasReasons: string[] = [];
  if (view.bias?.unevenDelivery) {
    biasReasons.push("Выдача неоднородна: участники видели разные наборы вопросов, и корреляции считаются по пересекающимся, но разным выборкам.");
  }
  if ((view.bias?.importShare ?? 0) >= 0.2) {
    biasReasons.push(`Заметная доля наблюдений пришла из импорта (${Math.round((view.bias?.importShare ?? 0) * 100)} %): там исход бинарный вместо доли балла, а редакция вопроса неизвестна.`);
  }

  const columns = [
    {
      key: "question",
      // Ширины заданы долями НАМЕРЕННО: без них задание с абзацем текста растягивает первую
      // колонку и вытесняет за край остальные — вскрыто приёмкой на синтетических данных.
      width: "38%",
      header: "Вопрос",
      frozen: true,
      sortable: true,
      render: (row: ItemQualityRow) => (
        <Stack gap={1}>
          <span className="ou-stack ou-stack--row ou-stack--gap-1 ou-stack--ai-center">
            {row.questionType
              ? <QuestionTypeIcon type={row.questionType as QuestionType} size={16} />
              : null}
            {/* Текст задания переносится и не растягивает колонку: у задания бывает абзац. */}
            <span className="tb-psy-prompt">{row.prompt ?? row.questionId}</span>
          </span>
          {row.topicName ? <Text variant="body-xs" tone="muted">{row.topicName}</Text> : null}
        </Stack>
      ),
    },
    {
      key: "flag",
      sortable: true,
      width: "26%",
      // FR-46: пока данных мало, колонка говорит не о симптоме, а о том, сколько добрать.
      header: thin
        ? "Состояние"
        : <TermHeader
          term="Признак"
          hint="Что не так с вопросом. Признак ставится по числам этой же строки: он называет симптом, а причину оставляет автору."
        />,
      render: (row: ItemQualityRow) => {
        const flag = flagOf(row, heuristics[row.questionId]);
        if (thin && (!flag || flag.tone === "info")) {
          const needed = Math.max(0, COEFFICIENT_MIN - row.observations);
          return (
            <Text variant="body-xs" tone="muted">
              {needed > 0
                ? `Нужно ещё ${needed} ${pluralize(needed, "наблюдение", "наблюдения", "наблюдений")}`
                : "—"}
            </Text>
          );
        }
        // FR-38: коэффициент на 30–99 наблюдениях — ориентировочный. Без метки «0,26» на сорока
        // наблюдениях и на четырёхстах выглядели бы одинаково.
        const tentative = row.coefficientConfidence === "tentative";
        const observed = `${row.observations} ${pluralize(row.observations, "наблюдение", "наблюдения", "наблюдений")}`;
        // Тег — по ширине текста, как в эскизе: растянутый на колонку, он читался как полоса.
        if (!flag) {
          if (!tentative) return <Text variant="body-xs" tone="muted">—</Text>;
          return (
            <Stack gap={1} align="start">
              <Tag tone="info" size="s">Ориентировочно</Tag>
              <Text variant="body-xs" tone="muted">{observed}</Text>
            </Stack>
          );
        }
        // Признак главнее оговорки, но оговорка не теряется — там, где признак стоит на
        // КОЭФФИЦИЕНТЕ. Трудность и признаки по ней правилу FR-38 не подчиняются (FR-38a).
        const coefficientFlag = row.flags.negativeDiscrimination;
        return (
          <Stack gap={1} align="start">
            <Tag tone={flag.tone} size="s">{flag.title}</Tag>
            <Text variant="body-xs" tone="muted">
              {tentative && coefficientFlag ? `${flag.detail} · ориентировочно, ${observed}` : flag.detail}
            </Text>
          </Stack>
        );
      },
    },
    {
      key: "difficulty",
      sortable: true,
      width: "12%",
      header: <TermHeader
        term="Трудность"
        hint="Средняя доля набранного балла: 0 — не решил никто, 1 — решили все. Приемлемо 0,20 — 0,80; выше 0,90 вопрос ничего не отсеивает."
      />,
      numeric: true,
      // Трудность живёт при пороге наблюдений инстанса, а коэффициенты — при 30 и 100
      // (FR-38a). Поэтому у задания с дюжиной наблюдений она есть, а дискриминативности нет.
      render: (row: ItemQualityRow) => (
        <Stack gap={1}>
          <Text variant="body-s" tone={row.difficultyConfidence === "insufficient" ? "muted" : undefined}>
            {row.difficultyConfidence === "insufficient" ? "мало данных" : num(row.difficulty)}
          </Text>
          {/*
            FR-41: доля невыданных наблюдений — мера смещения трудности, поэтому стоит рядом
            с ней, а не в своей колонке. Печатается только когда есть о чём говорить: у
            веб-теста, выданного всем, столбец нулей ничего не сообщал бы, а место занял.
          */}
          {missingText(row.missingShare) ? (
            <Text variant="body-xs" tone="subtle">{missingText(row.missingShare)}</Text>
          ) : null}
        </Stack>
      ),
    },
    {
      key: "itemRest",
      sortable: true,
      width: "16%",
      header: <TermHeader
        term="Дискриминативность"
        hint="Отделяет ли вопрос сильных от слабых: корреляция балла за него с баллом за остальные вопросы формы. Хорошо от 0,30, отрицательная — почти всегда ошибка в ключе."
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
      sortable: true,
      width: "8%",
      header: <TermHeader
        term="n"
        hint="Сколько участников выборки видели этот вопрос. Коэффициенты считаются с 30 наблюдений, надёжными становятся со 100."
      />,
      numeric: true,
      render: (row: ItemQualityRow) => <Text variant="body-s">{row.observations}</Text>,
    },
  ];

  // FR-52: у теста, где все задания измерительные, показывать нечего, кроме раздела шкал.
  // Плитки надёжности и таблица заданий с прочерками читались бы как поломка экрана.
  if (view.measurementOnly) {
    return (
      <Card variant="outlined">
        <CardBody>
          <Stack gap={1}>
            <Text variant="body-m" weight="semibold">Тест измерительный</Text>
            <Text variant="body-s" tone="muted">
              У вопросов без эталона нет ни трудности, ни дискриминативности: проверять нечего.
              Качество такого теста описывает раздел шкал ниже.
            </Text>
          </Stack>
        </CardBody>
      </Card>
    );
  }

  return (
    <Stack gap={4}>
      {/*
        FR-51: по всем попыткам считать можно, но осознанно. Повторная попытка того же человека —
        не второй участник, и предупреждение стоит первым, над числами, которые оно касается.
      */}
      {view.firstAttemptOnly === false ? (
        <Banner
          variant="subtle"
          tone="warning"
          title="Посчитано по всем попыткам"
          description="Повторные попытки одного участника не независимы: он учтён несколько раз, коэффициенты смещаются, а пороги достоверности достигаются раньше, чем на самом деле. Для отбора вопросов считайте по первой попытке."
          actions={onRestoreFirstAttempt
            // Вне режима `stacked` действие баннера рисуется голым текстом и не читается как
            // кнопка; эскиз ставит сюда вторичную кнопку — её классы и передаются.
            ? [{ label: "Вернуть: только первая попытка", onClick: onRestoreFirstAttempt, className: "ou-btn ou-btn--secondary ou-btn--s" }]
            : undefined}
        />
      ) : null}
      {thin ? (
        <Banner
          variant="subtle"
          tone="info"
          title={`Данных пока мало: собрано ${view.sample.respondents} ${pluralize(view.sample.respondents, "прохождение", "прохождения", "прохождений")}`}
          description={`Дискриминативность считается с ${COEFFICIENT_MIN} наблюдений на вопрос, надёжность теста — с ${COEFFICIENT_MIN} прохождений.${view.minObservations ? ` Трудность показывается с ${view.minObservations} наблюдений.` : ""}`}
        />
      ) : null}
      {/* FR-46: плитки с прочерками читались бы как поломка — пока данных мало, их нет. */}
      {thin ? null : (
      <Grid minItem="sm" gap={1}>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{reliability ? num(reliability.alpha) : "—"}</Text>
              {/* FR-20: оценка по связям заданий — не альфа полного набора, и заголовок это говорит. */}
              <Text variant="body-s" tone="muted">
                {reliability?.method === "pairwise" ? "Надёжность (оценка)" : "Надёжность (альфа)"}
              </Text>
              <Text variant="body-xs" tone="subtle">
                {reliability
                  ? reliabilityCaption(reliability)
                  : RELIABILITY_GAP[view.reliability as string] ?? "посчитать не на чем"}
              </Text>
              {/* FR-20: альфа по общему ядру — рядом с оценкой, когда у теста есть такие задания. */}
              {view.coreReliability ? (
                <Text variant="body-xs" tone="subtle">
                  {`по общему ядру из ${view.coreReliability.items} ${pluralize(view.coreReliability.items, "вопроса", "вопросов", "вопросов")} — ${num(view.coreReliability.alpha)}`}
                </Text>
              ) : null}
              {/*
                FR-22: прогноз длины — ПОДПИСЬЮ под надёжностью, а не своей плиткой. Это совет
                к действию, а не измеренная величина, и в ряду метрик он читался бы как ещё
                одно измерение. Оговорка «задания такого же качества» — в окне «Термины»:
                в подписи из пяти слов ей места нет, а умолчать о ней нельзя.
              */}
              {forecastText ? (
                // Выравнивание задано явно: подпись прогноза — единственная в плитке, которая
                // переносится на вторую строку, и без этого перенос ломал центровку карточки.
                <Text variant="body-xs" tone="subtle" align="center">{forecastText}</Text>
              ) : null}
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
              <Text variant="body-xs" tone="subtle">из {view.items.length} {pluralize(view.items.length, "вопроса", "вопросов", "вопросов")}</Text>
            </Stack>
          </CardBody>
        </Card>
        <Card variant="outlined">
          <CardBody>
            <Stack gap={1} align="center">
              <Text variant="display-s" weight="bold">{reliableCount}</Text>
              <Text variant="body-s" tone="muted">Вопросов с надёжной оценкой</Text>
              <Text variant="body-xs" tone="subtle">n не меньше 100</Text>
            </Stack>
          </CardBody>
        </Card>
      </Grid>
      )}

      {!thin && biasReasons.length > 0 ? (
        <Banner
          variant="subtle"
          tone="info"
          title="Показатели дискриминации ослаблены"
          description={`${biasReasons.join(" ")} Числа остаются полезными для отбора подозрительных вопросов, но сравнивать их с показателями теста, где выдача однородна, нельзя.`}
        />
      ) : null}

      {/*
        FR-43: это НЕ «ослабленные показатели», а прямая ошибка в составе выборки — один
        человек посчитан дважды. Поэтому баннер отдельный и тоном выше, чем у смещения: там
        числа остаются полезными, здесь завышено само число респондентов, на котором стоят
        все пороги достоверности.
      */}
      {view.bias?.mixedAnonymity ? (
        <Banner
          variant="subtle"
          tone="warning"
          title="Часть участников могли быть посчитаны дважды"
          description="В части выгрузок идентификатор участника (external_id) построен не скриптом обезличивания, а другим способом. Такой идентификатор не совпадает с тем, что вычисляет система, поэтому один человек мог попасть в выборку дважды: число респондентов завышено, а пороги достоверности достигаются раньше, чем на самом деле. Постройте external_id скриптом обезличивания и загрузите эти выгрузки заново — или снимите их с учёта переключателем «В расчётах» в списке загрузок формы импорта."
        />
      ) : null}

      {!thin && view.cutBand ? (
        <Banner
          variant="subtle"
          tone="warning"
          title="Проходной балл попадает внутрь интервала ошибки измерения"
          // FR-21a: сколько участников интервал задел ФАКТИЧЕСКИ. Без этого числа
          // предупреждение ни о чём: двое из шестидесяти и половина потока требуют разных
          // действий. Ноль тоже называется словами — молчание читалось бы как «не посчитали».
          description={`Интервал ${num(view.cutBand.low)} — ${num(view.cutBand.high)} в долях балла. Решение «сдал / не сдал» у участников внутри него определяется ошибкой измерения, а не подготовкой. ${affectedText}`}
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
            {/* FR-11: потеря выборки видна рядом с n, а не только в протоколе загрузки. */}
            {view.unmatched ? (
              <Tag tone="warning" size="s">не сопоставлено — {view.unmatched}</Tag>
            ) : null}
            <Tag tone={view.firstAttemptOnly ? "neutral" : "warning"} size="s">
              {view.firstAttemptOnly ? "только первая попытка" : "все попытки"}
            </Tag>
          </Stack>
        </CardBody>
      </Card>

      <Card variant="outlined">
        <CardHeader
          title="Вопросы"
          subtitle={`${view.items.length} ${pluralize(view.items.length, "вопрос", "вопроса", "вопросов")} · ${thin ? "накопление наблюдений" : "отсортированы по силе подозрения"}`}
          // FR-46: пока данных мало, отбирать «под подозрением» не из чего — переключателя нет.
          trail={thin ? undefined : (
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
          )}
        />
        <CardBody>
          <DataGrid
            columns={columns}
            rows={rows}
            rowKey={row => row.questionId}
            sortKey={sortColumn}
            sortDir={sortDir}
            onSort={(key, dir) => { setSortColumn(key as SortColumn); setSortDir(dir); }}
            onRowClick={onOpenItem ? row => onOpenItem(row.questionId) : undefined}
            emptyMessage={tab === "suspicious"
              ? "Признаки не сошлись ни у одного вопроса"
              : tab === "thin"
                ? "Данных хватает по всем вопросам"
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
    what: "Средняя доля набранного балла по вопросу: 0 — не решил никто, 1 — решили все.",
    marks: "Приемлемо 0,20 — 0,80. Ниже 0,20 вопрос слишком трудный, выше 0,90 — никого не отсеивает.",
  },
  {
    term: "Поправка на угадывание",
    what: "Трудность за вычетом доли, которую даёт случайный выбор. Считается только для вопросов с одним верным ответом.",
    marks: "Ноль и ниже — вопрос неотличим от подбрасывания монетки.",
  },
  {
    term: "Дискриминативность (r)",
    what: "Корреляция балла за вопрос с баллом за остальные вопросы формы: отделяет ли вопрос сильных от слабых.",
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
    what: "Насколько согласованно вопросы теста меряют одно и то же.",
    marks: "Приемлемо от 0,70, хорошо от 0,80. Выше 0,95 — подозрение на дубли вопросов.",
  },
  {
    term: "Прогноз длины теста",
    what: "Сколько вопросов нужно добавить или можно снять ради надёжности 0,80 (формула Спирмена-Брауна).",
    marks: "Прогноз исходит из того, что добавленные вопросы будут такого же качества, что нынешние; на практике они обычно слабее, поэтому число оптимистичное. К случайной выдаче без общего ядра вопросов он неприменим — там нет и самой надёжности.",
  },
  {
    term: "Ошибка измерения",
    what: "На сколько результат участника может отклониться от его истинного уровня.",
    marks: "Если проходной балл попадает внутрь интервала, решение «сдал / не сдал» определяется ошибкой, а не подготовкой.",
  },
  {
    term: "Наблюдение и n",
    what: "Одно наблюдение — ответ одного участника на один вопрос; по умолчанию берётся первая завершённая попытка.",
    marks: "Коэффициенты считаются с 30 наблюдений, надёжными становятся со 100. Трудность показывается с 10.",
  },
  {
    term: "Редакция вопроса",
    what: "Отпечаток содержания: тип, текст, варианты и верный ответ. Правка любого из них создаёт новую редакцию.",
    marks: "Наблюдения разных редакций не складываются: после правки это психометрически другой вопрос.",
  },
];

/** Окно «Термины» — развёрнутый разбор величин, который не помещается в подсказку (FR-14b). */
function GlossaryDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      title="Термины психометрики"
      description="Величины, которые считает вкладка «Качество вопросов», и ориентиры к ним"
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
