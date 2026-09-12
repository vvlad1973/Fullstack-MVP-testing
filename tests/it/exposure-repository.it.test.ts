/**
 * @module tests/it/exposure-repository
 * @description PRD-55 (FR-05, FR-07): счётчик выдач копится по корзинам-месяцам и читается
 * суммой за окно.
 *
 * Круглый рейс на настоящей базе здесь обязателен, а не избыточен. Инкремент держится на
 * составном первичном ключе и `onConflictDoUpdate` — объектах, которые существуют ТОЛЬКО в базе.
 * Ошибка в них не уронит ни одного запроса: она проявится позже, неверными весами выдачи, то
 * есть тем, что никакой юнит-тест над моком не поймает.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { ExposureRepository } from "../../server/storage/exposure-repository";

let repo: ExposureRepository;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new ExposureRepository();
});

afterAll(async () => {
  await h.current?.close();
  h.current = null;
});

beforeEach(async () => {
  await h.current!.reset();
});

describe("счётчик выдач", () => {
  it("складывает выдачи одного месяца в одну корзину", async () => {
    await repo.recordDeliveries(["q1", "q2"], "t1", new Date("2026-09-12"));
    await repo.recordDeliveries(["q1"], "t1", new Date("2026-09-20"));

    const counts = await repo.getDeliveryCounts(["q1", "q2"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(2);
    expect(counts.get("q2")).toBe(1);
  });

  it("не берёт корзины старше окна", async () => {
    await repo.recordDeliveries(["q1"], "t1", new Date("2024-01-15"));
    await repo.recordDeliveries(["q1"], "t1", new Date("2026-09-01"));

    const counts = await repo.getDeliveryCounts(["q1"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(1);
  });

  it("суммирует выдачи задания по РАЗНЫМ тестам", async () => {
    await repo.recordDeliveries(["q1"], "t1", new Date("2026-09-12"));
    await repo.recordDeliveries(["q1"], "t2", new Date("2026-09-12"));

    const counts = await repo.getDeliveryCounts(["q1"], new Date("2026-01-01"));
    expect(counts.get("q1")).toBe(2);
  });

  it("задание без выдач в карте отсутствует", async () => {
    await repo.recordDeliveries(["q1"], "t1", new Date("2026-09-12"));

    const counts = await repo.getDeliveryCounts(["q1", "q2"], new Date("2026-01-01"));
    expect(counts.has("q2")).toBe(false);
  });

  it("пустой список заданий не ходит в базу и даёт пустую карту", async () => {
    await repo.recordDeliveries([], "t1", new Date("2026-09-12"));

    const counts = await repo.getDeliveryCounts([], new Date("2026-01-01"));
    expect(counts.size).toBe(0);
  });
});
