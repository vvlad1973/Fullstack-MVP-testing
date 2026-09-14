/**
 * @module tests/routes.analytics-slices
 * @description PRD-56 FR-06, FR-07e, FR-07i: ручка срезов.
 *
 * Срез хранит условия и пересчитывается при каждом открытии (FR-07d), поэтому ручка не отдаёт
 * сохранённые числа: она считает их по наблюдениям здесь и сейчас, в рамке «тест плюс период».
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { observationsDouble } from "./helpers/observations-double";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTests: vi.fn(), getTest: vi.fn(),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
    getSlices: vi.fn(), getSlice: vi.fn(), createSlice: vi.fn(),
    updateSlice: vi.fn(), deleteSlice: vi.fn(),
    // Справочники оси разбиения: членство, названия групп, снимки публикации.
    getGroups: vi.fn().mockResolvedValue([]),
    getUserGroups: vi.fn().mockResolvedValue([]),
    getGroupUsers: vi.fn().mockResolvedValue([]),
    getSnapshotsForTest: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import slicesRouter from "../server/routes/analytics/slices";

const TEST = {
  id: "test1", title: "Сертификация", mode: "standard",
  overallPassRuleJson: { type: "percent", value: 70 },
};

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", slicesRouter);
  return app;
}

const ask = (query = "") =>
  request(makeApp()).get(`/api/analytics/slices${query}`).set("x-test-user", "u-owner");

/** Двенадцать веб-попыток: выборка выше порога наблюдений. */
function attempts(count: number, passedCount: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `web-${index}`, testId: "test1", userId: `u${index}`,
    startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
    variantJson: {}, answersJson: {},
    resultJson: {
      overallPercent: index < passedCount ? 80 : 40,
      overallPassed: index < passedCount,
      totalPossiblePoints: 20,
      totalEarnedPoints: index < passedCount ? 16 : 8,
    },
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u-owner", name: "Оценщик", email: "o@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTests.mockResolvedValue([TEST]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getAllScormAttempts.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue(attempts(12, 9));
  storageMock.getGroups.mockResolvedValue([]);
  storageMock.getGroupUsers.mockResolvedValue([]);
  storageMock.getSnapshotsForTest.mockResolvedValue([]);
  storageMock.getSlices.mockResolvedValue([
    {
      id: "s1", name: "Отдел продаж", testId: "test1",
      conditionsJson: { groupIds: ["g1"] }, createdBy: "u-owner",
    },
  ]);
});

describe("GET /api/analytics/slices", () => {
  it("считает величины среза, а не отдаёт сохранённые", async () => {
    const res = await ask("?testId=test1");

    expect(res.status).toBe(200);
    expect(res.body.slices).toHaveLength(1);
    expect(res.body.slices[0]).toMatchObject({
      id: "s1",
      name: "Отдел продаж",
      completed: 12,
      passed: 9,
      passRate: 75,
      enoughData: true,
    });
  });

  it("подставляет тест рамки в условия среза (FR-07e)", async () => {
    await ask("?testId=test1");

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({ testIds: ["test1"] }),
    );
  });

  it("не считает средние без теста: у разных тестов разные пороги и шкалы", async () => {
    const res = await ask();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/тест/i);
  });

  it("принимает период как рамку расчёта и передаёт его в выборку", async () => {
    await ask("?testId=test1&from=2026-09-01&to=2026-09-30");

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({
        from: new Date("2026-09-01T00:00:00.000Z"),
        to: new Date("2026-09-30T23:59:59.999Z"),
      }),
    );
  });

  it("работает без периода: пустые даты значат «за всё время» (FR-07j)", async () => {
    const res = await ask("?testId=test1");

    expect(res.status).toBe(200);
    const call = storageMock.selectObservations.mock.calls.at(-1)![0];
    expect(call.from).toBeUndefined();
    expect(call.to).toBeUndefined();
  });

  it("ниже порога наблюдений отдаёт объём вместо процентов", async () => {
    storageMock.getAllAttempts.mockResolvedValue(attempts(3, 2));

    const res = await ask("?testId=test1");

    expect(res.body.slices[0]).toMatchObject({
      completed: 3, enoughData: false, passRate: null, avgPercent: null,
    });
  });

  it("отдаёт пустой список, когда срезов ещё нет", async () => {
    storageMock.getSlices.mockResolvedValue([]);

    const res = await ask("?testId=test1");

    expect(res.status).toBe(200);
    expect(res.body.slices).toEqual([]);
  });
});

describe("GET /api/analytics/slices?axis=... — разбиение", () => {
  it("разбивает выборку по оси и считает каждый срез", async () => {
    storageMock.getGroups.mockResolvedValue([
      { id: "g1", name: "Отдел продаж" },
      { id: "g2", name: "Розница" },
    ]);
    storageMock.getGroupUsers.mockImplementation(async (groupId: string) =>
      groupId === "g1"
        ? Array.from({ length: 12 }, (_, i) => ({ id: `u${i}` }))
        : [],
    );

    const res = await ask("?testId=test1&axis=group");

    expect(res.status).toBe(200);
    const sales = res.body.slices.find((slice: { name: string }) => slice.name === "Отдел продаж");
    expect(sales).toMatchObject({ completed: 12, passed: 9, enoughData: true });
  });

  it("не теряет прохождения вне групп", async () => {
    storageMock.getGroups.mockResolvedValue([{ id: "g1", name: "Отдел продаж" }]);
    storageMock.getGroupUsers.mockResolvedValue([]);

    const res = await ask("?testId=test1&axis=group");

    expect(res.body.slices.map((slice: { name: string }) => slice.name)).toEqual(["Без группы"]);
  });

  it("отказывает в неизвестной оси, а не молча отдаёт сохранённые срезы", async () => {
    const res = await ask("?testId=test1&axis=должность");

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ось/i);
  });
});

describe("GET /api/analytics/slices?withWhole=1 — тест целиком", () => {
  it("добавляет срез без условий, которым сравнивают с тестом целиком (FR-07a)", async () => {
    const res = await ask("?testId=test1&withWhole=1");

    expect(res.status).toBe(200);
    const whole = res.body.slices.find((slice: { id: string }) => slice.id === "whole");
    expect(whole).toMatchObject({ name: "Тест целиком", completed: 12, passed: 9 });
  });

  it("не заводит отдельной сущности «эталон»: это обычный срез без условий", async () => {
    const res = await ask("?testId=test1&withWhole=1");

    const whole = res.body.slices.find((slice: { id: string }) => slice.id === "whole");
    expect(whole.conditions).toEqual({});
  });

  it("без параметра среза «тест целиком» в списке нет", async () => {
    const res = await ask("?testId=test1");

    expect(res.body.slices.some((slice: { id: string }) => slice.id === "whole")).toBe(false);
  });
});
