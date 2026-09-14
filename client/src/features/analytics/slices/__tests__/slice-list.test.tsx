/**
 * @module features/analytics/slices/__tests__/slice-list
 * @description PRD-56 FR-06, FR-06c, FR-06d, FR-08: список срезов.
 *
 * Список показывает ФАКТЫ: объёмы, долю сдавших, средний результат. Отклонений от невидимой на
 * экране величины в нём нет — из-за них понятие «база» из продукта и убрали. Ниже порога
 * наблюдений процент не печатается вовсе: «33 % сдали» на трёх прохождениях — шум, по которому
 * принимают решения о людях.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SliceList } from "../slice-list";

const SLICE = {
  id: "s1",
  name: "Отдел продаж",
  conditions: { groupIds: ["g1"] },
  started: 14,
  completed: 12,
  passed: 9,
  participants: 12,
  passRate: 75,
  avgPercent: 71.5,
  enoughData: true,
};

const SCARCE = {
  ...SLICE,
  id: "s2",
  name: "Информационная безопасность",
  started: 3, completed: 3, passed: 1, participants: 3,
  passRate: null, avgPercent: null, enoughData: false,
};

let fetchMock: ReturnType<typeof vi.fn>;

function answer(slices: unknown[]) {
  return { ok: true, json: async () => ({ slices, minObservations: 10 }) };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(answer([SLICE]));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

/** Условия последнего запроса к ручке срезов. */
function lastQuery(): URLSearchParams {
  const url = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
  return new URLSearchParams(url.slice(url.indexOf("?")));
}

describe("SliceList", () => {
  it("показывает объёмы и проценты среза", async () => {
    render(<SliceList testId="test1" />);

    expect(await screen.findByText("Отдел продаж")).toBeTruthy();
    expect(screen.getByText("75 %")).toBeTruthy();
    expect(screen.getByText("72 %")).toBeTruthy();
    // Завершённых и участников поровну — оба числа на месте, сколько бы их ни совпало.
    expect(screen.getAllByText("12")).toHaveLength(2);
    expect(screen.getByText("14")).toBeTruthy();
  });

  it("ниже порога говорит «мало данных» и оставляет объём", async () => {
    fetchMock.mockResolvedValue(answer([SCARCE]));

    render(<SliceList testId="test1" />);

    expect((await screen.findAllByText(/мало данных/i)).length).toBeGreaterThan(0);
    // Объём виден: он и есть то, что читатель должен увидеть вместо процента.
    expect(screen.getAllByText("3").length).toBeGreaterThan(0);
    expect(screen.queryByText("33 %")).toBeNull();
  });

  it("не показывает отклонений: сравнивать здесь не с чем", async () => {
    render(<SliceList testId="test1" />);

    await screen.findByText("Отдел продаж");
    expect(screen.queryByText(/Разница|Отклонение|к базе/i)).toBeNull();
  });

  it("передаёт рамку расчёта: тест и период", async () => {
    render(<SliceList testId="test1" from="2026-09-01" to="2026-09-30" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastQuery().get("testId")).toBe("test1");
    expect(lastQuery().get("from")).toBe("2026-09-01");
    expect(lastQuery().get("to")).toBe("2026-09-30");
  });

  it("разбивает по выбранной оси", async () => {
    render(<SliceList testId="test1" axis="group" />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastQuery().get("axis")).toBe("group");
  });

  it("ведёт из строки в реестр с условиями этого среза", async () => {
    const onOpenRegistry = vi.fn();
    render(<SliceList testId="test1" onOpenRegistry={onOpenRegistry} />);

    await userEvent.click(await screen.findByRole("button", { name: /Прохождения: Отдел продаж/ }));

    expect(onOpenRegistry).toHaveBeenCalledWith(SLICE.conditions);
  });

  it("говорит, когда срезов ещё нет", async () => {
    fetchMock.mockResolvedValue(answer([]));

    render(<SliceList testId="test1" />);

    expect(await screen.findByText(/Срезов пока нет/i)).toBeTruthy();
  });

  it("сообщает об ошибке, а не показывает пустой список как «данных нет»", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<SliceList testId="test1" />);

    expect(await screen.findByText(/Не удалось загрузить срезы/i)).toBeTruthy();
  });
});

describe("SliceList — разворот строки по темам (FR-06e)", () => {
  /** Ответ ручки тем: её зовут вторым запросом, при развороте. */
  const topicsAnswer = (topics: unknown[]) => ({ ok: true, json: async () => ({ topics }) });

  it("грузит темы только при развороте, а не вместе со списком", async () => {
    // Платить за темы всех срезов при каждом показе списка незачем: развёрнут за раз один.
    fetchMock.mockResolvedValueOnce(answer([SLICE]));
    render(<SliceList testId="t1" axis="group" />);
    await screen.findByText("Отдел продаж");

    expect(fetchMock).toHaveBeenCalledTimes(1);

    fetchMock.mockResolvedValueOnce(topicsAnswer([
      { topicId: "tp-1", topicName: "Бюджет", correctShare: 64, inSample: 12 },
    ]));
    await userEvent.click(screen.getByRole("button", { name: "Развернуть" }));

    await waitFor(() => expect(screen.getByText("Бюджет")).toBeTruthy());
    expect(screen.getByText("64 %")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Срез адресуется осью и ключом: условия реестра покрывают не всякую ось.
    expect(String(fetchMock.mock.calls[1][0])).toContain("axis=group");
  });

  it("повторный разворот той же строки второй раз не грузит", async () => {
    fetchMock.mockResolvedValueOnce(answer([SLICE]));
    render(<SliceList testId="t1" axis="group" />);
    await screen.findByText("Отдел продаж");
    fetchMock.mockResolvedValueOnce(topicsAnswer([
      { topicId: "tp-1", topicName: "Бюджет", correctShare: 64, inSample: 12 },
    ]));

    const chevron = screen.getByRole("button", { name: "Развернуть" });
    await userEvent.click(chevron);
    await waitFor(() => expect(screen.getByText("Бюджет")).toBeTruthy());
    await userEvent.click(screen.getByRole("button", { name: "Свернуть" }));
    await userEvent.click(screen.getByRole("button", { name: "Развернуть" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("срез без завершённых прохождений не разворачивается вовсе", async () => {
    // Раскрытие в пустоту читается как поломка, а не как «данных нет».
    fetchMock.mockResolvedValueOnce(answer([
      { ...SLICE, started: 2, completed: 0, passed: 0, participants: 2, enoughData: false },
    ]));
    render(<SliceList testId="t1" axis="group" />);
    await screen.findByText("Отдел продаж");

    expect(screen.queryByRole("button", { name: "Развернуть" })).toBeNull();
  });

  it("сбой расчёта тем говорит словами, а не пустой таблицей", async () => {
    fetchMock.mockResolvedValueOnce(answer([SLICE]));
    render(<SliceList testId="t1" axis="group" />);
    await screen.findByText("Отдел продаж");
    fetchMock.mockRejectedValueOnce(new Error("сеть"));

    await userEvent.click(screen.getByRole("button", { name: "Развернуть" }));

    await waitFor(() => expect(screen.getByText(/по темам считать нечего/i)).toBeTruthy());
  });
});
