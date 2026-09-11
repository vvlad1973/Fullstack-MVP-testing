/**
 * @module shared/lms-export/__tests__/parse
 */
import { describe, it, expect } from "vitest";
import { looksLikeLmsExport, parseLmsExport } from "../parse";

/** Шапка и строка по образцу docs/references/7684237229762827328-1.xlsx, урезанные до двух блоков. */
const SHEET: string[][] = [
  [
    "Пользователь", "Код", "Организация", "Подразделение", "Должность",
    "Дата активации курса", "Дата активации модуля", "Статус", "Баллы",
    "q_80a5957f-cdc7-4490-b4c9-bcedcb973c26", "", "", "",
    "scale_cel", "", "", "",
    "var_lead_margin", "", "", "",
  ],
  [
    "", "", "", "", "", "", "", "", "",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
    "Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ",
  ],
  [
    "Контента Контроль", "", "ПАО \"Ростелеком\"", "", "",
    "2026-09-09T13:35:00.000Z", "2026-09-09T13:39:00.000Z", "Пройден", "0",
    "другое", "", "neutral", "0[.]1,1[.]5,2[.]1,3[.]0",
    "другое", "", "neutral", "29",
    "другое", "", "neutral", "6",
  ],
];

describe("looksLikeLmsExport", () => {
  it("узнаёт выгрузку по четвёрке подколонок и префиксам", () => {
    expect(looksLikeLmsExport(SHEET)).toBe(true);
  });

  it("не принимает книгу теста за выгрузку", () => {
    expect(looksLikeLmsExport([["Текст вопроса", "Тип", "Тема"], ["Что такое X?", "single", "Основы"]])).toBe(false);
  });
});

describe("parseLmsExport", () => {
  it("собирает идентификаторы вопросов, шкал и показателей", () => {
    const book = parseLmsExport(SHEET);
    expect(book.questionIds).toEqual(["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]);
    expect(book.scaleKeys).toEqual(["cel"]);
    expect(book.variableNames).toEqual(["lead_margin"]);
  });

  it("читает служебные поля строки", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.participantName).toBe("Контента Контроль");
    expect(row.org).toBe('ПАО "Ростелеком"');
    expect(row.moduleActivatedAt).toBe("2026-09-09T13:39:00.000Z");
    expect(row.passed).toBe(true);
    expect(row.points).toBe(0);
  });

  it("раскладывает взаимодействия по видам", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.answers["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBe("0[.]1,1[.]5,2[.]1,3[.]0");
    expect(row.results["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBe("neutral");
    expect(row.scales.cel).toBe(29);
    expect(row.variables.lead_margin).toBe("6");
  });

  it("складывает неопознанные блоки отдельно, не роняя разбор", () => {
    const sheet = SHEET.map((r) => [...r]);
    sheet[0][9] = "topic_abc_level";
    const book = parseLmsExport(sheet);
    expect(book.questionIds).toEqual([]);
    expect(book.unknownColumns).toEqual(["topic_abc_level"]);
  });
});
