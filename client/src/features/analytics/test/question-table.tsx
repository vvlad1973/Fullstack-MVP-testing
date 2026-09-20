/**
 * @module features/analytics/test/question-table
 * @description PRD-56 FR-15, FR-16, FR-17, FR-22: таблица заданий теста.
 *
 * Одна строка отвечает на вопрос «что с этим заданием»: доля верных, пропуски, экспозиция,
 * время и авторская трудность рядом. Тип задания — пиктограммой, той же, что в дереве контента
 * и в таблице «Оценка» редактора: словом он занимал бы колонку, ничего к ней не добавляя.
 *
 * Вид «требуют ревизии» — отбор по СОШЕДШИМСЯ признакам, и каждый назван словами прямо в
 * строке: вид без объяснения читается как приговор заданию, а решение принимает автор.
 *
 * У измерительного задания доли верных нет вовсе (FR-22): эталона у него не существует, и ноль
 * в этой колонке был бы про него ложью — поэтому прочерк.
 */
import { useEffect, useMemo, useState } from "react";

import { Ban } from "lucide-react";

import {
  Button, Card, CardBody, CardHeader, DataGrid, ModalDialog, ProgressBar, SegmentedControl,
  Stack, Text,
} from "@skillum/ui-kit";

import type { QuestionType } from "@shared/questions/question-type";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { pluralize } from "@/lib/i18n";

/** Признак ревизии — то, что отдаёт `GET /api/analytics/tests/:testId`. */
export interface ReviewFlagView {
  kind: string;
  reason: string;
}

/** Строка таблицы заданий. */
export interface QuestionRow {
  questionId: string;
  questionPrompt: string;
  questionType: string;
  topicName: string;
  difficulty: number;
  totalAnswers: number;
  gradedAnswers: number;
  correctAnswers: number;
  /** `null` — оценивать было нечего (измерительное задание). */
  correctPercent: number | null;
  /** Доля пропусков; `null` — состав выдачи неизвестен (прохождения только из LMS). */
  skipShare: number | null;
  exposurePercent: number | null;
  latencyMedianMs: number | null;
  latencySampleSize: number;
  reviewFlags: ReviewFlagView[];
  /** PRD-56 FR-17a: задание исключено из выдачи ЭТОГО теста. */
  excludedFromDelivery?: boolean;
  /**
   * PRD-56 FR-22: разброс ответов измерительного задания — то, чем у него заменена доля
   * верных. `null` — задание оценивается либо разбрасывать нечего.
   */
  spread?: { options: Array<{ label: string; share: number }>; answered: number } | null;
  /**
   * PRD-57 FR-32: сводка свободного текста — сколько написали и как длинно. Частотная
   * таблица развёрнутому ответу не годится: двух одинаковых ответов не бывает.
   */
  volume?: { answered: number; medianLength: number; minLength: number; maxLength: number } | null;
}

/** Строка списка ответов — то, что отдаёт `GET .../questions/:id/answers` (FR-32). */
interface AnswerRow {
  attemptId: string;
  source: string;
  participant: string;
  at: string | null;
  answer: string;
  length: number;
  result: string;
  latencyMs: number | null;
}

export interface QuestionTableProps {
  questions: QuestionRow[];
  /**
   * Тест измерительный: вместо доли верных таблица показывает разброс ответов (FR-22).
   *
   * Признак приходит сверху, а не выводится из строк: таблица, где доля верных пуста у всех
   * заданий, бывает и у оцениваемого теста, по которому ещё никто не проходил, а набор
   * колонок от количества прохождений зависеть не должен.
   */
  measurement?: boolean;
  /** Порог наблюдений: ниже него разброс не печатается, потому что он шум (FR-06d). */
  minObservations?: number;
  /** Уйти в реестр к прохождениям, где на этом задании ошиблись (FR-17). */
  onOpenRegistry?: (questionId: string) => void;
  /** Переключить состояние «исключён из выдачи» (FR-17a). Без него действие не предлагается. */
  onDeliveryChange?: (questionId: string, excluded: boolean) => void;
  /** Тест, у которого спрашиваются последствия исключения. */
  testId?: string;
}

/** Почему выдачу собрать нельзя — находка проверки выполнимости. */
interface DeliveryIssue {
  kind: string;
  tag?: string;
  requested?: number;
  available?: number;
  required?: number;
}

/** Последствия исключения — то, что отдаёт `GET .../delivery-impact` (FR-17b). */
interface DeliveryImpact {
  topicName: string;
  remaining: number;
  drawCount: number;
  allowed: boolean;
  findings?: Array<{ topicName: string; issues: DeliveryIssue[] }>;
}

