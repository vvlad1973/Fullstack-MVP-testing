import { describe, it, expect } from "vitest";
import { parseNumericAnswer, matchNumber } from "../shared/answer-check/number";

describe("parseNumericAnswer", () => {
  it("принимает точку и запятую как разделитель", () => {
    expect(parseNumericAnswer("3.14")).toBe(3.14);
    expect(parseNumericAnswer("3,14")).toBe(3.14);
  });

  it("не замечает пробелов, включая неразрывный", () => {
    expect(parseNumericAnswer(" 3,14 ")).toBe(3.14);
    expect(parseNumericAnswer("1 000,5")).toBe(1000.5);
  });

  it("принимает отрицательные значения", () => {
    expect(parseNumericAnswer("-25")).toBe(-25);
    expect(parseNumericAnswer("−25")).toBe(-25);
  });

  it("возвращает null на том, что числом не является", () => {
    expect(parseNumericAnswer("")).toBeNull();
    expect(parseNumericAnswer("пять")).toBeNull();
    expect(parseNumericAnswer("3,14 кг")).toBeNull();
    expect(parseNumericAnswer(null)).toBeNull();
  });

  it("обыкновенные дроби пока не принимаются — это Э5", () => {
    expect(parseNumericAnswer("1/3")).toBeNull();
  });
});

describe("matchNumber", () => {
  const rule = { kind: "number", op: "eq", value: 3.14, tolerance: { unit: "abs", value: 0.01 } } as const;

  it("зачитывает ответ внутри допуска в единицах", () => {
    expect(matchNumber(rule, 3.14)).toBe(true);
    expect(matchNumber(rule, 3.1416)).toBe(true);
    expect(matchNumber(rule, 3.15)).toBe(true);
    expect(matchNumber(rule, 3.2)).toBe(false);
  });

  it("зачитывает ответ внутри допуска в процентах", () => {
    // 5 % от 200 — это 10, то есть окно 190…210 включительно.
    const pct = { kind: "number", op: "eq", value: 200, tolerance: { unit: "pct", value: 5 } } as const;
    expect(matchNumber(pct, 189)).toBe(false);
    expect(matchNumber(pct, 190)).toBe(true);
    expect(matchNumber(pct, 195)).toBe(true);
    expect(matchNumber(pct, 210)).toBe(true);
    expect(matchNumber(pct, 211)).toBe(false);
  });

  it("процентный допуск от отрицательного эталона считается по модулю", () => {
    const pct = { kind: "number", op: "eq", value: -200, tolerance: { unit: "pct", value: 5 } } as const;
    expect(matchNumber(pct, -195)).toBe(true);
    expect(matchNumber(pct, -180)).toBe(false);
  });

  it("без допуска сравнивает точно", () => {
    const exact = { kind: "number", op: "eq", value: 7 } as const;
    expect(matchNumber(exact, 7)).toBe(true);
    expect(matchNumber(exact, 7.0001)).toBe(false);
  });
});
