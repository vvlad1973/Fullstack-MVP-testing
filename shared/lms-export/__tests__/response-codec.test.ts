/**
 * @module shared/lms-export/__tests__/response-codec
 */
import { describe, it, expect } from "vitest";
import { decodeLearnerResponse, encodeLearnerResponse } from "../response-codec";

describe("decodeLearnerResponse", () => {
  it("одиночный выбор приходит 1-based и становится 0-based", () => {
    expect(decodeLearnerResponse("single", "3")).toBe(2);
    expect(decodeLearnerResponse("scale", "1")).toBe(0);
  });

  it("множественный выбор и ранжирование — списки 1-based", () => {
    expect(decodeLearnerResponse("multiple", "1,3,4")).toEqual([0, 2, 3]);
    expect(decodeLearnerResponse("ranking", "2,1,4,3")).toEqual([1, 0, 3, 2]);
  });

  it("сопоставление — пары лево-право, обе стороны 1-based", () => {
    expect(decodeLearnerResponse("matching", "1-2,2-1")).toEqual({ 0: 1, 1: 0 });
  });

  // ГОЧА PRD-54 раздел 7: у распределения баллов индексы 0-based, в отличие от всех остальных
  // типов. Строка взята из реальной выгрузки docs/references/7684237229762827328-1.xlsx.
  it("распределение баллов — индексы 0-based, разделитель [.]", () => {
    expect(decodeLearnerResponse("allocation", "0[.]1,1[.]5,2[.]1,3[.]0")).toEqual({ 0: 1, 1: 5, 2: 1, 3: 0 });
  });

  it("пустая строка — это отсутствие ответа", () => {
    expect(decodeLearnerResponse("single", "")).toBeNull();
    expect(decodeLearnerResponse("allocation", "   ")).toBeNull();
  });

  it("мусор не роняет разбор", () => {
    expect(decodeLearnerResponse("multiple", "a,b")).toBeNull();
  });
});

describe("парность кодирования и разбора", () => {
  const cases: Array<[string, unknown]> = [
    ["single", 2],
    ["scale", 0],
    ["multiple", [0, 2, 3]],
    ["ranking", [1, 0, 3, 2]],
    ["matching", { 0: 1, 1: 0 }],
    ["allocation", { 0: 1, 1: 5, 2: 1, 3: 0 }],
  ];

  it.each(cases)("%s: decode(encode(x)) === x", (type, answer) => {
    expect(decodeLearnerResponse(type, encodeLearnerResponse(type, answer as never))).toEqual(answer);
  });
});
