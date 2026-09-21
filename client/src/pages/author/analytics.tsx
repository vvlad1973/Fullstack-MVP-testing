/**
 * @module pages/author/analytics
 * @description Analytics for the author: the passage registry (web, LMS telemetry and
 * imported exports in one list), slices of those passages within a single test, the
 * «needs attention» queue and the configurable Excel export, plus the attempt-details
 * window every list opens into.
 *
 * PRD-56 FR-12 removed the «overview» tab: an average score or pass rate computed ACROSS
 * tests mixes different thresholds, scales and populations, so the number could not be
 * acted upon. What replaced it — slices and the queue — always names the population it
 * describes. Rendered entirely with the Skillum design system.
 */
import { useState } from "react";
import { ExportDialog } from "@/features/analytics/registry/export-dialog";
import { PassageRegistry, type RegistryRow } from "@/features/analytics/registry/passage-registry";
import { useLocation } from "wouter";

import {
  conditionsToFilter,
  countConditions,
  filterToSearch,
  EMPTY_FILTER,
  type RegistryFilter,
} from "@/features/analytics/registry/filter-state";
import { useRegistryFilter } from "@/features/analytics/registry/use-registry-filter";
import { SlicesTab } from "@/features/analytics/slices/slices-tab";
import { AttentionQueue, type AttentionRow } from "@/features/analytics/attention/attention-queue";
import { useQuery } from "@tanstack/react-query";
import { LoadingState } from "@/components/loading-state";
import { LmsImportForm } from "@/features/analytics/lms-import/lms-import-form";
import {
  Box,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  Cluster,
  FormGroup,
  Grid,
  Input,
  ModalDialog,
  ProgressBar,
  ScrollArea,
  Select,
  Separator,
  Stack,
  Tabs,
  Tag,
  Text,
} from "@skillum/ui-kit";
import {
  CheckCircle,
  ChevronDown,
  ChevronRight,
  FileSpreadsheet,
  Globe,
  Server,
  Download,
  Clock,
  XCircle,
  HelpCircle,
  Layers,
  RefreshCw,
  Upload,
  FileDown,
} from "lucide-react";
import type { QuestionType } from "@shared/questions/question-type";
import { QuestionTypeIcon } from "@/features/tests/editor/sections/question-type-icon";
import { FoldAllButtons, useSectionFold } from "@/features/tests/editor/sections/section-fold";

// ============================================
// Интерфейсы
// ============================================

/**
 * Прохождение, разбор которого открыт в окне деталей.
 *
 * Это НЕ строка реестра: реестр говорит, что прохождение было, а окно — что в нём произошло.
 * Строка приводится к этой форме при открытии (`handleOpenPassage`).
 */
interface CombinedAttempt {
  id: string;
  testId: string | null;
  testTitle: string;
  testMode?: string;
  userId?: string;
  username?: string;
  userEmail?: string | null;
  lmsUserId?: string | null;
  lmsUserName?: string | null;
  lmsUserEmail?: string | null;
  startedAt: string;
  finishedAt: string | null;
  duration?: number | null;
  resultPercent: number;
  resultPassed: boolean;
  totalPoints: number;
  maxPoints: number;
  source: "web" | "lms";
  isAdaptive?: boolean;
  achievedTopics?: number | null;
  totalTopics?: number | null;
}

// Детальный ответ
interface DetailedAnswer {
  questionId: string;
  questionPrompt: string;
  questionType: string;
  topicId: string;
  topicName: string;
  difficulty: number;
  userAnswer: any;
  correctAnswer: any;
  options?: string[]; // для single/multiple
  leftItems?: string[]; // для matching
  rightItems?: string[];
  items?: string[]; // для ranking
  isCorrect: boolean;
  /** PRD-44 FR-10 / PRD-26 FR-08: у измерительного ответа эталона нет, вердикт к нему
   *  неприменим — ни «верно», ни «неверно». Приходит с сервера. */
  measurementOnly?: boolean;
  earnedPoints: number;
  possiblePoints: number;
  levelName?: string;
  levelIndex?: number;
}

interface TopicResult {
  topicId: string;
  topicName: string;
  percent: number;
  passed: boolean | null;
  earnedPoints: number;
  possiblePoints: number;
}

interface AchievedLevel {
  topicId: string;
  topicName: string;
  levelIndex: number | null;
  levelName: string | null;
}

interface AttemptDetail {
  attemptId: string;
  userId?: string;
  username?: string;
  lmsUserId?: string;
  lmsUserName?: string;
  lmsUserEmail?: string;
  testId: string;
  testTitle: string;
  testMode: string;
  startedAt: string | null;
  finishedAt: string | null;
  duration: number | null;
  overallPercent: number;
  earnedPoints: number;
  possiblePoints: number;
  passed: boolean;
  answers: DetailedAnswer[];
  topicResults: TopicResult[];
  achievedLevels?: AchievedLevel[];
  trajectory?: { action: string; levelName: string; message: string }[];
  source: "web" | "lms";
}

interface ExportFilters {
  tests: { id: string; title: string; mode: string; hasWebAttempts: boolean; hasLmsAttempts: boolean }[];
  users: { id: string; username: string; source?: "web" | "lms"; email?: string }[];
  groups: { id: string; name: string; userCount: number; userIds: string[] }[];
  scormPackages?: { id: string; testId: string; testTitle: string }[];
}

interface ExportConfig {
  source: "all" | "web" | "lms";
  testIds: string[];
  userIds: string[];
  groupIds: string[];
  dateFrom: string;
  dateTo: string;
  testMode: "all" | "standard" | "adaptive";
  bestAttemptOnly: boolean;
  bestAttemptCriteria: "percent" | "level_sum" | "level_count";
  includeSheets: {
    summary: boolean;
    attempts: boolean;
    answers: boolean;
    questionStats: boolean;
    levelStats: boolean;
    recommendations: boolean;
  };
}

// ============================================
// Утилиты для форматирования ответов
// ============================================

/**
 * PRD-57 §6.5: написанный ответ печатается ДОСЛОВНО — разбирая спор, важно видеть, что
 * человек набрал `3,14`, а не то, во что мы это превратили при сравнении.
 */
