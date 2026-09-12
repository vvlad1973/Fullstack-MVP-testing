/**
 * @module shared/lms-export/__tests__/response-codec
 */
import { describe, it, expect } from "vitest";
import {
  decodeLearnerResponse,
  encodeLearnerResponse,
  RESPONSE_FORMAT_VERSION,
} from "../response-codec";

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

  // Выгрузка БЕЗ версии формата — пакет, собранный до выравнивания индексов. У распределения
  // баллов там 0-based, в отличие от всех остальных типов.
  // Строка взята из реальной выгрузки docs/references/7684237229762827328-1.xlsx.
  it("распределение баллов без версии — индексы 0-based, разделитель [.]", () => {
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

describe("версия формата строки ответа", () => {
  // Выравнивание индексов (техдолг ROADMAP §0.3, решение владельца 2026-09-12): распределение
  // баллов переходит на 1-based, как и все прочие типы, а пакет сообщает версию формата
  // отдельным взаимодействием. Различить версии по самой строке нельзя — «0,1,2» и «1,2,3»
  // одинаково правдоподобны, — поэтому разбор опирается на присланную версию, а её отсутствие
  // означает «пакет собран до выравнивания».
  it("версия 2: распределение баллов 1-based", () => {
    expect(decodeLearnerResponse("allocation", "1[.]1,2[.]5,3[.]1,4[.]0", 2)).toEqual({ 0: 1, 1: 5, 2: 1, 3: 0 });
  });

  it("версия 2: индекс 0 у распределения больше не разбирается", () => {
    // 1-based строка не может нести ноль; принять его молча значило бы съехать на единицу.
    expect(decodeLearnerResponse("allocation", "0[.]1,1[.]5", 2)).toBeNull();
  });

  it("отсутствие версии читается как исходный формат", () => {
    expect(decodeLearnerResponse("allocation", "0[.]1,1[.]5", null)).toEqual({ 0: 1, 1: 5 });
    expect(decodeLearnerResponse("allocation", "0[.]1,1[.]5", undefined)).toEqual({ 0: 1, 1: 5 });
    expect(decodeLearnerResponse("allocation", "0[.]1,1[.]5", 1)).toEqual({ 0: 1, 1: 5 });
  });

  it("прочие типы версия не меняет — они были 1-based всегда", () => {
    expect(decodeLearnerResponse("single", "3", 2)).toBe(2);
    expect(decodeLearnerResponse("single", "3", 1)).toBe(2);
    expect(decodeLearnerResponse("matching", "1-2,2-1", 2)).toEqual({ 0: 1, 1: 0 });
  });

  it("пакет кодирует распределение 1-based", () => {
    expect(encodeLearnerResponse("allocation", { 0: 1, 1: 5, 2: 1, 3: 0 })).toBe("1[.]1,2[.]5,3[.]1,4[.]0");
  });

  it("исходный формат воспроизводится явной версией — ради проверки парности на легаси", () => {
    expect(encodeLearnerResponse("allocation", { 0: 1, 1: 5 }, 1)).toBe("0[.]1,1[.]5");
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

  it.each(cases)("%s: decode(encode(x)) === x — текущий формат", (type, answer) => {
    expect(
      decodeLearnerResponse(type, encodeLearnerResponse(type, answer as never), RESPONSE_FORMAT_VERSION),
    ).toEqual(answer);
  });

  it.each(cases)("%s: decode(encode(x)) === x — исходный формат", (type, answer) => {
    // Обе ветки разбора обязаны оставаться парными: выданные пакеты шлют старый формат вечно.
    expect(
      decodeLearnerResponse(type, encodeLearnerResponse(type, answer as never, 1), 1),
    ).toEqual(answer);
  });
});
