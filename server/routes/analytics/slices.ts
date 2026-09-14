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
import {
  registryConditions,
  splitByAxis,
  type AxisContext,
  type SliceAxis,
} from "../../services/analytics/slice-axis";
import { summariseSlice } from "../../services/analytics/slice-stats";
import { analyticsScope } from "./helpers";

const router = Router();

/** Оси, для которых данные уже есть (FR-06a). Оргструктуры среди них нет и не будет (FR-06b). */
const AXES: readonly SliceAxis[] = [
  "group", "period", "attempt", "version", "variant", "source", "external",
];

/**
 * Справочники для оси: членство в группах, их названия, номера версий и внешние участники.
 *
 * Читаются один раз на запрос и только когда ось запрошена: списку сохранённых срезов они не
 * нужны, а группы с пользователями — это столько запросов, сколько в инсталляции групп.
 */
async function axisContext(testId: string): Promise<AxisContext> {
  const [groups, snapshots, sections] = await Promise.all([
    storage.getGroups(),
    storage.getSnapshotsForTest(testId),
    storage.getTestSections(testId),
  ]);

  // Названия вариантов задаёт автор в наборе форм раздела (PRD-17); срез подписывается ими,
  // а не идентификатором формы — тот uuid и читателю не говорит ничего.
  const formLabels = new Map<string, string>();
  for (const section of sections) {
    for (const form of section.formSetJson?.forms ?? []) formLabels.set(form.id, form.label);
  }

  const groupsOfParticipant = new Map<string, string[]>();
  const externalParticipants = new Set<string>();
  await Promise.all(groups.map(async group => {
    for (const member of await storage.getGroupUsers(group.id)) {
      groupsOfParticipant.set(member.id, [...(groupsOfParticipant.get(member.id) ?? []), group.id]);
      if ((member as { isExternal?: boolean }).isExternal) externalParticipants.add(member.id);
    }
  }));

  return {
    groupsOfParticipant,
    groupNames: new Map(groups.map(group => [group.id, group.name])),
    externalParticipants,
    snapshotVersions: new Map(snapshots.map(snapshot => [snapshot.id, snapshot.version])),
    formLabels,
  };
}

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

    const axis = typeof req.query.axis === "string" ? req.query.axis.trim() : "";
    if (axis && !AXES.includes(axis as SliceAxis)) {
      // Молча отдать вместо разбиения сохранённые срезы — значит ответить не на тот вопрос.
      // Ось, которой нет (например «должность»), — это отсутствующие данные, а не опечатка.
      return res.status(400).json({ error: `Неизвестная ось разбиения: ${axis}` });
    }

    if (axis) {
      const { rows } = await loadObservations(
        { testIds: [testId], ...(from ? { from } : {}), ...(to ? { to } : {}) },
        scope,
      );
      const buckets = splitByAxis(rows, axis as SliceAxis, await axisContext(testId));

      return res.json({
        axis,
        slices: buckets.map(bucket => ({
          id: `${axis}:${bucket.key}`,
          name: bucket.label,
          // FR-08: условия на языке реестра, чтобы из строки был переход к прохождениям.
          // Перевод делается здесь, где разбиение известно: иначе оси пришлось бы описывать
          // второй раз на клиенте, и два описания однажды разошлись бы.
          conditions: registryConditions(axis as SliceAxis, bucket.key),
          ...summariseSlice({ observations: bucket.observations, minObservations }),
        })),
        minObservations,
      });
    }

    const saved = await storage.getSlices(ownerId);

    /**
     * Срез «тест целиком» — обычный срез БЕЗ условий (FR-07a).
     *
     * Отдельной сущности «эталон» в продукте не заводится: сравнение с тестом целиком
     * делается тем же механизмом, что сравнение двух групп. Иначе у эталона завелись бы свои
     * правила, и однажды он стал бы считаться не так, как всё остальное.
     */
    const withWhole = req.query.withWhole === "1" || req.query.withWhole === "true";
    const sources = withWhole
      ? [{ id: "whole", name: "Тест целиком", conditionsJson: {} as Record<string, unknown> }, ...saved]
      : saved;

    const slices = await Promise.all(sources.map(async slice => {
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

// POST /api/analytics/slices — сохранить текущий отбор как срез (FR-07c)
router.post("/slices", requirePermission("analytics.read"), async (req: Request, res: Response) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const conditions = (body.conditions ?? {}) as Record<string, unknown>;
    const testId = typeof body.testId === "string" && body.testId.trim() ? body.testId.trim() : null;

    if (!name) {
      // Безымянный срез неотличим в списке от соседнего: выбор между ними становится
      // случайным, а сохранять то, что нельзя потом найти, незачем.
      return res.status(400).json({ error: "Нужно имя среза" });
    }

    const hasConditions = Object.values(conditions).some(value =>
      Array.isArray(value) ? value.length > 0 : value !== undefined && value !== null && value !== "");
    if (!hasConditions) {
      // Срез без условий — это весь тест; он и так доступен как «Тест целиком» (FR-07a).
      return res.status(400).json({ error: "Нужно хотя бы одно условие отбора" });
    }

    const slice = await storage.createSlice({
      name,
      testId,
      conditionsJson: conditions,
      createdBy: req.currentUser?.id ?? "",
    });

    res.status(201).json({ slice });
  } catch (error) {
    // Уникальность имени стережёт индекс: сюда его нарушение приходит ошибкой базы, и
    // читателю надо сказать по-человечески, а не «23505».
    if ((error as { code?: string }).code === "23505") {
      return res.status(409).json({ error: "Срез с таким именем уже есть" });
    }
    logger.error("Save slice error: " + (error as Error).message);
    res.status(500).json({ error: "Failed to save slice" });
  }
});

export default router;
