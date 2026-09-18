import { describe, expect, it } from "vitest";
import { jitteredDelay, longPauseMs, retryDelayMs } from "../../scripts/deps/pace.mjs";

describe("jitteredDelay", () => {
  it("добавляет к базовой паузе случайную часть разброса", () => {
    expect(jitteredDelay(500, 200, () => 0)).toBe(500);
    expect(jitteredDelay(500, 200, () => 0.5)).toBe(600);
  });

  it("не добавляет разброс, когда он равен нулю", () => {
    expect(jitteredDelay(500, 0, () => 0.99)).toBe(500);
  });

  it("округляет случайную добавку вниз до целых миллисекунд", () => {
    expect(jitteredDelay(500, 200, () => 1 / 3)).toBe(566);
  });
});

describe("retryDelayMs", () => {
  it("уважает Retry-After в секундах", () => {
    expect(retryDelayMs(0, "3")).toBe(3000);
  });

  it("удваивает выдержку без Retry-After", () => {
    expect(retryDelayMs(0, null)).toBe(2000);
    expect(retryDelayMs(1, null)).toBe(4000);
    expect(retryDelayMs(2, null)).toBe(8000);
  });

  it("не превышает минуту", () => {
    expect(retryDelayMs(10, null)).toBe(60000);
    expect(retryDelayMs(0, "3600")).toBe(60000);
  });

  it("игнорирует нечисловой Retry-After", () => {
    expect(retryDelayMs(0, "Wed, 21 Oct 2026 07:28:00 GMT")).toBe(2000);
  });

  it("игнорирует Retry-After: 0 и отрицательные значения", () => {
    expect(retryDelayMs(0, "0")).toBe(2000);
    expect(retryDelayMs(0, "-5")).toBe(2000);
  });

  it("усекает дробный Retry-After до целых секунд", () => {
    expect(retryDelayMs(0, "2.9")).toBe(2000);
  });

  it("игнорирует пустую строку и undefined как отсутствие Retry-After", () => {
    expect(retryDelayMs(1, "")).toBe(4000);
    expect(retryDelayMs(1, undefined)).toBe(4000);
  });
});

describe("longPauseMs", () => {
  it("даёт передышку каждые пятьдесят запросов", () => {
    expect(longPauseMs(0)).toBe(0);
    expect(longPauseMs(49)).toBe(0);
    expect(longPauseMs(50)).toBe(5000);
    expect(longPauseMs(100)).toBe(5000);
  });

  it("принимает нестандартные период и длительность передышки", () => {
    expect(longPauseMs(10, { every: 10, pauseMs: 1000 })).toBe(1000);
    expect(longPauseMs(9, { every: 10, pauseMs: 1000 })).toBe(0);
  });
});