export function formatUserAnswer(answer: DetailedAnswer): string {
  const { questionType, userAnswer } = answer;

  // Получаем данные вопроса из questionData
  const questionData = (answer as any).questionData || {};
  const options = questionData.options || (answer as any).options;
  const leftItems = questionData.left || (answer as any).leftItems;
  const rightItems = questionData.right || (answer as any).rightItems;
  const items = questionData.items || (answer as any).items;

  if (userAnswer === undefined || userAnswer === null) return "Нет ответа";
  // Текстовый ввод: строка и есть ответ, разбирать нечего.
  if (questionType === "short") return String(userAnswer);

  switch (questionType) {
    case "single":
    case "scale":
      if (typeof userAnswer === "number" && options) {
        return options[userAnswer] || `Вариант ${userAnswer + 1}`;
      }
      if (typeof userAnswer === "string" && options) {
        return userAnswer;
      }
      return String(userAnswer);

    // PRD-44: распределение баллов сервер отдаёт как «утверждение + балл» по КАЖДОМУ
    // утверждению, включая нулевые (ноль отличает «рассмотрел и не дал веса» от «не
    // дошёл»). Без этой ветки в окне печатался сырой JSON ответа.
    case "allocation":
      if (Array.isArray(userAnswer) && typeof userAnswer[0] === "object" && userAnswer[0] !== null) {
        return (userAnswer as Array<{ statement?: string; points?: number }>)
          .map(row => `${row.statement ?? "?"} — ${Number(row.points ?? 0)}`)
          .join("; ");
      }
      // Запасной разбор: сырое распределение «индекс → балл» вместе с подписями вопроса.
      if (typeof userAnswer === "object" && !Array.isArray(userAnswer) && options) {
        const assigned = userAnswer as Record<string, number>;
        return (options as string[])
          .map((label, i) => `${label} — ${Number(assigned[String(i)] ?? 0)}`)
          .join("; ");
      }
      return String(userAnswer);

    case "multiple":
      if (Array.isArray(userAnswer)) {
        // Подписи проверяются ПЕРВЫМИ: сервер отдаёт множественный ответ уже готовыми
        // строками вариантов (`formattedUserAnswer`), а `questionData` приходит рядом —
        // ветка по индексам брала `options["Нанимать молодых…"]`, получала `undefined` и
        // складывала строки в «Вариант Нанимать молодых…1».
        if (typeof userAnswer[0] === "string") {
          return userAnswer.join(", ");
        }
        if (options) {
          return userAnswer.map(i => options[i] || `Вариант ${i + 1}`).join(", ");
        }
        return userAnswer.join(", ");
      }
      return String(userAnswer);

    case "matching":
      if (typeof userAnswer === "object" && !Array.isArray(userAnswer) && leftItems && rightItems) {
        return Object.entries(userAnswer)
          .map(([left, right]) => `${leftItems[+left]} → ${rightItems[+(right as string)]}`)
          .join("; ");
      }
      // Если уже отформатирован
      if (Array.isArray(userAnswer)) {
        return userAnswer.map((p: any) => `${p.left} → ${p.right}`).join("; ");
      }
      return JSON.stringify(userAnswer);

    case "ranking":
      if (Array.isArray(userAnswer)) {
        if (items && typeof userAnswer[0] === "number") {
          return userAnswer.map((i, pos) => `${pos + 1}. ${items[i]}`).join("; ");
        }
        // Если уже отформатирован как массив строк
        if (typeof userAnswer[0] === "string") {
          return userAnswer.map((item, pos) => `${pos + 1}. ${item}`).join("; ");
        }
        return userAnswer.join(" → ");
      }
      return String(userAnswer);

    default:
      return typeof userAnswer === "object" ? JSON.stringify(userAnswer) : String(userAnswer);
  }
}

/**
 * Набор правил сравнения человеческой строкой (PRD-57 §6.1).
 *
 * Пустой набор даёт прочерк, а не пустую строку: блок «Правильный ответ» печатается только
 * при непустом значении, и пустая рамка читалась бы как потеря данных (FR-17).
 */
function formatAnswerRules(correctAnswer: unknown): string {
  const set = (correctAnswer ?? {}) as {
    unit?: string;
    rules?: Array<Record<string, unknown>>;
  };
  const rules = Array.isArray(set.rules) ? set.rules : [];
  if (rules.length === 0) return "—";

  const unit = typeof set.unit === "string" && set.unit.trim() !== "" ? ` ${set.unit.trim()}` : "";
  const parts = rules.map((rule) => {
    if (rule.kind === "number") {
      const tolerance = rule.tolerance as { unit?: string; value?: number } | undefined;
      const spread = tolerance
        ? ` ±${tolerance.value}${tolerance.unit === "pct" ? " %" : unit}`
        : unit;
      return `равно ${rule.value}${spread}`;
    }
    return String(rule.value ?? "");
  });
  return parts.join(", ");
}

/**
 * Эталон задания для АВТОРА.
 *
 * У короткого ответа эталон — набор правил (PRD-57 §6.1), и показывается он здесь именно
 * потому, что адресован автору: ему нужно видеть, что правило ловит. Участнику образец
 * правила не показывается нигде — `Федеральная служба по * надзору` объясняет ему наш
 * синтаксис вместо предмета.
 */
export function formatCorrectAnswer(answer: DetailedAnswer): string {
  const { questionType, correctAnswer } = answer;

  // Получаем данные вопроса из questionData
  const questionData = (answer as any).questionData || {};
  const options = questionData.options || (answer as any).options;
  const leftItems = questionData.left || (answer as any).leftItems;
  const rightItems = questionData.right || (answer as any).rightItems;
  const items = questionData.items || (answer as any).items;

  if (questionType === "short") return formatAnswerRules(correctAnswer);
  if (!correctAnswer) return "—";

  // Если correctAnswer уже отформатирован (массив строк или объекты с текстом)
  if (Array.isArray(correctAnswer)) {
    if (questionType === "multiple" && typeof correctAnswer[0] === "string") {
      return correctAnswer.join(", ");
    }
    if (questionType === "matching" && correctAnswer[0]?.left) {
      return correctAnswer.map((p: any) => `${p.left} → ${p.right}`).join("; ");
    }
    if (questionType === "ranking" && typeof correctAnswer[0] === "string") {
      return correctAnswer.map((item, pos) => `${pos + 1}. ${item}`).join("; ");
    }
  }

  switch (questionType) {
    case "single":
    case "scale":
      const idx = correctAnswer.correctIndex;
      if (typeof idx === "number" && options) {
        return options[idx] || `Вариант ${idx + 1}`;
      }
      // Если уже отформатирован как строка
      if (typeof correctAnswer === "string") {
        return correctAnswer;
      }
      return String(idx);

    case "multiple":
      const indices = correctAnswer.correctIndices;
      if (Array.isArray(indices) && options) {
        return indices.map(i => options[i] || `Вариант ${i + 1}`).join(", ");
      }
      return Array.isArray(indices) ? indices.join(", ") : String(indices);

    case "matching":
      const pairs = correctAnswer.pairs;
      if (Array.isArray(pairs) && leftItems && rightItems) {
        return pairs.map((p: any) => `${leftItems[p.left]} → ${rightItems[p.right]}`).join("; ");
      }
      return JSON.stringify(pairs);

    case "ranking":
      const order = correctAnswer.correctOrder;
      if (Array.isArray(order) && items) {
        return order.map((i, pos) => `${pos + 1}. ${items[i]}`).join("; ");
      }
      return Array.isArray(order) ? order.join(" → ") : String(order);

    default:
      return typeof correctAnswer === "object" ? JSON.stringify(correctAnswer) : String(correctAnswer);
  }
}

