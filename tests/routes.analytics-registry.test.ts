/**
 * @module tests/routes.analytics-registry
 * @description PRD-56 FR-01 - FR-05: ручка реестра прохождений.
 *
 * Реестр — плоский список всех источников с условиями отбора и ленивой подгрузкой (FR-01c),
 * поэтому ручка обязана отдавать и порцию, и ОБЩЕЕ число: «показано 25 из 128» читается в
 * подвале таблицы, и второе число не выводится из первого.
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
    getTest: vi.fn(), getTests: vi.fn(),
    getAllAttempts: vi.fn(), getAllScormAttempts: vi.fn(), getScormPackages: vi.fn(),
    // PRD-15 FR-08: область видимости читателя строится по владению и грантам.
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    selectObservations: vi.fn(),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import registryRouter from "../server/routes/analytics/registry";

const TEST = {
  id: "test1", title: "Сертификация руководителей", mode: "standard",
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
  app.use("/api/analytics", registryRouter);
  return app;
}

const ask = (query = "") =>
  request(makeApp()).get(`/api/analytics/registry${query}`).set("x-test-user", "a1");

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.selectObservations.mockImplementation(observationsDouble(storageMock as never));
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getUser.mockResolvedValue({ id: "u1", name: "Морозова Анна", email: "a@b.c" });
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getTests.mockResolvedValue([TEST]);
  storageMock.getScormPackages.mockResolvedValue([]);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.getAllAttempts.mockResolvedValue([{
    id: "web-1", testId: "test1", userId: "u1",
    startedAt: new Date("2026-09-11T14:00:00Z"), finishedAt: new Date("2026-09-11T14:20:00Z"),
    variantJson: {}, answersJson: {},
    resultJson: { overallPercent: 78, overallPassed: true, totalPossiblePoints: 20, totalEarnedPoints: 16 },
  }]);
  storageMock.getAllScormAttempts.mockResolvedValue([{
    id: "lms-1", testId: "test1", packageId: null, origin: "import",
    userId: null, participantKey: "7f3a9c21", groupId: null, lmsUserName: null,
    startedAt: new Date("2026-09-10T09:00:00Z"), finishedAt: new Date("2026-09-10T09:30:00Z"),
    resultPercent: 64, resultPassed: false, maxPoints: 20, totalPoints: 13,
  }]);
});

describe("GET /api/analytics/registry", () => {
  it("отдаёт строку в том виде, в каком её рисует реестр", async () => {
    const res = await ask();

    expect(res.status).toBe(200);
    const row = res.body.rows.find((r: { id: string }) => r.id === "web-1");
    expect(row).toMatchObject({
      participant: "Морозова Анна",
      testId: "test1",
      testTitle: "Сертификация руководителей",
      percent: 78,
      outcome: "passed",
      source: "web",
    });
    expect(row.startedAt).toBeTruthy();
  });

  it("подписывает импортированного участника псевдонимом, а не пустотой", async () => {
    const res = await ask();

    const row = res.body.rows.find((r: { id: string }) => r.id === "lms-1");
    expect(row.participant).toBe("Участник 7f3a9c");
    expect(row.source).toBe("import");
  });

  it("отдаёт общее число рядом с порцией", async () => {
    const res = await ask("?limit=1");

    expect(res.body.rows).toHaveLength(1);
    expect(res.body.total).toBe(2);
  });

  it("передаёт условия отбора в выборку", async () => {
    await ask("?testId=test1&source=import&outcome=failed&from=2026-09-01&to=2026-09-30&groupId=g1");

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({
        testIds: ["test1"],
        sources: ["import"],
        outcomes: ["failed"],
        groupIds: ["g1"],
        from: new Date("2026-09-01T00:00:00.000Z"),
        to: new Date("2026-09-30T23:59:59.999Z"),
      }),
    );
  });

  it("не пускает читателя за пределы его области видимости", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);

    await ask();

    expect(storageMock.selectObservations).toHaveBeenCalledWith(
      expect.objectContaining({ impossible: true }),
    );
  });

  it("отвечает пустым списком, а не ошибкой, когда под условия ничего не подошло", async () => {
    storageMock.getAllAttempts.mockResolvedValue([]);
    storageMock.getAllScormAttempts.mockResolvedValue([]);

    const res = await ask();

    expect(res.status).toBe(200);
    expect(res.body.rows).toEqual([]);
    expect(res.body.total).toBe(0);
  });
});
