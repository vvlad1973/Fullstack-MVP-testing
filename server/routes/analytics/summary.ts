/**
 * @module server/routes/analytics/summary
 * @description Сводка по прохождениям в рамке одного отбора.
 *
 * Здесь же раньше жили `GET /combined` и `GET /combined-full` — источник «Обзора» с его средним
 * баллом и pass rate ПО ВСЕМ тестам, трендами и проблемными темами вне контекста теста. PRD-56
 * FR-12 снял их: такие величины складывают разные пороги, разные шкалы и разные популяции, и
 * получившееся число нельзя ни объяснить, ни применить. Их место заняли срезы (`slices.ts`) и
 * очередь дел (`attention.ts`) — те всегда называют выборку, которую описывают.
 *
 * Уцелевшая сводка считается по общему слою наблюдений, как и страница теста: расхождение чисел
 * между экранами — дефект, а не особенность (FR-25).
 */
import { Router, Request, Response } from "express";
import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { loadObservations } from "../../services/analytics/observations";
import { summariseObservations } from "../../services/analytics/test-summary";
import { analyticsScope } from "./helpers";

const router = Router();

// GET /api/analytics/summary - Только сводка (быстрый запрос)
router.get("/summary", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const source = (req.query.source as string) || "all";
    const testIdFilter = req.query.testId as string | undefined;
    // PRD-15 FR-08 (audit F-5): aggregates only over readable tests.
    const scope = await analyticsScope(req);

    // PRD-56 FR-33: сводка считается по общему слою наблюдений — тому же, по которому
    // считает страница теста. Иначе два экрана снова начинают отвечать на один вопрос
    // разными числами (FR-25).
    const { rows } = await loadObservations(
      {
        ...(testIdFilter ? { testIds: [testIdFilter] } : {}),
        ...(source === "web" ? { sources: ["web"] as const } : {}),
        ...(source === "lms" ? { sources: ["telemetry", "import"] as const } : {}),
      },
      scope,
    );

    // Брошенные прохождения в сводку не входят: она отвечает на «как прошли», а не «сколько
    // начинали». Это же правило действовало и до перехода на общий слой.
    const completed = rows.filter(o => o.outcome !== "incomplete");
    const stats = summariseObservations(completed);
    const web = completed.filter(o => o.source === "web");
    const lms = completed.filter(o => o.source !== "web");

    /** Участники источника: человек, псевдоним импорта или идентификатор из LMS (PRD-54). */
    const participantsOf = (list: typeof completed) =>
      new Set(list.map(o => o.participantId).filter(Boolean)).size;

    res.json({
      totalAttempts: stats.completedAttempts,
      passedAttempts: completed.filter(o => o.passed === true).length,
      passRate: stats.passRate ?? 0,
      avgPercent: stats.avgPercent ?? 0,
      webAttempts: web.length,
      lmsAttempts: lms.length,
      uniqueWebUsers: participantsOf(web),
      uniqueLmsUsers: participantsOf(lms),
      adaptiveAttempts: stats.adaptiveAttempts,
      adaptivePassed: stats.adaptivePassed,
    });
  } catch (error) {
    logger.error("Summary analytics error: " + (error as Error).message, "analytics");
    res.status(500).json({ error: "Failed to get summary" });
  }
});

export default router;
