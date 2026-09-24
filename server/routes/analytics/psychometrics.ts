/**
 * @module server/routes/analytics/psychometrics
 * @description PRD-66 FR-56 - FR-58: психометрика теста одной ручкой.
 *
 * Расширение `/api/analytics`, а не свой раздел API: психометрика — взгляд на те же
 * прохождения, что и остальная аналитика, и отдельный домен развёл бы их права и выборки.
 *
 * Права — ТЕ ЖЕ, что на аналитику теста (FR-58): `analytics.read` плюс область видимости.
 * Отдельного права не заводится — психометрика не раскрывает ничего сверх того, что уже
 * показывает страница теста, а второе право означало бы, что один и тот же читатель видит
 * трудность задания на одной вкладке и не видит на другой.
 *
 * Расчёт по требованию с кэшированием (FR-57): материализованной таблицы метрик нет, потому
 * что любое её состояние немедленно устаревает — выборка задаётся фильтром, а фильтр у каждого
 * читателя свой.
 */
import { Router, type Request, type Response } from "express";
import ExcelJS from "exceljs";

import { config } from "../../config";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { requireTestScope } from "../../middleware/test-scope";
import { storage } from "../../storage";
import { outcomeFor } from "../../services/analytics/answer-outcome";
import { loadResponseMatrix } from "../../services/analytics/response-matrix";
import {
  computeItemBreakdown,
  computePsychometrics,
  firstAttemptOnly,
  type PsychometricsContext,
  type QuestionInfo,
} from "../../services/analytics/psychometrics";
import {
  itemsSheet,
  matrixSheet,
  testSheet,
  type ExportContext,
} from "../../services/analytics/psychometrics-export";
import { loadTestScoringContext } from "../../services/effective-scoring";
import { addAoaSheet, workbookToBuffer } from "../../utils/excel";
import type { ObservationFilter, ObservationSource } from "../../services/analytics/observations";
import { analyticsScope } from "./helpers";

const router = Router();

const SOURCES: ObservationSource[] = ["web", "telemetry", "import"];

/** Значения параметра, повторённого несколько раз или перечисленного через запятую. */
function listOf(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw.flatMap(item => String(item).split(",")).map(item => item.trim()).filter(Boolean);
}

/** Дата из параметра; конец периода — конец ДНЯ, как и в реестре. */
function dateOf(value: unknown, edge: "start" | "end"): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Кэш расчёта (FR-57).
 *
 * Ключ включает ВСЁ, что меняет числа: тест, версию его содержания, состав учитываемых партий
 * импорта, условия отбора и режим попыток. Партии в ключе не для полноты: снятие партии с
 * учёта меняет выборку, не трогая ни теста, ни его содержания, — без них экран показывал бы
 * прежние числа после переключения и выглядел сломанным.
 *
 * Время жизни короткое намеренно: расчёт идёт по требованию, а кэш здесь спасает от повторного
 * счёта при перелистывании вкладок, а не хранит историю.
 */
const CACHE_TTL_MS = 60_000;
const cache = new Map<string, { at: number; value: unknown }>();

/**
 * Сбросить кэш — целиком либо по одному тесту.
 *
 * Нужен не тестам, а продукту: снятие партии импорта с учёта меняет выборку СЕЙЧАС, и минута
 * жизни кэша означала бы минуту, в которую экран показывает прежние числа после переключения
 * и выглядит сломанным. Ключ хранит тест первым полем, поэтому сброс по тесту — это отбор по
 * префиксу, а не обход всей карты.
 *
 * @param testId тест, расчёты которого устарели; без него сбрасывается всё
 */
export function resetPsychometricsCache(testId?: string): void {
  if (!testId) {
    cache.clear();
    return;
  }
  const prefix = `{"testId":${JSON.stringify(testId)}`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return Promise.resolve(hit.value as T);
  return compute().then(value => {
    cache.set(key, { at: Date.now(), value });
    // Кэш живёт в памяти процесса и обязан оставаться маленьким: ключей столько, сколько
    // сочетаний фильтра, и без уборки устаревшие копятся до перезапуска.
    if (cache.size > 200) {
      for (const [existing, entry] of cache) {
        if (Date.now() - entry.at >= CACHE_TTL_MS) cache.delete(existing);
      }
    }
    return value;
  });
}

/** Оценка ответа веб-попытки — та же цепочка, что у вкладки «Вопросы». */
async function buildGrader(testId: string): Promise<{
  grade: Parameters<typeof loadResponseMatrix>[2];
  questionById: Map<string, QuestionInfo>;
}> {
  const sections = await storage.getTestSections(testId);
  const topicIds = [...new Set(sections.map(s => s.topicId))];
  const questionLists = await Promise.all(topicIds.map(id => storage.getQuestionsByTopic(id)));
  const questions = questionLists.flat();
  const scoring = await loadTestScoringContext(testId, storage);

  const byId = new Map(questions.map(q => [q.id, q]));
  const infoById = new Map<string, QuestionInfo>(
    questions.map(q => [q.id, {
      id: q.id,
      type: q.type,
      prompt: q.prompt,
      dataJson: q.dataJson,
      difficulty: q.difficulty ?? null,
    }]),
  );

  return {
    questionById: infoById,
    grade: (questionId, answer, attemptResult) => {
      const question = byId.get(questionId);
      // Задания в тесте больше нет — оценивать нечем, и выдумывать исход не из чего.
      if (!question) return null;
      const outcome = outcomeFor(attemptResult, questionId, question, answer, scoring.resolve(question));
      if (outcome === null) return null;
      return {
        result: outcome.result,
        earnedPoints: outcome.result === "neutral" ? null : outcome.earned,
        possiblePoints: outcome.result === "neutral" ? null : outcome.possible,
      };
    },
  };
}

