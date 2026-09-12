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

  it("читает время на задании — это материал анализа пунктов, а не украшение", () => {
    const sheet = SHEET.map((r) => [...r]);
    sheet[2][10] = "47";
    const [row] = parseLmsExport(sheet).rows;
    expect(row.latencySeconds["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBe(47);
  });

  it("пустая колонка длительности — это отсутствие измерения, а не ноль", () => {
    // Пакеты, собранные до измерения времени, шлют пусто: «0 секунд» было бы выдумкой.
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.latencySeconds["80a5957f-cdc7-4490-b4c9-bcedcb973c26"]).toBeUndefined();
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

describe("версия формата ответов", () => {
  /** Та же выгрузка плюс служебный блок версии, как его шлёт пакет после выравнивания. */
  function withVersion(value: string): string[][] {
    const sheet = SHEET.map((r) => [...r]);
    sheet[0].push("meta_response_format", "", "", "");
    sheet[1].push("Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ");
    sheet[2].push("другое", "", "neutral", value);
    return sheet;
  }

  it("версия читается СТРОКОЙ, а не файлом", () => {
    // В одном отчёте лежат прохождения, собранные разными версиями пакета: колонка общая,
    // значение — своё у каждого участника.
    const [row] = parseLmsExport(withVersion("2")).rows;
    expect(row.responseFormat).toBe(2);
  });

  it("отсутствие блока версии — это исходный формат", () => {
    const [row] = parseLmsExport(SHEET).rows;
    expect(row.responseFormat).toBeNull();
  });

  it("пустая ячейка версии у старого прохождения — тоже исходный формат", () => {
    const [row] = parseLmsExport(withVersion("")).rows;
    expect(row.responseFormat).toBeNull();
  });

  it("служебный блок версии не попадает в неопознанные колонки", () => {
    // Иначе импорт предупреждал бы «пакет собран под другой версией теста» на каждой выгрузке.
    expect(parseLmsExport(withVersion("2")).unknownColumns).toEqual([]);
  });
});
