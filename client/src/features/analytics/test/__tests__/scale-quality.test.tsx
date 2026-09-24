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
  it("печатает согласованность шкалы с составом расчёта", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);

    expect(screen.getByText("Эмоциональное истощение")).toBeTruthy();
    expect(screen.getByText(/Согласованность 0,81/)).toBeTruthy();
    expect(screen.getByText(/9 пунктов/)).toBeTruthy();
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

  it("без шкал ничего не выдумывает", () => {
    render(<ScaleQualityPanel scales={[]} />);
    expect(screen.getByText(/Шкал, по которым набраны наблюдения, в этом тесте нет/)).toBeTruthy();
  });
});