/**
 * Условия выборки из адреса — ОДИН разбор на все ручки психометрики.
 *
 * Экран, отчёт и матрица обязаны отбирать одинаково (FR-54b): выгрузка, собранная по другим
 * условиям, чем показанные на экране, невоспроизводима и неоспорима.
 */
function readQuery(req: Request, testId: string): { filter: ObservationFilter; onlyFirst: boolean } {
  const sources = listOf(req.query.source).filter((s): s is ObservationSource =>
    (SOURCES as string[]).includes(s));
  const groupIds = listOf(req.query.groupId);
  const formIds = listOf(req.query.formId);
  const snapshotIds = listOf(req.query.snapshotId);
  const from = dateOf(req.query.from, "start");
  const to = dateOf(req.query.to, "end");
  // Умолчание — «только первая попытка» (FR-51): повторные попытки одного человека не
  // независимы, и выключает это читатель осознанно, с предупреждением на экране.
  const onlyFirst = String(req.query.firstAttemptOnly ?? "true").toLowerCase() !== "false";

  return {
    onlyFirst,
    filter: {
      testIds: [testId],
      ...(groupIds.length ? { groupIds } : {}),
      ...(formIds.length ? { formIds } : {}),
      ...(snapshotIds.length ? { snapshotIds } : {}),
      ...(sources.length ? { sources } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    },
  };
}

/** Проходной балл теста в долях; `null` — тест ничего не объявляет. */
function cutRatioOf(rule: unknown): number | null {
  const parsed = rule as { type?: string; value?: number } | null;
  if (!parsed || parsed.type !== "percent" || typeof parsed.value !== "number") return null;
  return parsed.value / 100;
}

// GET /api/analytics/psychometrics/:testId — качество заданий и надёжность теста
router.get(
  "/psychometrics/:testId",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Тест не найден" });

      const { filter, onlyFirst } = readQuery(req, testId);

      // Состав учитываемых партий — часть ключа: снятие партии с учёта меняет выборку, не
      // трогая ни теста, ни его содержания.
      const batches = await storage.getLmsImportBatches(testId);
      const countedBatches = batches.filter(b => b.counted).map(b => b.id).sort().join(",");
      const key = JSON.stringify({
        testId,
        version: test.version ?? 1,
        countedBatches,
        filter: { ...filter, from: filter.from?.toISOString(), to: filter.to?.toISOString() },
        onlyFirst,
      });

      const result = await cached(key, async () => {
        const scope = await analyticsScope(req);
        const { grade, questionById } = await buildGrader(testId);
        const matrix = await loadResponseMatrix(filter, scope, grade);
        const responses = onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses;

        const ctx: PsychometricsContext = {
          questionById,
          minObservations: config.analytics.minObservations,
          cutRatio: cutRatioOf(test.overallPassRuleJson),
        };
        return {
          ...computePsychometrics(responses, ctx),
          observations: matrix.observations.length,
          firstAttemptOnly: onlyFirst,
        };
      });

      res.json(result);
    } catch (error) {
      logger.error("Psychometrics error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось посчитать психометрику" });
    }
  },
);

/** Индексы верных вариантов задания по его эталону. */
function correctIndexesOf(correctJson: unknown): number[] {
  const key = correctJson as { correctIndex?: unknown; correctIndices?: unknown } | null;
  if (typeof key?.correctIndex === "number") return [key.correctIndex];
  if (Array.isArray(key?.correctIndices)) {
    return key.correctIndices.filter((i): i is number => typeof i === "number");
  }
  return [];
}

// GET /api/analytics/psychometrics/:testId/items/:questionId — разбор одного задания
router.get(
  "/psychometrics/:testId/items/:questionId",
  requirePermission("analytics.read"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const { testId, questionId } = req.params;
      const test = await storage.getTest(testId);
      if (!test) return res.status(404).json({ error: "Тест не найден" });

      const { filter, onlyFirst } = readQuery(req, testId);
      const scope = await analyticsScope(req);
      const { grade, questionById } = await buildGrader(testId);
      const matrix = await loadResponseMatrix(filter, scope, grade);
      const responses = onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses;

      const [question] = await storage.getQuestionsByIds([questionId]);
      const breakdown = computeItemBreakdown(
        responses,
        {
          questionById,
          minObservations: config.analytics.minObservations,
          cutRatio: cutRatioOf(test.overallPassRuleJson),
        },
        questionId,
        correctIndexesOf(question?.correctJson),
      );
      // Наблюдений за заданием нет вовсе — это не ошибка запроса, а пустая выборка: задание
      // могли добавить вчера, и разбирать в нём пока нечего.
      if (!breakdown) return res.json({ breakdown: null, questionId });

      res.json({
        ...breakdown,
        questionId,
        prompt: question?.prompt ?? questionById.get(questionId)?.prompt ?? "",
        questionType: question?.type ?? questionById.get(questionId)?.type ?? "",
      });
    } catch (error) {
      logger.error("Psychometrics item error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось посчитать разбор задания" });
    }
  },
);

