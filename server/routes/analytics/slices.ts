/**
 * @module server/routes/analytics/slices
 * @description PRD-56 FR-06, FR-07: срезы прохождений.
 *
 * Срез хранит УСЛОВИЯ и пересчитывается при каждом открытии (FR-07d), поэтому ручка никогда не
 * отдаёт сохранённые числа: она считает их здесь и сейчас по наблюдениям.
 *
 * Над срезами стоит рамка расчёта — тест и период (FR-07i). Тест обязателен: средние законны
 * только внутри одного теста, у разных тестов разные пороги и шкалы (решение 2 спеки). Период
 * необязателен — пустой означает «за всё время» (FR-07j).
 */
import { Router, type Request, type Response } from "express";

import { config } from "../../config";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { storage } from "../../storage";
import {
  loadObservations,
  type ObservationFilter,
  type ObservationOutcome,
  type ObservationSource,
} from "../../services/analytics/observations";
import { summariseSlice } from "../../services/analytics/slice-stats";
import { analyticsScope } from "./helpers";

const router = Router();

/** Дата из параметра; конец периода — конец дня, «по 30 сентября» включает этот день. */
function dateOf(value: unknown, edge: "start" | "end"): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/** Условия среза, приведённые к отбору наблюдений. */
function conditionsOf(raw: unknown): ObservationFilter {
  const source = (raw ?? {}) as Record<string, unknown>;
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  return {
    ...(list(source.groupIds).length ? { groupIds: list(source.groupIds) } : {}),
    ...(list(source.sources).length ? { sources: list(source.sources) as ObservationSource[] } : {}),
    ...(list(source.outcomes).length ? { outcomes: list(source.outcomes) as ObservationOutcome[] } : {}),
  };
}

// GET /api/analytics/slices — сохранённые срезы с посчитанными величинами
router.get("/slices", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const testId = typeof req.query.testId === "string" ? req.query.testId.trim() : "";
    if (!testId) {
      // Не «посчитаем по всем тестам»: среднее поверх разных порогов и шкал — то самое
      // неинтерпретируемое число, ради снятия которого затеян PRD-56.
      return res.status(400).json({ error: "Нужен тест: средние считаются внутри одного теста" });
    }

    const scope = await analyticsScope(req);
    const ownerId = req.currentUser?.id ?? "";
    const from = dateOf(req.query.from, "start");
    const to = dateOf(req.query.to, "end");
    const minObservations = config.analytics.minObservations;

    const saved = await storage.getSlices(ownerId);

    const slices = await Promise.all(saved.map(async slice => {
      // Тест рамки перебивает тест среза (FR-07e): он общий для всех сравниваемых срезов и в
      // их собственные условия не входит.
      const { rows } = await loadObservations(
        {
          ...conditionsOf(slice.conditionsJson),
          testIds: [testId],
          ...(from ? { from } : {}),
          ...(to ? { to } : {}),
        },
        scope,
      );

      return {
        id: slice.id,
        name: slice.name,
        conditions: slice.conditionsJson,
        ...summariseSlice({ observations: rows, minObservations }),
      };
    }));

    res.json({ slices, minObservations });
  } catch (error) {
    logger.error("Slices analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to load slices" });
  }
});

export default router;
