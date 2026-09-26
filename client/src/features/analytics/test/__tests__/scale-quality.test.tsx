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
      "Вклад", "Корреляция с остатком шкалы", "Распределение ответов", "Качество пункта",
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

  it("мёртвый пункт назван и несёт число, которое его вызвало (FR-50)", () => {
    render(<ScaleQualityPanel scales={[scale({
      items: [item({ questionId: "s2", prompt: "Все отвечают одинаково", dead: true, distribution: [0.01, 0.02, 0.94, 0.02, 0.01] })],
    })]} />);

    expect(screen.getByText("Мёртвый пункт")).toBeTruthy();
    // Подпись — дословно из эскиза wf-scales: «94 % в одной градации».
    expect(screen.getByText("94 % в одной градации")).toBeTruthy();
    expect(screen.queryByText("Работает")).toBeNull();
  });

  it("здоровый пункт помечен «Работает», как в эскизе, а не прочерком", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);
    expect(screen.getByText("Работает")).toBeTruthy();
  });

  it("без связи с остатком шкалы «Работает» не утверждается", () => {
    render(<ScaleQualityPanel scales={[scale({ items: [item({ questionId: "s1", prompt: "Пункт", itemRest: null })] })]} />);
    expect(screen.queryByText("Работает")).toBeNull();
  });

  describe("колонка «Вклад»", () => {
    it("печатает знак и шаг: «+1» и «−1» с типографским минусом", () => {
      render(<ScaleQualityPanel scales={[scale({
        items: [
          item({ questionId: "s1", prompt: "Прямой пункт", contribution: { value: 1, exact: true } }),
          item({ questionId: "s2", prompt: "Обратный пункт", contribution: { value: -1, exact: true } }),
        ],
      })]} />);

      expect(screen.getByText("+1")).toBeTruthy();
      // U+2212, а не дефис: в колонке чисел дефис читается как прочерк.
      expect(screen.getByText("−1")).toBeTruthy();
      expect(screen.queryByText("-1")).toBeNull();
    });

    it("дробный и неравномерный вклад — с запятой и знаком приближения", () => {
      render(<ScaleQualityPanel scales={[scale({
        items: [
          item({ questionId: "s1", prompt: "Половинный", contribution: { value: 0.5, exact: true } }),
          item({ questionId: "s2", prompt: "Неравномерный", contribution: { value: -0.8, exact: false } }),
        ],
      })]} />);

      expect(screen.getByText("+0,5")).toBeTruthy();
      expect(screen.getByText("≈−0,8")).toBeTruthy();
    });

    it("вклад, не выражаемый одним числом, — прочерк, а не выдуманное число", () => {
      render(<ScaleQualityPanel scales={[scale({
        items: [item({ questionId: "s1", prompt: "Выбор без порядка", contribution: null })],
      })]} />);

      const cells = screen.getByText("Выбор без порядка").closest("tr")!.querySelectorAll("td");
      // Прочерк, а причина — в подсказке ячейки.
      expect(cells[1].textContent?.startsWith("—")).toBe(true);
      expect(cells[1].textContent).toContain("одним числом не выражается");
    });

    it("колонки пунктов идут в порядке эскиза", () => {
      render(<ScaleQualityPanel scales={[scale()]} />);
      // Первые пять заголовков — сводка «Шкалы методики», следующие — карточка пунктов шкалы.
      const headers = screen.getAllByRole("columnheader").slice(5).map(h => h.textContent ?? "");
      const expected = ["Пункт", "Вклад", "Корреляция с остатком шкалы", "Распределение ответов", "Качество пункта"];
      expect(headers).toHaveLength(expected.length);
      expected.forEach((term, i) => expect(headers[i].startsWith(term), term).toBe(true));
    });
  });

  it("обе таблицы — в фиксированной раскладке, без горизонтальной прокрутки", () => {
    render(<ScaleQualityPanel scales={[scale()]} />);
    expect(document.querySelectorAll(".ou-grid.tb-psy-grid")).toHaveLength(2);
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