/**
 * Собрать всё, что нужно выгрузке: наблюдения, расчёт и справочник текстов.
 *
 * Выгрузка берёт выборку ТЕМИ ЖЕ условиями, что экран (FR-54b): иначе файл невозможно ни
 * повторить, ни сверить с тем, что человек видел, когда его заказывал.
 */
async function collectForExport(req: Request, testId: string) {
  const { filter, onlyFirst } = readQuery(req, testId);
  const scope = await analyticsScope(req);
  const { grade, questionById } = await buildGrader(testId);
  const matrix = await loadResponseMatrix(filter, scope, grade);
  const responses = onlyFirst ? firstAttemptOnly(matrix.responses) : matrix.responses;
  const test = await storage.getTest(testId);

  const ctx: ExportContext = {
    testTitle: test?.title ?? testId,
    conditions: describeFilter(filter),
    firstAttemptOnly: onlyFirst,
    generatedAt: new Date(),
  };
  const psychometrics = computePsychometrics(responses, {
    questionById,
    minObservations: config.analytics.minObservations,
    cutRatio: cutRatioOf(test?.overallPassRuleJson),
  });

  return { ctx, psychometrics, responses, questionById };
}

/** Условия отбора словами — то же, что подписано на экране. */
function describeFilter(filter: ObservationFilter): string {
  const parts: string[] = [];
  if (filter.groupIds?.length) parts.push(`группы: ${filter.groupIds.length}`);
  if (filter.sources?.length) parts.push(`источники: ${filter.sources.join(", ")}`);
  if (filter.formIds?.length) parts.push(`варианты: ${filter.formIds.length}`);
  if (filter.snapshotIds?.length) parts.push(`версии публикации: ${filter.snapshotIds.length}`);
  if (filter.from) parts.push(`с ${filter.from.toISOString().slice(0, 10)}`);
  if (filter.to) parts.push(`по ${filter.to.toISOString().slice(0, 10)}`);
  return parts.join("; ");
}

/** Отдать книгу файлом. */
async function sendWorkbook(res: Response, workbook: ExcelJS.Workbook, name: string): Promise<void> {
  const buffer = await workbookToBuffer(workbook);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(name)}"`);
  res.send(buffer);
}

/** Имя файла: тест и дата, без символов, которые ломают выгрузку на чужой машине. */
function fileName(prefix: string, title: string): string {
  const safe = title.replace(/[^a-zA-Zа-яА-Я0-9]/g, "_");
  return `${prefix}_${safe}_${new Date().toISOString().slice(0, 10)}.xlsx`;
}

// GET /api/analytics/psychometrics/:testId/export — психометрический отчёт (FR-53)
router.get(
  "/psychometrics/:testId/export",
  // Отдельное право на выгрузку — как и у всякого файла, который уносят из системы.
  requirePermission("analytics.export"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const { ctx, psychometrics, questionById } = await collectForExport(req, testId);

      const prompts = new Map([...questionById].map(([id, info]) => [id, info.prompt]));
      const workbook = new ExcelJS.Workbook();
      addAoaSheet(workbook, "Задания", itemsSheet(ctx, psychometrics, prompts), [38, 60, 12, 12, 16, 16, 16, 14, 14, 16, 18, 40]);
      addAoaSheet(workbook, "Тест", testSheet(ctx, psychometrics), [34, 22, 60]);

      await sendWorkbook(res, workbook, fileName("psychometrics", ctx.testTitle));
    } catch (error) {
      logger.error("Psychometrics export error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось выгрузить психометрический отчёт" });
    }
  },
);

// GET /api/analytics/psychometrics/:testId/matrix — матрица ответов «участники × задания» (FR-54)
router.get(
  "/psychometrics/:testId/matrix",
  requirePermission("analytics.export"),
  requireTestScope("analytics", "testId"),
  async (req: Request, res: Response) => {
    try {
      const testId = req.params.testId;
      const { ctx, psychometrics, responses } = await collectForExport(req, testId);

      const workbook = new ExcelJS.Workbook();
      addAoaSheet(workbook, "Матрица ответов", matrixSheet(ctx, responses, psychometrics.sample));

      await sendWorkbook(res, workbook, fileName("response_matrix", ctx.testTitle));
    } catch (error) {
      logger.error("Psychometrics matrix error: " + (error as Error).message, "analytics");
      res.status(500).json({ error: "Не удалось выгрузить матрицу ответов" });
    }
  },
);

export default router;
