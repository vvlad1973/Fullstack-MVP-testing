/**
 * @module features/analytics/test/__tests__/scale-quality
 * @description PRD-66 FR-29 — FR-32: качество измерительных шкал.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ScaleQualityPanel, type ScaleItemRow, type ScaleQualityRow } from "../scale-quality";

function item(over: Partial<ScaleItemRow> & Pick<ScaleItemRow, "questionId" | "prompt">): ScaleItemRow {
  return {
    observations: 120,
    itemRest: 0.52,
    distribution: [0.1, 0.2, 0.4, 0.2, 0.1],
    gradeLabels: ["Никогда", "Редко", "Иногда", "Часто", "Всегда"],
    dead: false,
    againstScale: false,
    alphaIfMirrored: null,
    ...over,
  };
}

function scale(over: Partial<ScaleQualityRow> = {}): ScaleQualityRow {
  return {
    scaleKey: "burnout",
    label: "Эмоциональное истощение",
    reliability: { alpha: 0.81, items: 9, respondents: 120, totalSd: 6.4, dichotomous: false },
    respondents: 120,
    ipsative: false,
    items: [item({ questionId: "s1", prompt: "Я чувствую себя опустошённым" })],
    ...over,
  };
}

describe("ScaleQualityPanel", () => {
  it("сводка «Шкалы методики» печатает согласованность шкалы с составом расчёта", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);

    expect(screen.getByText("Шкалы методики")).toBeTruthy();
    expect(screen.getByText("Эмоциональное истощение")).toBeTruthy();
    expect(screen.getByText("0,81")).toBeTruthy();
    expect(screen.getByText("9")).toBeTruthy();
    expect(screen.getByText("Хорошо")).toBeTruthy();
    expect(screen.getByText("Пункты шкалы «Эмоциональное истощение»")).toBeTruthy();
  });

  it("альфа ниже порога — вывод называет порог и пункты против шкалы", () => {
    render(<ScaleQualityPanel scales={[scale({
      reliability: { alpha: 0.64, items: 5, respondents: 120, totalSd: 4, dichotomous: false },
      items: [item({ questionId: "s3", prompt: "Обратный пункт", itemRest: -0.44, againstScale: true })],
    })]} />);

    expect(screen.getByText("Ниже приемлемого")).toBeTruthy();
    expect(screen.getByText("порог 0,70; 1 пункт против шкалы")).toBeTruthy();
  });

  it("заголовки называют термины по эскизу и несут подсказки (FR-14b)", () => {
    const { container } = render(<ScaleQualityPanel scales={[scale()]} />);

    for (const term of [
      "Пунктов", "Альфа Кронбаха", "n", "Вывод по шкале",
      "Корреляция с остатком шкалы", "Распределение ответов", "Качество пункта",
    ]) {
      const label = screen.getByText(term);
      const tip = label.closest(".ou-tip");
      expect(tip, term).not.toBeNull();
      expect(tip!.querySelector(".ou-tip__bubble")?.textContent, term).toBeTruthy();
      // Значок — псевдоэлемент термина и держится при последнем слове (см. term-hint.tsx).
      expect(label.classList.contains("tb-term-hint__term"), term).toBe(true);
    }
    expect(screen.queryByText("Признак")).toBeNull();
    expect(screen.queryByText("Связь с остатком шкалы")).toBeNull();
    // Подсказка распределения перечисляет градации самого вопроса.
    expect(container.textContent).toContain("Доли участников по градациям ответа этого вопроса: Никогда, Редко, Иногда, Часто, Всегда.");
  });

  it("причину отсутствия согласованности называет словами", () => {
    render(<ScaleQualityPanel scales={[scale({ reliability: "no-variance" })]} />);
    expect(screen.getByText(/все ответили одинаково/)).toBeTruthy();
  });

  it("признак пункта называет ПОВЕДЕНИЕ, а следствие даёт числом (FR-31a, FR-31b)", () => {
    // «Вклад не перевёрнут» — догадка о причине, которую расчёт проверить не может. Признак
    // говорит, что видно: пункт ведёт себя противоположно шкале.
    render(<ScaleQualityPanel scales={[scale({
      items: [item({
        questionId: "s3",
        prompt: "Обратный пункт",
        itemRest: -0.31,
        againstScale: true,
        alphaIfMirrored: 0.9,
      })],
    })]} />);

    expect(screen.getByText("Работает против шкалы")).toBeTruthy();
    expect(screen.getByText(/с вкладом −1 альфа 0,81 → 0,90/)).toBeTruthy();
  });

  it("мёртвый пункт назван и объяснён", () => {
    render(<ScaleQualityPanel scales={[scale({
      items: [item({ questionId: "s2", prompt: "Все отвечают одинаково", dead: true, distribution: [0, 0, 0.95, 0.05, 0] })],
    })]} />);

    expect(screen.getByText("Мёртвый пункт")).toBeTruthy();
    expect(screen.getByText(/почти все ответили одинаково/)).toBeTruthy();
  });

  it("ипсативная методика помечается — альфа там занижена по построению", () => {
    render(<ScaleQualityPanel scales={[scale({ ipsative: true })]} />);
    expect(screen.getByText("Ипсативная методика")).toBeTruthy();
  });

  it("подписи градаций берутся у вопроса, а не придумываются", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);

    expect(screen.getByText("Никогда")).toBeTruthy();
    expect(screen.getByText("Всегда")).toBeTruthy();
  });

  it("при шести и более градациях словами подписаны только края (FR-30c)", () => {
    // Иначе подписи наезжают друг на друга и не читаются вовсе.
    render(<ScaleQualityPanel scales={[scale({
      items: [item({
        questionId: "s7",
        prompt: "Семибалльный пункт",
        distribution: [0.1, 0.1, 0.2, 0.2, 0.2, 0.1, 0.1],
        gradeLabels: ["Совсем нет", "2", "3", "4", "5", "6", "Полностью"],
      })],
    })]} />);

    expect(screen.getByText("Совсем нет")).toBeTruthy();
    expect(screen.getByText("Полностью")).toBeTruthy();
  });

  it("ДЛИННЫЕ градации подписываются номерами, а не текстом (FR-30b)", () => {
    // Правило «до пяти градаций — словами» писалось под шкалу Ликерта, где подпись в два
    // слова. У опросника с вариантами-предложениями та же подпись растягивает колонку на
    // тысячи пикселей и выталкивает за горизонтальную прокрутку связь с остатком и признак
    // (вскрыто на стенде). Читаемость решает ДЛИНА подписи, а не только их число.
    const long = "Я помогаю команде сфокусироваться на главном и направляю наши усилия на то, чтобы цели были достигнуты в срок";
    render(<ScaleQualityPanel scales={[scale({
      items: [item({
        questionId: "s8",
        prompt: "Пункт с длинными вариантами",
        distribution: [0.5, 0.3, 0.2],
        gradeLabels: [long, "Я призываю коллег к открытому обсуждению проблем", "Я предлагаю вернуться к плану"],
      })],
    })]} />);

    // Подпись под столбиком — номер градации; полный текст остаётся в подсказке строки.
    expect(screen.queryByText(long)).toBeNull();
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("3")).toBeTruthy();
  });

  it("короткие градации по-прежнему подписаны словами", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);
    expect(screen.getByText("Никогда")).toBeTruthy();
    expect(screen.getByText("Всегда")).toBeTruthy();
  });

  it("без шкал ничего не выдумывает", () => {
    render(<ScaleQualityPanel scales={[]} />);
    expect(screen.getByText(/Шкал, по которым набраны наблюдения, в этом тесте нет/)).toBeTruthy();
  });
});
