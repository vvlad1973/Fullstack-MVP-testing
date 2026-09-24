/**
 * @module tests/routes.lms-import-counted
 * @description PRD-66 FR-12: ручка «учитывать партию в расчётах».
 *
 * Сомнительную выгрузку нужно уметь отключить, НЕ удаляя данные: прежде у партии было два
 * состояния — загружена и удалена, — и любое сомнение разрешалось необратимо. Снятие с учёта
 * убирает партию из выборки, строки остаются в базе и возвращаются тем же переключателем.
 *
 * Отдельно проверяется область доступа: в маршруте стоит ПАРТИЯ, а не тест, поэтому мидлварь
 * области здесь не применима и проверка живёт внутри обработчика — ровно там, где её легче
 * всего потерять.
 */
import express from "express";
import session from "express-session";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { storageMock } = vi.hoisted(() => ({
  storageMock: {
    getUser: vi.fn(),
    getUserRoles: vi.fn().mockResolvedValue(["administrator"]),
    getTest: vi.fn(),
    getLmsImportBatchById: vi.fn(),
    setLmsImportBatchCounted: vi.fn().mockResolvedValue(undefined),
    getTestIdsByOwner: vi.fn().mockResolvedValue([]),
    getUserTestGrants: vi.fn().mockResolvedValue([]),
    getTestGrantForUser: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../server/storage", () => ({ storage: storageMock }));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import lmsImportRouter from "../server/routes/analytics/lms-import";

const TEST = { id: "test1", title: "Сертификация", mode: "standard", createdBy: "author1" };
const BATCH = { id: "batch1", testId: "test1", fileName: "f.xlsx", counted: true };

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(session({ secret: "test", resave: false, saveUninitialized: false }));
  app.use((req: any, _res: any, next: any) => {
    if (req.headers["x-test-user"]) req.session.userId = req.headers["x-test-user"];
    next();
  });
  app.use("/api/analytics", lmsImportRouter);
  return app;
}

const patch = (body: object) =>
  request(makeApp()).patch("/api/analytics/lms-import/batches/batch1").set("x-test-user", "a1").send(body);

beforeEach(() => {
  vi.clearAllMocks();
  storageMock.getUser.mockResolvedValue({ id: "a1", name: "Админ", email: "a@b.c" });
  storageMock.getUserRoles.mockResolvedValue(["administrator"]);
  storageMock.getTest.mockResolvedValue(TEST);
  storageMock.getLmsImportBatchById.mockResolvedValue(BATCH);
  storageMock.setLmsImportBatchCounted.mockResolvedValue(undefined);
  storageMock.getTestIdsByOwner.mockResolvedValue([]);
  storageMock.getUserTestGrants.mockResolvedValue([]);
  storageMock.getTestGrantForUser.mockResolvedValue(undefined);
});

describe("PATCH /lms-import/batches/:id", () => {
  it("снимает партию с учёта", async () => {
    const res = await patch({ counted: false });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, counted: false });
    expect(storageMock.setLmsImportBatchCounted).toHaveBeenCalledWith("batch1", false);
  });

  it("возвращает партию в расчёты", async () => {
    const res = await patch({ counted: true });

    expect(res.status).toBe(200);
    expect(storageMock.setLmsImportBatchCounted).toHaveBeenCalledWith("batch1", true);
  });

  it("не принимает тело без признака", async () => {
    // Отсутствующее поле нельзя трактовать как «выключить»: переключатель молча сделал бы
    // не то, о чём его просили.
    const res = await patch({});

    expect(res.status).toBe(400);
    expect(storageMock.setLmsImportBatchCounted).not.toHaveBeenCalled();
  });

  it("неизвестная партия — 404, и ничего не пишется", async () => {
    storageMock.getLmsImportBatchById.mockResolvedValue(undefined);

    const res = await patch({ counted: false });

    expect(res.status).toBe(404);
    expect(storageMock.setLmsImportBatchCounted).not.toHaveBeenCalled();
  });

  it("чужой тест не переключается", async () => {
    storageMock.getUserRoles.mockResolvedValue(["author"]);

    const res = await patch({ counted: false });

    expect(res.status).toBe(403);
    expect(storageMock.setLmsImportBatchCounted).not.toHaveBeenCalled();
  });
});