// ============================================
// Компонент фильтров

// ============================================
// Карточки статистики

// ============================================
// Таблица попыток

// ============================================
// Модальное окно деталей попытки (ПОЛНОЕ)
// ============================================

function AttemptDetailsDialog({
  attempt,
  open,
  onClose,
  onExport,
}: {
  attempt: CombinedAttempt | null;
  open: boolean;
  onClose: () => void;
  /** Выгрузить это прохождение отдельным файлом. */
  onExport?: (attempt: CombinedAttempt) => void;
}) {
  const { data: details, isLoading } = useQuery<AttemptDetail>({
    queryKey: ["/api/analytics/attempt-details", attempt?.id, attempt?.source],
    queryFn: async () => {
      if (!attempt) throw new Error("No attempt");
      const endpoint =
        attempt.source === "web"
          ? `/api/analytics/attempts/${attempt.id}`
          : `/api/analytics/scorm-attempts/${attempt.id}`;
      const response = await fetch(endpoint, { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      return { ...data, source: attempt.source };
    },
    enabled: open && !!attempt,
  });

  /**
   * Сворачивание карточек ответов. Разбор на два десятка вопросов — стена текста, в
   * которой нужный вопрос ищут прокруткой; свёрнутая карточка оставляет шапку (номер,
   * тема, тип, текст задания, балл и вердикт), и список читается одним экраном.
   *
   * Состояние живёт, пока окно открыто, и по умолчанию РАЗВЁРНУТО: автор пришёл читать
   * ответы, а не раскрывать их по одному, — свернуть все он просит одной кнопкой.
   */
  const fold = useSectionFold((details?.answers ?? []).map((a) => a.questionId));

  const formatDuration = (seconds: number | null) => {
    if (!seconds) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const emptyState = (message: string) => (
    <Box pad={8}>
      <Stack align="center" gap={3}>
        <HelpCircle size={48} color="var(--ou-fg-subtle)" />
        <Text tone="muted">{message}</Text>
      </Stack>
    </Box>
  );

  const overviewContent = details && (
    <Stack gap={6}>
        {/* Основная информация */}
        <Grid minItem="sm" gap={1}>
          <Card>
            <CardBody>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Пользователь</Text>
                <Text variant="body-m" weight="medium">{details.username || details.lmsUserName || "—"}</Text>
                {details.lmsUserEmail && <Text variant="body-xs" tone="muted">{details.lmsUserEmail}</Text>}
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Тест</Text>
                <Text variant="body-m" weight="medium">{details.testTitle}</Text>
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Время</Text>
                <Cluster gap={1}><Clock size={16} /><Text variant="body-m" weight="medium">{formatDuration(details.duration)}</Text></Cluster>
              </Stack>
            </CardBody>
          </Card>

          <Card>
            <CardBody>
              <Stack gap={1}>
                <Text variant="body-xs" tone="muted">Дата</Text>
                <Text variant="body-m" weight="medium">
                  {details.finishedAt ? new Date(details.finishedAt).toLocaleString("ru-RU") : "—"}
                </Text>
              </Stack>
            </CardBody>
          </Card>
        </Grid>

        {/* Результат */}
        <Card>
          <CardHeader title="Результат" />
          <CardBody>
            {details.testMode === "adaptive" ? (
              <Cluster gap={4}>
                <Tag tone="info"><CheckCircle />ЗАВЕРШЁН</Tag>
                <Text variant="body-s" tone="muted">Результаты по достигнутым уровням — см. ниже</Text>
              </Cluster>
            ) : (
              <Cluster gap={6}>
                <Stack gap={1} align="center">
                  <Text variant="display-m" weight="bold">{details.overallPercent?.toFixed(0)}%</Text>
                  <Text variant="body-s" tone="muted">{details.earnedPoints} / {details.possiblePoints} баллов</Text>
                </Stack>
                <Box grow>
                  <ProgressBar value={details.overallPercent} tone={details.passed ? "success" : "error"} size="m" hideHeader />
                </Box>
                {details.passed ? (
                  <Tag tone="success"><CheckCircle />СДАН</Tag>
                ) : (
                  <Tag tone="error" variant="solid"><XCircle />НЕ СДАН</Tag>
                )}
              </Cluster>
            )}
          </CardBody>
        </Card>

        {/* Достигнутые уровни (для адаптивных) */}
        {details.achievedLevels && details.achievedLevels.length > 0 && (
          <Card>
            <CardHeader title={<Cluster gap={2}><Layers size={16} />Достигнутые уровни</Cluster>} />
            <CardBody>
              <Stack gap={2}>
                {details.achievedLevels.map((level) => (
                  <Box key={level.topicId} pad={3} surface="muted" radius="l">
                    <Cluster justify="between">
                      <Text weight="medium">{level.topicName}</Text>
                      <Tag variant="outline">{level.levelName || `Уровень ${(level.levelIndex || 0) + 1}`}</Tag>
                    </Cluster>
                  </Box>
                ))}
              </Stack>
            </CardBody>
          </Card>
        )}

        {/*
          PRD-56 FR-23: траектория адаптивного прохождения. Переехала сюда со страницы теста
          вместе со снятым оттуда списком попыток: другого места, где видно, на каком шаге
          участник поднялся и где сорвался, в продукте нет.
        */}
        {details.trajectory && details.trajectory.length > 0 && (
          <Card>
            <CardHeader title="Траектория прохождения" />
            <CardBody>
              <Stack gap={2}>
                {details.trajectory.map((event, index) => (
                  <Cluster key={index} gap={2}>
                    {event.action === "level_up"
                      ? <CheckCircle size={16} color="var(--ou-success-600)" />
                      : <XCircle size={16} color="var(--ou-error-600)" />}
                    <Text variant="body-s">{event.message}</Text>
                  </Cluster>
                ))}
              </Stack>
            </CardBody>
          </Card>
        )}
    </Stack>
  );

  const answersContent = details && (
    <Stack gap={3}>
        {(details.answers?.length ?? 0) > 1 && (
          <div className="tb-fold-toolbar">
            <FoldAllButtons fold={fold} testIdPrefix="attempt-answers" />
          </div>
        )}
        {details.answers?.map((answer, index) => {
          const open = fold.isOpen(answer.questionId);
          /*
            Эталон печатается ТОЛЬКО там, где ответ неверен (согласованный эскиз
            `analytics-attempt-details.html`: «печатается при ratio < 1»). У верного
            ответа это буквальный повтор соседней ячейки — читать нечего, а разбор
            растёт вдвое. У измерительного вопроса эталона нет по природе (PRD-26/PRD-44).
          */
          const showCorrect = !answer.measurementOnly && !answer.isCorrect;
          return (
          <Card key={answer.questionId} variant="outlined">
            <CardBody>
              <Stack gap={3}>
                <Cluster justify="between" align="start" gap={4}>
                  {/*
                    Внутри кнопки только строчные элементы: Stack/Cluster — это `div`,
                    а блочное содержимое в `button` недопустимо, поэтому колонка шапки
                    собрана на `tb-ansfold__*`, как и сам примитив сворачивания.
                  */}
                  <button
                    type="button"
                    className="tb-fold-trigger tb-ansfold__head"
                    aria-expanded={open ? "true" : "false"}
                    aria-label={open ? `Свернуть вопрос ${index + 1}` : `Развернуть вопрос ${index + 1}`}
                    onClick={() => fold.toggle(answer.questionId)}
                    data-testid={`attempt-answer-toggle-${index + 1}`}
                  >
                    {open
                      ? <ChevronDown className="tb-fold-chev" width={16} height={16} aria-hidden="true" />
                      : <ChevronRight className="tb-fold-chev" width={16} height={16} aria-hidden="true" />}
                    <span className="tb-ansfold__title">
                      <span className="tb-ansfold__meta">
                        <Text variant="body-xs" weight="medium" tone="muted">#{index + 1}</Text>
                        {answer.topicName && <Tag size="s">{answer.topicName}</Tag>}
                        {answer.levelName && <Tag tone="accent" size="s">{answer.levelName}</Tag>}
                      </span>
                      {/*
                        Тип вопроса — пиктограмма перед текстом задания, та же, что в
                        «Оценке», «Вкладах вопросов» и дереве содержания. Тег печатал
                        сырое значение колонки (`multiple`, `single`) — по-английски и
                        мимо общей условности.
                      */}
                      <Text weight="medium">
                        <QuestionTypeIcon type={answer.questionType as QuestionType} />
                        {answer.questionPrompt}
                      </Text>
                    </span>
                  </button>
                  <Cluster gap={2}>
                    {answer.measurementOnly
                      ? <Tag size="s">Измерение</Tag>
                      : (
                        <>
                          <Text variant="body-s" weight="medium">{answer.earnedPoints}/{answer.possiblePoints}</Text>
                          {answer.isCorrect
                            ? <CheckCircle size={20} color="var(--ou-success-600)" />
                            : <XCircle size={20} color="var(--ou-error-600)" />}
                        </>
                      )}
                  </Cluster>
                </Cluster>

                {open && (
                  <>
                    <Separator />

                    <Grid minItem="md" gap={1}>
                      <Stack gap={1}>
                        <Text variant="body-xs" tone="muted">Ответ пользователя:</Text>
                        <Box pad={3} radius="l" surface="muted">
                          <Text variant="body-s" tone={answer.measurementOnly ? "default" : (answer.isCorrect ? "success" : "error")}>{formatUserAnswer(answer)}</Text>
                        </Box>
                      </Stack>
                      {showCorrect && (
                        <Stack gap={1}>
                          <Text variant="body-xs" tone="muted">Правильный ответ:</Text>
                          <Box pad={3} radius="l" surface="muted">
                            <Text variant="body-s">{formatCorrectAnswer(answer)}</Text>
                          </Box>
                        </Stack>
                      )}
                    </Grid>
                  </>
                )}
              </Stack>
            </CardBody>
          </Card>
          );
        })}

        {(!details.answers || details.answers.length === 0) && emptyState("Нет данных об ответах")}
    </Stack>
  );

  const topicsContent = details && (
    <Stack gap={3}>
        {details.testMode === "adaptive" ? (
          // Адаптивный — показываем достигнутые уровни
          details.achievedLevels && details.achievedLevels.length > 0 ? (
            details.achievedLevels.map((level) => (
              <Card key={level.topicId}>
                <CardBody>
                  <Cluster justify="between">
                    <Cluster gap={2}>
                      {level.levelName
                        ? <CheckCircle size={20} color="var(--ou-info-600)" />
                        : <XCircle size={20} color="var(--ou-error-600)" />}
                      <Text weight="medium">{level.topicName}</Text>
                    </Cluster>
                    <Tag tone={level.levelName ? "info" : "error"}>{level.levelName || "Не достигнут"}</Tag>
                  </Cluster>
                </CardBody>
              </Card>
            ))
          ) : emptyState("Нет данных по уровням")
        ) : (
          // Стандартный — показываем процент по темам
          details.topicResults?.length > 0 ? (
            details.topicResults.map((topic) => (
              <Card key={topic.topicId}>
                <CardBody>
                  <Stack gap={3}>
                    <Cluster justify="between">
                      <Stack gap={1}>
                        <Text weight="medium">{topic.topicName}</Text>
                        <Text variant="body-s" tone="muted">{topic.earnedPoints} / {topic.possiblePoints} баллов</Text>
                      </Stack>
                      <Cluster gap={3}>
                        <Text variant="display-s" weight="bold">{(topic.percent ?? 0).toFixed(0)}%</Text>
                        {topic.passed !== null && (
                          topic.passed
                            ? <CheckCircle size={24} color="var(--ou-success-600)" />
                            : <XCircle size={24} color="var(--ou-error-600)" />
                        )}
                      </Cluster>
                    </Cluster>
                    <ProgressBar
                      value={topic.percent ?? 0}
                      tone={topic.passed === null ? "accent" : topic.passed ? "success" : "error"}
                      size="s"
                      hideHeader
                    />
                  </Stack>
                </CardBody>
              </Card>
            ))
          ) : emptyState("Нет данных по темам")
        )}
    </Stack>
  );

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="xl"
      title={
        <Cluster gap={3}>
          Детали попытки
          {attempt?.source === "web"
            ? <Tag variant="outline" size="s"><Globe />Web</Tag>
            : <Tag size="s"><Server />LMS</Tag>}
          {details?.testMode === "adaptive" && <Tag tone="accent" size="s"><Layers />Адаптивный</Tag>}
        </Cluster>
      }
      footer={onExport && attempt && (
        <Button
          variant="secondary"
          size="s"
          leadingIcon={<FileDown size={16} />}
          onClick={() => onExport(attempt)}
        >
          Скачать детали
        </Button>
      )}
    >
      {isLoading ? (
        <Box pad={6}><LoadingState message="Загрузка деталей..." /></Box>
      ) : details ? (
        <Tabs
          defaultValue="overview"
          variant="segment"
          align="stretch"
          items={[
            { id: "overview", label: "Обзор", content: overviewContent },
            { id: "answers", label: `Ответы (${details.answers?.length || 0})`, content: answersContent },
            { id: "topics", label: "Темы", content: topicsContent },
          ]}
        />
      ) : (
        <Box pad={6}><Text align="center" tone="muted">Не удалось загрузить детали</Text></Box>
      )}
    </ModalDialog>
  );
}

// ============================================
// Секция статистики по темам

// ============================================
// Секция экспорта
// ============================================

function ExportSection() {
  const [isExporting, setIsExporting] = useState(false);

  const { data: filters, isLoading: filtersLoading } = useQuery<ExportFilters>({
    queryKey: ["/api/export/filters"],
  });

  const [config, setConfig] = useState<ExportConfig>({
    source: "all",
    testIds: [],
    userIds: [],
    groupIds: [],
    dateFrom: "",
    dateTo: "",
    testMode: "all",
    bestAttemptOnly: false,
    bestAttemptCriteria: "percent",
    includeSheets: {
      summary: true,
      attempts: true,
      answers: true,
      questionStats: true,
      levelStats: true,
      recommendations: true,
    },
  });

  const [testSearch, setTestSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");

  const handleTestToggle = (testId: string) => {
    setConfig(prev => ({
      ...prev,
      testIds: prev.testIds.includes(testId)
        ? prev.testIds.filter(id => id !== testId)
        : [...prev.testIds, testId],
    }));
  };

  const handleSelectAllTests = () => {
    if (!filters) return;
    let testsToSelect = filters.tests;
    if (config.testMode === "standard") testsToSelect = testsToSelect.filter(t => t.mode !== "adaptive");
    else if (config.testMode === "adaptive") testsToSelect = testsToSelect.filter(t => t.mode === "adaptive");
    if (testSearch) testsToSelect = testsToSelect.filter(t => t.title.toLowerCase().includes(testSearch.toLowerCase()));
    const allSelected = testsToSelect.every(t => config.testIds.includes(t.id));
    setConfig(prev => ({ ...prev, testIds: allSelected ? [] : testsToSelect.map(t => t.id) }));
  };

  const handleUserToggle = (userId: string) => {
    setConfig(prev => ({
      ...prev,
      userIds: prev.userIds.includes(userId) ? prev.userIds.filter(id => id !== userId) : [...prev.userIds, userId],
    }));
  };

  const handleSelectAllUsers = () => {
    if (!filters) return;
    let usersToSelect = filters.users;
    if (userSearch) usersToSelect = usersToSelect.filter(u => u.username.toLowerCase().includes(userSearch.toLowerCase()));
    const allSelected = usersToSelect.every(u => config.userIds.includes(u.id));
    setConfig(prev => ({ ...prev, userIds: allSelected ? [] : usersToSelect.map(u => u.id) }));
  };

  const handleGroupToggle = (groupId: string) => {
    setConfig(prev => {
      const newGroupIds = prev.groupIds.includes(groupId) ? prev.groupIds.filter(id => id !== groupId) : [...prev.groupIds, groupId];
      return { ...prev, groupIds: newGroupIds, userIds: [] };
    });
  };

  const handleSelectAllGroups = () => {
    if (!filters) return;
    let groupsToSelect = filters.groups;
    if (groupSearch) groupsToSelect = groupsToSelect.filter(g => g.name.toLowerCase().includes(groupSearch.toLowerCase()));
    const allSelected = groupsToSelect.every(g => config.groupIds.includes(g.id));
    setConfig(prev => ({ ...prev, groupIds: allSelected ? [] : groupsToSelect.map(g => g.id), userIds: [] }));
  };

  const downloadBlob = (blob: Blob, filename: string) => {
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleExport = async () => {
    if (config.testIds.length === 0) { alert("Выберите хотя бы один тест"); return; }
    setIsExporting(true);
    try {
      if (config.source === "lms") {
        const response = await fetch("/api/export/excel-lms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config), credentials: "include" });
        if (!response.ok) throw new Error("LMS export failed");
        downloadBlob(await response.blob(), `analytics_lms_${new Date().toISOString().split("T")[0]}.xlsx`);
      } else {
        const response = await fetch("/api/export/excel", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(config), credentials: "include" });
        if (!response.ok) throw new Error("Export failed");
        downloadBlob(await response.blob(), `analytics_${config.source}_${new Date().toISOString().split("T")[0]}.xlsx`);
      }
    } catch (error) {
      alert("Ошибка при создании отчёта");
    } finally {
      setIsExporting(false);
    }
  };

  const filteredTests = filters?.tests.filter(test => {
    if (config.source === "web" && !test.hasWebAttempts) return false;
    if (config.source === "lms" && !test.hasLmsAttempts) return false;
    if (config.testMode === "standard" && test.mode === "adaptive") return false;
    if (config.testMode === "adaptive" && test.mode !== "adaptive") return false;
    if (testSearch && !test.title.toLowerCase().includes(testSearch.toLowerCase())) return false;
    return true;
  }) || [];

  const groupUserIds = new Set<string>();
  if (config.groupIds.length > 0 && filters?.groups) {
    for (const groupId of config.groupIds) {
      const group = filters.groups.find(g => g.id === groupId);
      if (group) group.userIds.forEach(id => groupUserIds.add(id));
    }
  }

  const filteredUsers = filters?.users.filter(user => {
    if (config.source === "web" && user.source === "lms") return false;
    if (config.source === "lms" && user.source === "web") return false;
    if (config.source !== "lms" && config.groupIds.length > 0 && !groupUserIds.has(user.id)) return false;
    if (userSearch && !user.username.toLowerCase().includes(userSearch.toLowerCase())) return false;
    return true;
  }) || [];

  const filteredGroups = filters?.groups.filter(group => {
    if (groupSearch && !group.name.toLowerCase().includes(groupSearch.toLowerCase())) return false;
    return true;
  }) || [];

  const hasAdaptiveSelected = config.testIds.some(id => filters?.tests.find(t => t.id === id)?.mode === "adaptive");

  const sheetOptions: { key: keyof ExportConfig["includeSheets"]; label: string; adaptive?: boolean }[] = [
    { key: "summary", label: "Сводка" },
    { key: "attempts", label: "Попытки" },
    { key: "answers", label: "Ответы" },
    { key: "questionStats", label: "Статистика вопросов" },
    { key: "levelStats", label: "Статистика уровней", adaptive: true },
    { key: "recommendations", label: "Рекомендации", adaptive: true },
  ];

  return (
    <Card>
      <CardHeader title={<Cluster gap={2}><FileSpreadsheet size={20} />Экспорт отчёта</Cluster>} />
      <CardBody>
        {filtersLoading ? (
          <LoadingState message="Загрузка фильтров..." />
        ) : (
          <Stack gap={6}>
            <FormGroup columns="two">
              <Select<"all" | "web" | "lms">
                label="Источник данных"
                fullWidth
                value={config.source}
                onChange={(v) => setConfig(prev => ({ ...prev, source: v }))}
                options={[
                  { value: "all", label: "Все источники" },
                  { value: "web", label: "Только Web" },
                  { value: "lms", label: "Только LMS" },
                ]}
              />
              <Select<"all" | "standard" | "adaptive">
                label="Режим тестов"
                fullWidth
                value={config.testMode}
                onChange={(v) => setConfig(prev => ({ ...prev, testMode: v, testIds: [] }))}
                options={[
                  { value: "all", label: "Все тесты" },
                  { value: "standard", label: "Стандартные" },
                  { value: "adaptive", label: "Адаптивные" },
                ]}
              />
            </FormGroup>

            <Stack gap={2}>
              <Cluster justify="between">
                <Text variant="body-s" weight="medium">Тесты ({config.testIds.length} выбрано)</Text>
                <Button variant="ghost" size="s" onClick={handleSelectAllTests}>
                  {filteredTests.every(t => config.testIds.includes(t.id)) && filteredTests.length > 0 ? "Снять все" : "Выбрать все"}
                </Button>
              </Cluster>
              <Input placeholder="Поиск тестов..." value={testSearch} onChange={(e) => setTestSearch(e.target.value)} fullWidth />
              <Box border radius="l" pad={2}>
                <ScrollArea maxH="sm">
                  <Stack gap={1}>
                    {filteredTests.map((test) => (
                      <Cluster key={test.id} justify="between" gap={2}>
                        <Checkbox label={test.title} checked={config.testIds.includes(test.id)} onChange={() => handleTestToggle(test.id)} />
                        <Tag variant="outline" size="s">{test.mode === "adaptive" ? "Адапт." : "Станд."}</Tag>
                      </Cluster>
                    ))}
                    {filteredTests.length === 0 && <Text align="center" variant="body-s" tone="muted">Нет тестов</Text>}
                  </Stack>
                </ScrollArea>
              </Box>
            </Stack>

            <FormGroup columns="two">
              <Input label="Дата от" type="date" fullWidth value={config.dateFrom} onChange={(e) => setConfig(prev => ({ ...prev, dateFrom: e.target.value }))} />
              <Input label="Дата до" type="date" fullWidth value={config.dateTo} onChange={(e) => setConfig(prev => ({ ...prev, dateTo: e.target.value }))} />
            </FormGroup>

            {config.source !== "lms" && filters?.groups && filters.groups.length > 0 && (
              <Stack gap={2}>
                <Cluster justify="between">
                  <Text variant="body-s" weight="medium">Группы ({config.groupIds.length > 0 ? config.groupIds.length : "все"})</Text>
                  <Button variant="ghost" size="s" onClick={handleSelectAllGroups}>
                    {filteredGroups.every(g => config.groupIds.includes(g.id)) && filteredGroups.length > 0 ? "Снять все" : "Выбрать все"}
                  </Button>
                </Cluster>
                <Input placeholder="Поиск групп..." value={groupSearch} onChange={(e) => setGroupSearch(e.target.value)} fullWidth />
                <Box border radius="l" pad={2}>
                  <ScrollArea maxH="xs">
                    <Stack gap={1}>
                      {filteredGroups.map((group) => (
                        <Checkbox
                          key={group.id}
                          label={<>{group.name} <Text variant="body-xs" tone="muted">({group.userCount})</Text></>}
                          checked={config.groupIds.includes(group.id)}
                          onChange={() => handleGroupToggle(group.id)}
                        />
                      ))}
                    </Stack>
                  </ScrollArea>
                </Box>
              </Stack>
            )}

            <Stack gap={2}>
              <Cluster justify="between">
                <Text variant="body-s" weight="medium">Пользователи ({config.userIds.length > 0 ? config.userIds.length : "все"})</Text>
                <Button variant="ghost" size="s" onClick={handleSelectAllUsers}>
                  {filteredUsers.every(u => config.userIds.includes(u.id)) && filteredUsers.length > 0 ? "Снять всех" : "Выбрать всех"}
                </Button>
              </Cluster>
              <Input placeholder="Поиск пользователей..." value={userSearch} onChange={(e) => setUserSearch(e.target.value)} fullWidth />
              <Box border radius="l" pad={2}>
                <ScrollArea maxH="xs">
                  <Stack gap={1}>
                    {filteredUsers.map((user) => (
                      <Checkbox key={user.id} label={user.username} checked={config.userIds.includes(user.id)} onChange={() => handleUserToggle(user.id)} />
                    ))}
                    {filteredUsers.length === 0 && <Text align="center" variant="body-s" tone="muted">Нет пользователей</Text>}
                  </Stack>
                </ScrollArea>
              </Box>
            </Stack>

            <Box pad={4} surface="muted" radius="l">
              <Stack gap={3}>
                <Checkbox
                  label="Только лучшая попытка каждого пользователя"
                  checked={config.bestAttemptOnly}
                  onChange={(e) => setConfig(prev => ({ ...prev, bestAttemptOnly: e.target.checked }))}
                />
                {config.bestAttemptOnly && hasAdaptiveSelected && (
                  <Select<"percent" | "level_sum" | "level_count">
                    label="Критерий лучшей попытки (для адаптивных)"
                    fullWidth
                    value={config.bestAttemptCriteria}
                    onChange={(v) => setConfig(prev => ({ ...prev, bestAttemptCriteria: v }))}
                    options={[
                      { value: "percent", label: "По проценту" },
                      { value: "level_sum", label: "По сумме уровней" },
                      { value: "level_count", label: "По количеству уровней" },
                    ]}
                  />
                )}
              </Stack>
            </Box>

            <Stack gap={2}>
              <Text variant="body-s" weight="medium">Листы в отчёте</Text>
              <Grid minItem="sm" gap={3}>
                {sheetOptions.map(({ key, label, adaptive }) => (
                  <Checkbox
                    key={key}
                    label={<>{label}{adaptive && <Text variant="body-xs" tone="muted"> (адапт.)</Text>}</>}
                    checked={config.includeSheets[key]}
                    onChange={(e) => setConfig(prev => ({ ...prev, includeSheets: { ...prev.includeSheets, [key]: e.target.checked } }))}
                  />
                ))}
              </Grid>
            </Stack>

            <Button
              fullWidth
              onClick={handleExport}
              disabled={isExporting || config.testIds.length === 0}
              leadingIcon={isExporting ? undefined : <Download size={16} />}
              loading={isExporting}
            >
              {isExporting ? "Создание отчёта..." : "Создать отчёт"}
            </Button>
          </Stack>
        )}
      </CardBody>
    </Card>
  );
}

// ============================================
// Главный компонент
// ============================================

export default function AnalyticsPage() {
  const [selectedAttempt, setSelectedAttempt] = useState<CombinedAttempt | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  /** PRD-54: окно загрузки выгрузки отчёта LMS. */
  const [lmsImportOpen, setLmsImportOpen] = useState(false);
  /** PRD-56 FR-03: условия отбора реестра живут в адресе страницы. */
  const [registryFilter, setRegistryFilter] = useRegistryFilter();
  /** PRD-56 FR-04: окно выгрузки отфильтрованного — открывается из панели фильтра реестра. */
  const [exportOpen, setExportOpen] = useState(false);
  /** FR-24: переход «группа → тест» уводит со страницы, поэтому нужен переход маршрутизатора. */
  const [, setLocation] = useLocation();
  /**
   * Отбор, отправленный из реестра в сравнение (FR-07b).
   *
   * Держится состоянием страницы, а не адресом: это не выборка, а НАМЕРЕНИЕ сравнить —
   * пересылать его ссылкой незачем, а вкладка «Срезы» о нём должна узнать сразу.
   */
  const [compareWith, setCompareWith] = useState<RegistryFilter | null>(null);
  /**
   * Открытая вкладка. Держится состоянием, а не умолчанием, ради FR-08: переход из строки
   * среза открывает реестр и должен ПЕРЕКЛЮЧИТЬ экран, а не только подставить условия.
   */
  const [tab, setTab] = useState("attempts");

  // PRD-56 FR-12: combined-full и summary сняты вместе с «Обзором». Величины, которые они
  // считали — средний балл и pass rate ПО ВСЕМ тестам, тренды и проблемные темы вне контекста
  // теста, — неинтерпретируемы: смешивают разные пороги, шкалы и популяции. Их место заняли
  // срезы и очередь «требует внимания».

  const { data: tests } = useQuery<{ id: string; title: string }[]>({
    queryKey: ["/api/tests-list"],
    queryFn: async () => {
      const response = await fetch("/api/tests", { credentials: "include" });
      if (!response.ok) throw new Error("Failed to fetch");
      const data = await response.json();
      return data.map((t: any) => ({ id: t.id, title: t.title }));
    },
  });

  const handleViewDetails = (attempt: CombinedAttempt) => {
    setSelectedAttempt(attempt);
    setDetailsOpen(true);
  };

  const handleOpenPassage = (row: RegistryRow) => {
    handleViewDetails({
      id: row.id,
      testId: row.testId,
      testTitle: row.testTitle,
      userId: row.userId ?? undefined,
      username: row.participant,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      duration: row.durationMs === null ? null : Math.round(row.durationMs / 1000),
      // Ноль здесь — не оценка, а отсутствие числа: окно показывает прочерк по своим правилам.
      resultPercent: row.percent ?? 0,
      resultPassed: row.passed === true,
      totalPoints: 0,
      maxPoints: 0,
      source: row.source === "web" ? "web" : "lms",
    });
  };

  /**
   * FR-08: открыть реестр по условиям среза.
   *
   * Условия приходят от вкладки срезов уже вместе с рамкой расчёта — тестом и периодом:
   * у самого среза их нет, они общие для всей вкладки (FR-07e).
   */
  const handleOpenSliceInRegistry = (conditions: Record<string, unknown>) => {
    const list = (value: unknown): string[] =>
      Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    const text = (value: unknown): string | undefined =>
      typeof value === "string" && value ? value : undefined;

    setRegistryFilter({
      testIds: list(conditions.testIds),
      groupIds: list(conditions.groupIds),
      // Вариант и версия приезжают из срезов по этим осям: перевод условий больше не теряет
      // их, и реестр открывается ровно тем составом, что в строке среза (FR-08).
      formIds: list(conditions.formIds),
      snapshotIds: list(conditions.snapshotIds),
      sources: list(conditions.sources) as RegistryFilter["sources"],
      outcomes: list(conditions.outcomes) as RegistryFilter["outcomes"],
      ...(text(conditions.from) ? { from: text(conditions.from) } : {}),
      ...(text(conditions.to) ? { to: text(conditions.to) } : {}),
    });
    setTab("attempts");
  };

  /** FR-11: открыть разбор прохождения, из-за которого дело попало в очередь. */
  const handleOpenAttentionPassage = (row: AttentionRow) => {
    if (!row.observationId) return;
    handleViewDetails({
      id: row.observationId,
      testId: row.testId,
      testTitle: row.testTitle,
      userId: row.participantId ?? undefined,
      username: row.participant,
      startedAt: row.startedAt ?? "",
      finishedAt: null,
      duration: null,
      resultPercent: 0,
      resultPassed: false,
      totalPoints: 0,
      maxPoints: 0,
      source: row.source === "web" ? "web" : "lms",
    });
  };

  const handleExportAttempt = async (attempt: CombinedAttempt) => {
    try {
      const endpoint = attempt.source === "web"
        ? `/api/analytics/attempts/${attempt.id}`
        : `/api/analytics/scorm-attempts/${attempt.id}`;

      const res = await fetch(endpoint, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      const details = await res.json();

      const rows: any[][] = [
        ["Попытка", attempt.id],
        ["Пользователь", attempt.username || attempt.lmsUserName || "—"],
        ["Email", attempt.userEmail || attempt.lmsUserEmail || "—"],
        ["Тест", attempt.testTitle],
        ["Источник", attempt.source === "web" ? "Web" : "LMS"],
        ["Дата", attempt.finishedAt ? new Date(attempt.finishedAt).toLocaleString("ru-RU") : "—"],
        [],
      ];

      // Расчётная информация (баллы, вклады в шкалы) в выгрузке протокола.
      const round2 = (n: unknown) => (typeof n === "number" ? String(Math.round(n * 100) / 100) : "");
      const fmtContribs = (contribs: Array<{ scaleKey: string; delta: number }> | undefined) =>
        (contribs || []).map(c => `${c.scaleKey} ${c.delta >= 0 ? "+" : ""}${c.delta}`).join(" | ");
      const fmtVar = (v: unknown) =>
        typeof v === "boolean" ? (v ? "да" : "нет") : typeof v === "number" ? round2(v) : String(v ?? "");

      if (attempt.isAdaptive) {
        rows.push(["Режим", "Адаптивный"]);
        rows.push([]);
        rows.push(["Тема", "Достигнутый уровень"]);
        for (const level of details.achievedLevels || []) {
          rows.push([level.topicName, level.levelName || "Не достигнут"]);
        }
      } else {
        rows.push(["Результат", `${details.overallPercent?.toFixed(1)}%`]);
        rows.push(["Баллы", `${details.earnedPoints} / ${details.possiblePoints}`]);
        rows.push(["Статус", details.passed ? "Сдан" : "Не сдан"]);
        rows.push([]);
        rows.push(["Вопрос", "Тема", "Тип", "Ответ", "Правильный", "Результат", "Баллы", "Сложность", "Доля", "Вклады в шкалы"]);
        for (const ans of details.answers || []) {
          rows.push([
            ans.questionPrompt,
            ans.topicName,
            ans.questionType,
            JSON.stringify(ans.userAnswer),
            JSON.stringify(ans.correctAnswer),
            ans.isCorrect ? "Верно" : "Неверно",
            `${ans.earnedPoints}/${ans.possiblePoints}`,
            ans.difficulty ?? "",
            typeof ans.ratio === "number" ? `${Math.round(ans.ratio * 100)}%` : "",
            fmtContribs(ans.contribs),
          ]);
        }
      }

      // Итоги по шкалам (PRD-5) — абсолютное значение (raw) + интерпретационный
      // уровень (bands). Процент не выгружаем: это вспомогательное значение для
      // формул показателей, а не результат шкалы.
      const scaleEntries = Object.entries(details.scaleResults || {}) as Array<[string, {
        raw?: number; level?: string; label?: string; hasValue?: boolean;
      }]>;
      if (scaleEntries.length) {
        rows.push([]);
        rows.push(["Шкалы"]);
        rows.push(["Шкала", "Значение", "Уровень"]);
        for (const [key, sc] of scaleEntries) {
          rows.push([
            key,
            sc.hasValue ? round2(sc.raw) : "",
            sc.label || sc.level || "",
          ]);
        }
      }

      // Показатели (PRD-2, result variables).
      const varEntries = Object.entries(details.resultVariables || {});
      if (varEntries.length) {
        rows.push([]);
        rows.push(["Показатели"]);
        rows.push(["Показатель", "Значение"]);
        for (const [name, val] of varEntries) {
          rows.push([name, fmtVar(val)]);
        }
      }

      // Создаём xlsx через динамический импорт не нужен — используем CSV
      const csv = rows.map(r => r.map(c => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
      const bom = "﻿";
      const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const userName = (attempt.username || attempt.lmsUserName || "user").replace(/[^a-zA-Zа-яА-Я0-9]/g, "_");
      a.download = `attempt_${userName}_${new Date().toISOString().split("T")[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch {
      alert("Не удалось скачать данные попытки");
    }
  };


  return (
    <Stack gap={6}>
      {/* Заголовок */}
      <Cluster justify="between">
        <Stack gap={1}>
          <Text as="h1" variant="display-s" weight="semibold">Аналитика</Text>
          <Text tone="muted">Прохождения, срезы и дела, по которым нужно действие</Text>
        </Stack>
        {/* Кнопки одного ряда — родственные элементы, интервал 1x модульной сетки. */}
        <Cluster gap={1}>
          {/* PRD-54: вторая точка входа. Теста в контексте нет — он берётся из самого файла. */}
          <Button variant="secondary" size="s" leadingIcon={<Upload size={16} />} onClick={() => setLmsImportOpen(true)}>
            Загрузить выгрузку LMS
          </Button>
          <Button variant="secondary" size="s" leadingIcon={<RefreshCw size={16} />} onClick={() => window.location.reload()}>
            Обновить
          </Button>
        </Cluster>
      </Cluster>

      <ModalDialog
        open={lmsImportOpen}
        onClose={() => setLmsImportOpen(false)}
        title="Загрузка выгрузки LMS"
        description="Тест определяется по самому файлу"
      >
        <LmsImportForm onDone={() => window.location.reload()} />
      </ModalDialog>

      {/* Табы */}
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          {
            id: "attempts",
            label: "Прохождения",
            content: (
              /*
                PRD-56 FR-01 - FR-04: один список на все источники. Своя панель фильтров,
                постраничность и сортировка в памяти сняты: условия отбора живут в адресе,
                порции приходят с сервера, состав строк книги задаёт тот же фильтр. Карточку
                со счётом прохождений рисует сам реестр — число знает он.
              */
              <PassageRegistry
                filter={registryFilter}
                onFilterChange={setRegistryFilter}
                onOpenPassage={handleOpenPassage}
                // FR-04: выгрузка живёт там же, где фильтр, и берёт его условия. Отдельного
                // набора галочек для состава строк книги в продукте быть не должно — два
                // описания одной выборки однажды разойдутся, и книга перестанет отвечать
                // экрану (эскиз prd56-analytics-section.html, состояние reg-export).
                actions={(
                  <>
                    {/* FR-07b: сравнить набранный отбор со срезом можно НЕ СОХРАНЯЯ его —
                        сохранение нужно, когда срезом будут пользоваться и завтра, а вопрос
                        «чем эти хуже тех» живёт одну минуту. */}
                    <Button
                      variant="secondary"
                      size="s"
                      disabled={countConditions(registryFilter) === 0}
                      onClick={() => {
                        setCompareWith(registryFilter);
                        setTab("slices");
                      }}
                    >
                      Сравнить со срезом
                    </Button>
                    <Button variant="secondary" size="s" onClick={() => setExportOpen(true)}>
                      Экспорт
                    </Button>
                  </>
                )}
              />
            ),
          },
          {
            id: "slices",
            label: "Срезы",
            content: (
              <SlicesTab
                tests={tests ?? []}
                // Условия уходят в сравнение БЕЗ теста: он там рамка расчёта, а не условие
                // отбора (FR-07e), и приезжает отдельным полем.
                adhoc={compareWith
                  ? {
                    groupIds: compareWith.groupIds,
                    sources: compareWith.sources,
                    outcomes: compareWith.outcomes,
                    ...(compareWith.from ? { from: compareWith.from } : {}),
                    ...(compareWith.to ? { to: compareWith.to } : {}),
                  }
                  : null}
                adhocTestId={compareWith?.testIds[0] ?? null}
                onOpenRegistry={handleOpenSliceInRegistry}
                // FR-24, переход «группа → тест»: условия среза едут в адрес аналитики теста,
                // где их читает тот же разбор, что у реестра. Тест в условия не входит — он
                // задан адресом страницы.
                onOpenTestAnalytics={(openTestId, conditions) => {
                  const search = filterToSearch({
                    ...EMPTY_FILTER,
                    ...conditionsToFilter(conditions),
                    testIds: [],
                  });
                  setLocation(`/author/tests/${openTestId}/analytics${search}`);
                }}
              />
            ),
          },
          {
            id: "attention",
            label: "Требует внимания",
            content: (
              <AttentionQueue
                onOpenPassage={handleOpenAttentionPassage}
                onOpenRegistry={handleOpenSliceInRegistry}
              />
            ),
          },
          {
            id: "export",
            label: "Экспорт",
            content: <ExportSection />,
          },
        ]}
      />

      <ExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        filter={registryFilter}
      />

      {/* Модальное окно деталей */}
      <AttemptDetailsDialog
        attempt={selectedAttempt}
        open={detailsOpen}
        onClose={() => setDetailsOpen(false)}
        onExport={handleExportAttempt}
      />
    </Stack>
  );
}
