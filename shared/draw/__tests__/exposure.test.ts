/**
 * @module shared/draw/__tests__/exposure
 * @description PRD-55 (FR-12 - FR-17): вес сравнителен ВНУТРИ пула, ограничен пределом R и
 * вырождается в единицу, когда сравнивать нечего.
 */
import { describe, it, expect } from "vitest";
import { computeWeights, EXPOSURE_WEIGHT_RATIO } from "../exposure";

const counts = (pairs: Array<[string, number]>) => new Map(pairs);

describe("computeWeights", () => {
  it("равные счётчики дают равные веса", () => {
    const w = computeWeights(["a", "b", "c"], counts([["a", 5], ["b", 5], ["c", 5]]));
    expect([...w.values()]).toEqual([1, 1, 1]);
  });

  it("нет данных — все веса единичны", () => {
    const w = computeWeights(["a", "b"], counts([]));
    expect([...w.values()]).toEqual([1, 1]);
  });

  it("самое горячее задание получает 1, самое свежее — R", () => {
    const w = computeWeights(["a", "b"], counts([["a", 10], ["b", 0]]));
    expect(w.get("a")).toBe(1);
    expect(w.get("b")).toBe(EXPOSURE_WEIGHT_RATIO);
  });

  it("промежуточное задание раскладывается линейно", () => {
    const w = computeWeights(["a", "b", "c"], counts([["a", 10], ["b", 5], ["c", 0]]));
    expect(w.get("b")).toBeCloseTo(1 + (EXPOSURE_WEIGHT_RATIO - 1) * 0.5, 10);
  });

  it("отсутствующий в карте счётчик означает ноль выдач", () => {
    const w = computeWeights(["a", "b"], counts([["a", 4]]));
    expect(w.get("b")).toBe(EXPOSURE_WEIGHT_RATIO);
  });

  it("пустой пул даёт пустую карту", () => {
    expect(computeWeights([], counts([])).size).toBe(0);
  });

  it("единственное задание пула весит единицу", () => {
    const w = computeWeights(["a"], counts([["a", 99]]));
    expect(w.get("a")).toBe(1);
  });

  it("шкала СРАВНИТЕЛЬНАЯ: одинаковый разрыв даёт одинаковые веса при любых абсолютных числах", () => {
    const small = computeWeights(["a", "b"], counts([["a", 2], ["b", 0]]));
    const large = computeWeights(["a", "b"], counts([["a", 2000], ["b", 0]]));
    expect([...small.values()]).toEqual([...large.values()]);
  });

  it("вес не выходит за пределы [1, R] ни при каком разбросе", () => {
    const w = computeWeights(
      ["a", "b", "c", "d"],
      counts([["a", 0], ["b", 1], ["c", 500], ["d", 10000]]),
    );
    for (const v of w.values()) {
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(EXPOSURE_WEIGHT_RATIO);
    }
  });
});
