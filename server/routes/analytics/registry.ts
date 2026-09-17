/**
 * @module server/routes/analytics/registry
 * @description PRD-56 FR-01 - FR-05: реестр прохождений — рабочее место оценщика.
 *
 * Один плоский список на все источники: веб, телеметрия и импортированные выгрузки. Экран
 * сканируют глазами по колонкам, сортируют и догружают прокруткой, поэтому ручка отдаёт порцию
 * И общее число: «показано 25 из 128» в подвале таблицы — два разных факта, второй из первого
 * не выводится.
 *
 * Ни одного собственного правила расчёта здесь нет: что считать результатом, исходом и
 * участником, решает слой наблюдений (FR-33), а маршрут переводит условия из адреса в отбор.
 */
import { Router, type Request, type Response } from "express";

import { logger } from "../../logger";
import { requirePermission } from "../../middleware/auth";
import { storage } from "../../storage";
import {
  loadObservations,
  type ObservationOutcome,
  type ObservationSource,
} from "../../services/analytics/observations";
import type { ObservationSort } from "../../storage/analytics-repository";
import { analyticsScope } from "./helpers";

const router = Router();

/** Сколько строк отдаётся за раз, когда порция не названа. */
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 200;

const SOURCES: ObservationSource[] = ["web", "telemetry", "import"];
const OUTCOMES: ObservationOutcome[] = ["passed", "failed", "completed", "incomplete"];

/** Столбцы, по которым реестр сортируется. Те же, что видны на экране. */
const SORTS: ObservationSort[] = ["participant", "test", "date", "result", "outcome", "source"];

/** Значения параметра, повторённого несколько раз или перечисленного через запятую. */
function listOf(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value === undefined ? [] : [value];
  return raw
    .flatMap(item => String(item).split(","))
    .map(item => item.trim())
    .filter(Boolean);
}

/**
 * Дата из параметра.
 *
 * Конец периода — конец ДНЯ: «по 30 сентября» в интерфейсе означает включительно, и без этого
 * прохождения последнего дня выборки молча пропадали бы.
 */
function dateOf(value: unknown, edge: "start" | "end"): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const date = new Date(`${value}T${edge === "start" ? "00:00:00.000" : "23:59:59.999"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

/**
 * Группы прохождений одной порции — по правилу FR-09.
 *
 * У веб-попытки группа выводится из ЧЛЕНСТВА участника, и членств может быть несколько: человек
 * состоит в отделе и в потоке обучения разом, поэтому строка несёт список, а не одно значение.
 * У импортированного прохождения группа приехала с выгрузкой (`scorm_attempts.group_id`) и
 * членство не спрашивается: участник там может быть не заведён вовсе (PRD-54).
 *
 * Справочники читаются поимённо, по тем участникам и группам, что попали в порцию: читать всё
 * членство инсталляции ради двадцати пяти строк — то самое чтение таблицы целиком, от которого
 * реестр и ушёл.
 */
async function groupsOfPage(
  rows: Array<{ id: string; userId: string | null; groupId: string | null }>,
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();

  const ownGroupIds = [...new Set(rows.map(row => row.groupId).filter((id): id is string => !!id))];
  const ownNames = new Map(
    (await Promise.all(ownGroupIds.map(id => storage.getGroup(id))))
      .filter((group): group is NonNullable<typeof group> => !!group)
      .map(group => [group.id, group.name]),
  );

  const userIds = [...new Set(
    rows.filter(row => !row.groupId).map(row => row.userId).filter((id): id is string => !!id),
  )];
  const membership = new Map(
    await Promise.all(userIds.map(async id => [
      id,
      (await storage.getUserGroups(id)).map(group => group.name),
    ] as const)),
  );

  for (const row of rows) {
    if (row.groupId) {
      const name = ownNames.get(row.groupId);
      out.set(row.id, name ? [name] : []);
      continue;
    }
    out.set(row.id, row.userId ? membership.get(row.userId) ?? [] : []);
  }
  return out;
}

// GET /api/analytics/registry — порция прохождений и общее их число
router.get("/registry", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const scope = await analyticsScope(req);
    const limit = Math.min(Number(req.query.limit) || DEFAULT_LIMIT, MAX_LIMIT);
    const offset = Math.max(Number(req.query.offset) || 0, 0);

    const sources = listOf(req.query.source).filter((s): s is ObservationSource =>
      (SOURCES as string[]).includes(s));
    const outcomes = listOf(req.query.outcome).filter((o): o is ObservationOutcome =>
      (OUTCOMES as string[]).includes(o));
    const testIds = listOf(req.query.testId);
    const groupIds = listOf(req.query.groupId);

    // Столбец сортировки принимается только из перечня: незнакомое имя — это опечатка в
    // чужой ссылке, и отвечать на неё ошибкой незачем, реестр просто встаёт по умолчанию.
    const sort = SORTS.includes(String(req.query.sort) as ObservationSort)
      ? String(req.query.sort) as ObservationSort
      : undefined;
    const dir = req.query.dir === "asc" ? "asc" as const : undefined;

    const page = await loadObservations(
      {
        ...(testIds.length ? { testIds } : {}),
        ...(groupIds.length ? { groupIds } : {}),
        ...(sources.length ? { sources } : {}),
        ...(outcomes.length ? { outcomes } : {}),
        ...(dateOf(req.query.from, "start") ? { from: dateOf(req.query.from, "start") } : {}),
        ...(dateOf(req.query.to, "end") ? { to: dateOf(req.query.to, "end") } : {}),
        ...(sort ? { sort } : {}),
        ...(dir ? { dir } : {}),
        limit,
        offset,
      },
      scope,
    );

    // Названия тестов спрашиваются поимённо: в порции их единицы, а весь справочник ради
    // двадцати пяти строк — то самое чтение таблицы целиком, от которого ушли.
    const testIdsInPage = [...new Set(page.rows.map(r => r.testId).filter((id): id is string => !!id))];
    const titles = new Map(
      (await Promise.all(testIdsInPage.map(id => storage.getTest(id))))
        .filter((test): test is NonNullable<typeof test> => !!test)
        .map(test => [test.id, test.title]),
    );

    const groups = await groupsOfPage(page.rows);

    res.json({
      rows: page.rows.map(row => ({
        id: row.id,
        participant: row.participant,
        participantKey: row.participantKey,
        userId: row.userId,
        testId: row.testId,
        // Тест мог быть удалён: строка прохождения от этого не перестаёт существовать.
        testTitle: row.testId ? titles.get(row.testId) ?? "Удалённый тест" : "Удалённый тест",
        startedAt: row.startedAt,
        finishedAt: row.finishedAt,
        durationMs: row.durationMs,
        percent: row.percent,
        passed: row.passed,
        outcome: row.outcome,
        source: row.source,
        groupId: row.groupId,
        groups: groups.get(row.id) ?? [],
      })),
      total: page.total,
      limit,
      offset,
    });
  } catch (error) {
    logger.error("Registry analytics error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to load registry" });
  }
});

export default router;