/**
 * Причина отказа словами.
 *
 * «Выдачу собрать нельзя» без причины оставляет автора гадать, что чинить: не хватает заданий
 * вообще или проседает квота одного тега — это разные починки.
 */
function issueText(issue: DeliveryIssue): string {
  if (issue.kind === "quota_shortfall") {
    return `Подтема «${issue.tag}»: нужно ${issue.requested}, останется ${issue.available}`;
  }
  if (issue.kind === "pool_shortfall") {
    return `Заданий в теме: нужно ${issue.required}, останется ${issue.available}`;
  }
  return "Выдача этого раздела перестанет собираться";
}

type View = "all" | "review" | "excluded";
type SortDir = "asc" | "desc";

/** Процент для чтения человеком; прочерк там, где величины нет. */
function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} %`;
}

/** Время на задание: минуты и секунды, как их читают. */
function duration(ms: number | null): string {
  if (ms === null) return "—";
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Значение для сортировки: отсутствующее всегда уезжает в конец. */
function sortValue(row: QuestionRow, key: string): number {
  const value = key === "correct" ? row.correctPercent
    : key === "skip" ? row.skipShare
      : key === "exposure" ? row.exposurePercent
        : key === "latency" ? row.latencyMedianMs
          : key === "difficulty" ? row.difficulty
            : row.totalAnswers;
  return value ?? Number.POSITIVE_INFINITY;
}

/**
 * Сколько долей печатается в строке разброса; остальные — «ещё N».
 *
 * У шкалы подписи — градации в слово или цифру, их влезает четыре. У распределения баллов
 * подпись это утверждение на строку, и больше двух в колонку не помещается никак.
 */
const SPREAD_VISIBLE: Record<string, number> = { scale: 4, allocation: 2 };

/** Предел длины подписи варианта: утверждения опросника бывают в целое предложение. */
const SPREAD_LABEL_MAX = 44;

/**
 * Разброс ответов строкой: «Командный 62 % · Вдохновляющий 21 % · ещё 2» (FR-22).
 *
 * Два ограничения, и оба из данных, а не из вкуса. Варианты печатаются по убыванию доли и
 * только первые три: у распределения баллов их бывает десять, и полный перечень занял бы
 * строку на весь экран, ничего к ответу не добавив — хвост из процента-двух не о чём.
 * Подпись варианта режется, потому что у распределения это не слово «Командный», а целое
 * утверждение на строку; полный текст и полный перечень остаются в подсказке.
 *
 * У шкалы подписи короткие («1», «Иногда»), и между меткой и долей ставится тире: без него
 * «1 6 %» читается как одно число. У распределения тире лишнее — эскиз
 * prd56-test-analytics.html, состояние items-measurement.
 */
function spreadLabel(
  options: ReadonlyArray<{ label: string; share: number }>,
  type: string,
): { short: string; full: string } {
  const dash = type === "scale" ? " — " : " ";
  const say = (option: { label: string; share: number }, cut: boolean) => {
    const label = cut && option.label.length > SPREAD_LABEL_MAX
      ? `${option.label.slice(0, SPREAD_LABEL_MAX).trimEnd()}…`
      : option.label;
    return `${label}${dash}${Math.round(option.share)} %`;
  };

  const ranked = [...options].sort((a, b) => b.share - a.share);
  const visible = ranked.slice(0, SPREAD_VISIBLE[type] ?? 3);
  const hidden = ranked.length - visible.length;

  return {
    short: visible.map(option => say(option, true)).join(" · ")
      + (hidden > 0 ? ` · ещё ${hidden}` : ""),
    full: ranked.map(option => say(option, false)).join(" · "),
  };
}

export function QuestionTable({
  questions, onOpenRegistry, onDeliveryChange, testId, measurement, minObservations = 0,
}: QuestionTableProps) {
  const [view, setView] = useState<View>("all");
  const [sortKey, setSortKey] = useState(measurement ? "answers" : "correct");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  /** Задание, для которого открыто окно подтверждения исключения. */
  const [pending, setPending] = useState<QuestionRow | null>(null);
  const [impact, setImpact] = useState<DeliveryImpact | null>(null);
  /** Задание, ответы которого открыты списком (FR-32). */
  const [reading, setReading] = useState<QuestionRow | null>(null);
  const [answers, setAnswers] = useState<AnswerRow[] | null>(null);

  const flagged = useMemo(
    () => questions.filter(question => question.reviewFlags.length > 0),
    [questions],
  );
  const excludedRows = useMemo(
    () => questions.filter(question => question.excludedFromDelivery),
    [questions],
  );
  /**
   * Есть ли в тесте задания, на которые ПИШУТ (PRD-57 FR-28x, FR-32).
   *
   * У них своя колонка, и в ОБЫЧНОМ тесте тоже: у короткого ответа разброс написаний
   * дополняет долю верных (варианты там не заданы заранее), а у свободного текста заменяет
   * её объёмом и длиной. До этого колонка показывалась только у теста, целиком собранного
   * из измерительных заданий, — и всё, что считал сервер с Э3, автор не видел.
   */
  const hasWrittenAnswers = useMemo(
    () => questions.some(question => question.volume || (question.spread && question.correctPercent !== null)),
    [questions],
  );

  // Последствия спрашиваются у сервера при открытии окна: считать остаток пула на клиенте
  // значило бы завести вторую копию правил выдачи, которая однажды разойдётся с первой.
  useEffect(() => {
    if (!pending) {
      setImpact(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/tests/${testId}/questions/${pending.questionId}/delivery-impact`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as DeliveryImpact;
        if (alive) setImpact(data);
      } catch {
        // Вслепую окно подтверждения не спрашивает: без последствий кнопка остаётся
        // выключенной, а читателю сказано, что считаем.
        if (alive) setImpact(null);
      }
    })();
    return () => { alive = false; };
  }, [pending, testId]);

  // FR-32: сами ответы приходят отдельным запросом и только по открытию окна — свободный
  // текст участника не грузится вместе с таблицей, где его никто не просил.
  useEffect(() => {
    if (!reading) {
      setAnswers(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/tests/${testId}/questions/${reading.questionId}/answers`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { rows: AnswerRow[] };
        if (alive) setAnswers(data.rows);
      } catch {
        if (alive) setAnswers([]);
      }
    })();
    return () => { alive = false; };
  }, [reading, testId]);

  const rows = useMemo(() => {
    const shown = view === "review" ? flagged : view === "excluded" ? excludedRows : questions;
    return [...shown].sort((a, b) => {
      const diff = sortValue(a, sortKey) - sortValue(b, sortKey);
      return sortDir === "asc" ? diff : -diff;
    });
  }, [questions, flagged, excludedRows, view, sortKey, sortDir]);

  const columns = [
    {
      key: "question",
      header: "Задание",
      frozen: true,
      // У опросника колонка ограничена: рядом с ней стоит разброс ответов, и текст вопроса,
      // растянувший её по себе, вытолкнул бы за край экрана всё, что правее.
      ...(measurement ? { width: "40%" } : {}),
      render: (row: QuestionRow) => (
        // Текст задания переносится, иначе строка вопроса распирает столбец по себе: ячейки
        // стола по умолчанию не переносятся, и это верно для чисел, но не для предложения.
        <Stack gap={1} className="ou-grid__cell-wrap">
          <Stack direction="row" gap={2} align="center">
            <QuestionTypeIcon type={row.questionType as QuestionType} />
            {/*
              FR-17a: состояние выдачи метится перечёркнутым кругом с подсказкой, а НЕ тегом:
              тег стоит в одном ряду с темой и подтемой и читается как ярлык содержания, а
              речь идёт о состоянии выдачи.
            */}
            {row.excludedFromDelivery && (
              <span
                className="tb-qscoring__qtype"
                title="Исключён из выдачи — в новые прохождения не попадает"
                aria-label="Исключён из выдачи"
              >
                <Ban size={16} color="var(--ou-error-default)" aria-hidden="true" />
              </span>
            )}
            <span className="ou-grid__cell-strong">{row.questionPrompt}</span>
          </Stack>
          <Text variant="body-xs" tone="muted">{row.topicName}</Text>
          {/* Признак назван прямо в строке: отбор без объяснения — это приговор без основания. */}
          {row.reviewFlags.map(flag => (
            <Text key={flag.kind} variant="body-xs" tone="warning">{flag.reason}</Text>
          ))}
        </Stack>
      ),
    },
    // FR-22: у опросника эталона нет, и доля верных заменяется разбросом ответов — полосой
    // с долей лидирующего варианта и полным перечнем долей подписью. Полоса АКЦЕНТНАЯ, без
    // тонов «успех / предупреждение»: высокая доля градации не хороша и не плоха, оценивать
    // её не относительно чего (FR-21b).
    ...(measurement || hasWrittenAnswers ? [{
      key: "spread",
      header: measurement ? "Разброс ответов" : "Что отвечали",
      // Ширина задана, иначе перечень долей растягивает колонку и выталкивает за край
      // экрана те, что стоят правее: у распределения баллов подпись варианта — утверждение.
      width: "34%",
      render: (row: QuestionRow) => {
        // PRD-57 FR-32: у свободного текста вместо долей — объём и длина, а сами работы
        // открываются списком: частот у написанного не бывает, и читать их незачем.
        if (row.volume) {
          if (row.totalAnswers < minObservations) {
            return <Text variant="body-s" tone="muted">мало данных</Text>;
          }
          return (
            <Stack gap={1} className="ou-grid__cell-wrap">
              <Text variant="body-xs" tone="muted">
                {row.volume.answered} {pluralize(row.volume.answered, "ответ", "ответа", "ответов")}
                {" · медиана "}{row.volume.medianLength} {pluralize(row.volume.medianLength, "знак", "знака", "знаков")}
                {" (от "}{row.volume.minLength}{" до "}{row.volume.maxLength}{")"}
              </Text>
              <Button
                variant="ghost"
                size="s"
                aria-label={`Прочитать ответы: ${row.questionPrompt}`}
                onClick={() => setReading(row)}
              >
                Прочитать ответы
              </Button>
            </Stack>
          );
        }
        if (!row.spread || row.totalAnswers < minObservations) {
          return <Text variant="body-s" tone="muted">мало данных</Text>;
        }
        const leader = row.spread.options.reduce(
          (top, option) => (option.share > top.share ? option : top),
          row.spread.options[0],
        );
        const label = spreadLabel(row.spread.options, row.questionType);
        return (
          <Stack gap={1} className="ou-grid__cell-wrap">
            <ProgressBar size="s" value={Math.round(leader.share)} hideHeader />
            <Text variant="body-xs" tone="muted" title={label.full}>
              {label.short}
            </Text>
          </Stack>
        );
      },
    }] : []),
    ...(measurement ? [{
      key: "answers",
      header: "Ответов",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => row.totalAnswers,
    }] : [{
      key: "correct",
      header: "Доля верных",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => percent(row.correctPercent),
    }]),
    {
      key: "skip",
      header: "Пропуски",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => percent(row.skipShare),
    },
    // Экспозиция — свойство ВЫДАЧИ, и у опросника она есть, но эскиз её в этой таблице не
    // держит: строка опросника отвечает на «что выбирали», а как часто задание показывали —
    // вопрос вкладки «Выдача», где профиль банка и стоит (FR-20).
    ...(measurement ? [] : [{
      key: "exposure",
      header: "Выдаётся",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => percent(row.exposurePercent),
    }]),
    {
      key: "latency",
      header: "Время, медиана",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => duration(row.latencyMedianMs),
    },
    // Авторская трудность у опросника бессмысленна: трудным бывает задание с верным ответом,
    // а здесь верного ответа нет вовсе.
    ...(measurement ? [] : [{
      key: "difficulty",
      header: "Трудность",
      numeric: true,
      sortable: true,
      render: (row: QuestionRow) => row.difficulty,
    }]),
    {
      key: "delivery",
      header: "",
      render: (row: QuestionRow) => {
        if (!onDeliveryChange) return null;
        return row.excludedFromDelivery ? (
          <Button
            variant="ghost"
            size="s"
            // Возврат ничего не отнимает и подтверждения не требует (FR-17b).
            aria-label={`Вернуть в выдачу: ${row.questionPrompt}`}
            onClick={() => onDeliveryChange(row.questionId, false)}
          >
            Вернуть в выдачу
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="s"
            aria-label={`Исключить из выдачи: ${row.questionPrompt}`}
            onClick={() => setPending(row)}
          >
            Исключить
          </Button>
        );
      },
    },
    {
      key: "actions",
      header: "",
      render: (row: QuestionRow) => (onOpenRegistry && row.correctPercent !== null ? (
        <Button
          variant="ghost"
          size="s"
          // Название задания — в доступном имени, а не в подписи: подпись с полным условием
          // растянула бы колонку на пол-экрана, а без названия кнопка в длинном списке
          // неотличима от соседних на слух.
          aria-label={`Прохождения с ошибкой: ${row.questionPrompt}`}
          onClick={() => onOpenRegistry(row.questionId)}
        >
          Прохождения
        </Button>
      ) : null),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Вопросы теста"
        subtitle={`${questions.length} ${pluralize(questions.length, "задание", "задания", "заданий")} в выдаче · доля пропусков считается по веб-прохождениям: состав выданной формы пакет не сообщает`}
        trail={
          <SegmentedControl
            size="s"
            value={view}
            onChange={value => setView(value as View)}
            items={[
              { value: "all", label: "Все вопросы" },
              { value: "review", label: "Требуют ревизии", badge: flagged.length },
              { value: "excluded", label: "Исключённые", badge: excludedRows.length },
            ]}
          />
        }
      />
      <CardBody>
        <DataGrid
          columns={columns}
          rows={rows}
          rowKey={row => row.questionId}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={(key, dir) => { setSortKey(key); setSortDir(dir); }}
          emptyMessage={view === "review"
            ? "Признаки проблем не сошлись ни у одного задания: чинить нечего"
            : view === "excluded"
              ? "Из выдачи ничего не исключено"
              : "Заданий в выдаче пока нет"}
        />
      </CardBody>

      {/*
        FR-17b: исключение подтверждается отдельным окном, и окно называет последствия числами.
        Невыполнимая выдача ЗАПРЕЩАЕТ действие, а не сопровождает его предупреждением: тест,
        который нельзя собрать, ломается у участника на старте попытки.
      */}
      <ModalDialog
        open={pending !== null}
        onClose={() => setPending(null)}
        size="s"
        title="Исключить задание из выдачи?"
        description={pending?.questionPrompt}
        footer={
          <>
            <Button variant="ghost" size="m" onClick={() => setPending(null)}>Отмена</Button>
            <Button
              variant="primary"
              size="m"
              disabled={!impact?.allowed}
              onClick={() => {
                if (pending && onDeliveryChange) onDeliveryChange(pending.questionId, true);
                setPending(null);
              }}
            >
              Исключить
            </Button>
          </>
        }
      >
        <Stack gap={3}>
          {impact === null ? (
            <Text tone="muted">Считаем, сколько заданий останется в теме…</Text>
          ) : (
            <>
              <Text>
                В теме «{impact.topicName}» останется {impact.remaining} заданий, а выдавать
                нужно {impact.drawCount}.
              </Text>
              {!impact.allowed && (
                <Stack gap={1}>
                  <Text tone="error">Выдачу собрать будет нельзя:</Text>
                  {(impact.findings ?? []).flatMap(finding => finding.issues).map((issue, index) => (
                    <Text key={index} variant="body-s" tone="error">{issueText(issue)}</Text>
                  ))}
                  <Text variant="body-s" tone="muted">
                    Уменьшите число выдаваемых заданий или добавьте новые в тему.
                  </Text>
                </Stack>
              )}
            </>
          )}
          <Text variant="body-s" tone="muted">
            Опубликованная версия не меняется: пока тест не опубликован заново, и веб, и
            выгруженный пакет SCORM продолжают выдавать это задание по снимку.
          </Text>
        </Stack>
      </ModalDialog>

      {/*
        PRD-57 FR-32: сами работы — списком, с выгрузкой. Отдельного экрана трек не заводит:
        список читают оттуда же, где увидели сводку, и тем же окном, каким таблица уже
        пользуется для подтверждения исключения.
      */}
      <ModalDialog
        open={reading !== null}
        onClose={() => setReading(null)}
        size="l"
        title="Ответы на задание"
        description={reading?.questionPrompt}
        footer={
          <>
            <Button variant="ghost" size="m" onClick={() => setReading(null)}>Закрыть</Button>
            {reading && (
              <Button
                variant="primary"
                size="m"
                // Ссылкой, а не запросом: файл отдаёт сервер, и браузер сохраняет его сам.
                onClick={() => {
                  window.location.href =
                    `/api/analytics/tests/${testId}/questions/${reading.questionId}/answers/export/excel`;
                }}
              >
                Выгрузить в Excel
              </Button>
            )}
          </>
        }
      >
        <Stack gap={3}>
          {answers === null ? (
            <Text tone="muted">Читаем ответы…</Text>
          ) : answers.length === 0 ? (
            <Text tone="muted">На это задание пока никто не ответил</Text>
          ) : (
            answers.map(row => (
              <Stack key={`${row.attemptId}-${row.length}`} gap={1} className="ou-grid__cell-wrap">
                <Text variant="body-xs" tone="muted">
                  {row.participant}
                  {row.at ? ` · ${new Date(row.at).toLocaleString("ru-RU")}` : ""}
                  {` · ${row.length} ${pluralize(row.length, "знак", "знака", "знаков")}`}
                  {row.latencyMs === null ? "" : ` · ${duration(row.latencyMs)}`}
                </Text>
                <Text>{row.answer}</Text>
              </Stack>
            ))
          )}
        </Stack>
      </ModalDialog>
    </Card>
  );
}
