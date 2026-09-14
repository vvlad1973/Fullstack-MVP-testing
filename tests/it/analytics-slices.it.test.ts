/**
 * @module tests/it/analytics-slices.it.test
 * @description PRD-56 FR-07b, FR-07d: хранилище срезов на реальной базе.
 *
 * Срез хранит УСЛОВИЯ, а не список прохождений: круговой рейс через базу здесь и проверяется —
 * словарь условий уезжает в `jsonb` и обязан вернуться без потерь, иначе сохранённый срез
 * назавтра отберёт не то.
 *
 * Второе, что можно проверить только на базе: уникальность имени у одного владельца. Она
 * держится индексом, а не кодом, и её нарушение проявится не ошибкой, а двумя одинаковыми
 * строками в списке срезов.
 */
import { randomUUID } from "node:crypto";
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { users } from "@shared/schema";
import { createHarness, type Harness } from "./db-harness";

const h = vi.hoisted(() => ({ current: null as Harness | null }));
vi.mock("../../server/db", () => ({
  get db() {
    if (!h.current) throw new Error("harness not initialized");
    return h.current.db;
  },
}));

// eslint-disable-next-line import/first -- must import AFTER vi.mock
import { SlicesRepository } from "../../server/storage/slices-repository";

let repo: SlicesRepository;
let ownerId: string;
let otherId: string;

beforeAll(async () => {
  h.current = await createHarness();
  repo = new SlicesRepository();
});
afterAll(async () => {
  await h.current!.close();
});
beforeEach(async () => {
  await h.current!.reset();
  ownerId = randomUUID();
  otherId = randomUUID();
  for (const [id, email] of [[ownerId, "owner@b.c"], [otherId, "other@b.c"]]) {
    await h.current!.db.insert(users).values({
      id, email, passwordHash: "x", name: "Кто-то",
    } as never);
  }
});

describe("SlicesRepository", () => {
  it("возвращает условия среза без потерь", async () => {
    const conditions = {
      testIds: ["t1"],
      groupIds: ["g1", "g2"],
      sources: ["web", "import"],
      outcomes: ["failed"],
      from: "2026-09-01",
      to: "2026-09-30",
    };

    const created = await repo.createSlice({
      name: "Отдел продаж, не сдали",
      testId: "t1",
      conditionsJson: conditions,
      createdBy: ownerId,
    });

    const [loaded] = await repo.getSlices(ownerId);
    expect(loaded.id).toBe(created.id);
    expect(loaded.conditionsJson).toEqual(conditions);
  });

  it("допускает срез без теста: отбор по всем доступным", async () => {
    const created = await repo.createSlice({
      name: "Все не сдавшие",
      testId: null,
      conditionsJson: { outcomes: ["failed"] },
      createdBy: ownerId,
    });

    expect(created.testId).toBeNull();
  });

  it("показывает владельцу только его срезы", async () => {
    await repo.createSlice({ name: "Мой", testId: null, conditionsJson: {}, createdBy: ownerId });
    await repo.createSlice({ name: "Чужой", testId: null, conditionsJson: {}, createdBy: otherId });

    const mine = await repo.getSlices(ownerId);

    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe("Мой");
  });

  it("не даёт одному владельцу два среза с одним именем", async () => {
    await repo.createSlice({ name: "Розница", testId: null, conditionsJson: {}, createdBy: ownerId });

    await expect(
      repo.createSlice({ name: "Розница", testId: null, conditionsJson: {}, createdBy: ownerId }),
    ).rejects.toThrow();
  });

  it("разрешает одинаковые имена разным владельцам", async () => {
    await repo.createSlice({ name: "Розница", testId: null, conditionsJson: {}, createdBy: ownerId });

    await expect(
      repo.createSlice({ name: "Розница", testId: null, conditionsJson: {}, createdBy: otherId }),
    ).resolves.toBeTruthy();
  });

  it("удаляет срез своего владельца и не трогает чужой", async () => {
    const mine = await repo.createSlice({
      name: "Мой", testId: null, conditionsJson: {}, createdBy: ownerId,
    });
    const alien = await repo.createSlice({
      name: "Чужой", testId: null, conditionsJson: {}, createdBy: otherId,
    });

    expect(await repo.deleteSlice(mine.id, ownerId)).toBe(true);
    expect(await repo.deleteSlice(alien.id, ownerId)).toBe(false);
    expect(await repo.getSlices(otherId)).toHaveLength(1);
  });

  it("перечисляет срезы новыми первыми", async () => {
    await repo.createSlice({ name: "Первый", testId: null, conditionsJson: {}, createdBy: ownerId });
    await new Promise(resolve => setTimeout(resolve, 5));
    await repo.createSlice({ name: "Второй", testId: null, conditionsJson: {}, createdBy: ownerId });

    expect((await repo.getSlices(ownerId)).map(s => s.name)).toEqual(["Второй", "Первый"]);
  });
});
