/**
 * @module features/analytics/slices/__tests__/slice-compare
 * @description PRD-56 FR-07, FR-07a, FR-07g: режим сравнения срезов.
 *
 * Сравнение — отдельный режим с ЯВНО названными срезами: их имена стоят в заголовках столбцов,
 * и читателю не приходится держать в голове, что с чем сравнивается. Отсюда два правила,
 * которые здесь и проверяются: «Разница» появляется только при двух срезах и только у ДОЛЕЙ,
 * а сравнивать можно не больше четырёх.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SliceCompare } from "../slice-compare";

const SLICES = [
  {
    id: "whole", name: "Тест целиком", conditions: {},
    started: 40, completed: 36, passed: 27, participants: 36,
    passRate: 75, avgPercent: 71, enoughData: true,
  },
  {
    id: "s1", name: "Розница", conditions: { groupIds: ["g1"] },
    started: 20, completed: 18, passed: 15, participants: 18,
    passRate: 83, avgPercent: 78, enoughData: true,
  },
  {
    id: "s2", name: "Отдел продаж", conditions: { groupIds: ["g2"] },
    started: 22, completed: 20, passed: 12, participants: 20,
    passRate: 60, avgPercent: 64, enoughData: true,
  },
  {
    id: "s3", name: "Логистика", conditions: { groupIds: ["g3"] },
    started: 14, completed: 12, passed: 8, participants: 12,
    passRate: 67, avgPercent: 69, enoughData: true,
  },
  {
    id: "s4", name: "Подрядчики", conditions: { groupIds: ["g4"] },
    started: 16, completed: 15, passed: 9, participants: 15,
    passRate: 60, avgPercent: 62, enoughData: true,
  },
];

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ slices: SLICES, minObservations: 10 }),
  }));
});

afterEach(() => vi.unstubAllGlobals());

/** Выбрать срез в списке доступных. */
async function pick(name: string) {
  await userEvent.click(await screen.findByRole("button", { name: `Добавить срез: ${name}` }));
}

describe("SliceCompare", () => {
  it("называет сравниваемые срезы в заголовках столбцов", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await pick("Отдел продаж");

    const table = screen.getByRole("table");
    expect(within(table).getByText("Розница")).toBeTruthy();
    expect(within(table).getByText("Отдел продаж")).toBeTruthy();
  });

  it("показывает «Разницу» при двух срезах и только у долей", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await pick("Отдел продаж");

    const table = screen.getByRole("table");
    expect(within(table).getByText("Разница")).toBeTruthy();
    // Доли: 83 − 60 = 23 п.п., 78 − 64 = 14 п.п.
    expect(within(table).getByText("+23 п.п.")).toBeTruthy();
    expect(within(table).getByText("+14 п.п.")).toBeTruthy();
    // Объёмы не вычитаются: разница чисел говорит о размере группы, а не о качестве.
    expect(within(table).queryByText("−2")).toBeNull();
  });

  it("убирает «Разницу», когда срезов становится три", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await pick("Отдел продаж");
    await pick("Логистика");

    expect(within(screen.getByRole("table")).queryByText("Разница")).toBeNull();
  });

  it("не даёт сравнивать больше четырёх срезов и говорит почему", async () => {
    render(<SliceCompare testId="test1" />);

    for (const name of ["Розница", "Отдел продаж", "Логистика", "Подрядчики"]) await pick(name);

    // FR-07g: кнопка ВЫКЛЮЧАЕТСЯ, а не исчезает — исчезнувшая читается как «больше срезов
    // нет», а выключенная с подписью объясняет, почему пятый не добавить.
    expect(screen.getByRole("button", { name: /Добавить срез: Тест целиком/ }))
      .toBeDisabled();
    expect(screen.getByText(/Сравнивают не больше четырёх/i)).toBeTruthy();
  });

  it("сравнивает с тестом целиком тем же механизмом (FR-07a)", async () => {
    render(<SliceCompare testId="test1" />);

    await pick("Тест целиком");
    await pick("Розница");

    const table = screen.getByRole("table");
    expect(within(table).getByText("Тест целиком")).toBeTruthy();
  });

  it("ничего не сравнивает, пока срезы не выбраны", async () => {
    render(<SliceCompare testId="test1" />);

    await waitFor(() => expect(screen.getByText(/Выберите срезы/i)).toBeTruthy());
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("не считает разницу там, где у среза мало данных", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        slices: [
          SLICES[1],
          { ...SLICES[2], passRate: null, avgPercent: null, enoughData: false, completed: 4 },
        ],
        minObservations: 10,
      }),
    }));

    render(<SliceCompare testId="test1" />);

    await pick("Розница");
    await pick("Отдел продаж");

    const table = screen.getByRole("table");
    expect(within(table).getAllByText(/мало данных/i).length).toBeGreaterThan(0);
    expect(within(table).queryByText(/п\.п\./)).toBeNull();
  });
});
