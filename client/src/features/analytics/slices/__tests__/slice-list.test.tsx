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
    expect(screen.getByText("12")).toBeTruthy();
    expect(screen.getByText("14")).toBeTruthy();
  });

  // FR-06 называет «назначено» и слабейшую тему наравне с объёмами. Обе величины бывают
  // неопределимы, и тогда экран обязан сказать прочерк, а не выдумать ноль или «первую попавшуюся
  // тему»: по оси номера попытки назначать нечего, а тема ниже порога наблюдений — шум.
  it("показывает «Назначено» и слабейшую тему, а где их нет — прочерк", async () => {
    fetchMock.mockResolvedValue(answer([
      {
        ...SLICE,
        assigned: 18,
        weakest: { topicId: "t2", topicName: "Право", correctShare: 46, inSample: 12 },
      },
      { ...SLICE, id: "s3", name: "Вторая попытка", assigned: null, weakest: null },
    ]));

    render(<SliceList testId="test1" axis="group" />);

    expect(await screen.findByText("Назначено")).toBeTruthy();
    expect(screen.getByText("Слабейшая тема")).toBeTruthy();
    expect(screen.getByText("18")).toBeTruthy();
    expect(screen.getByText("Право · 46 %")).toBeTruthy();
    // Строка без обеих величин: два прочерка, а не «0» и не пустая ячейка.
    expect(screen.getAllByText("—").length).toBe(2);
  });

  // Эскиз PRD-56: колонки «Участников» в списке нет — число людей среза видно в реестре по
  // переходу, а рядом с «Начато» и «Завершено» оно читалось как третий объём того же рода.
  it("не показывает колонку «Участников»", async () => {
    render(<SliceList testId="test1" />);

    await screen.findByText("Отдел продаж");
    expect(screen.queryByText("Участников")).toBeNull();
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

  // FR-24: реестр отвечает «кто эти люди», аналитика теста — «что у них не получилось».
  // Условия среза едут в оба перехода, иначе на той стороне их пришлось бы набирать заново.
  it("ведёт из строки в аналитику теста с условиями этого среза", async () => {
    const onOpenTestAnalytics = vi.fn();
    fetchMock.mockResolvedValue(answer([SLICE]));

    render(
      <SliceList testId="test1" axis="group" onOpenTestAnalytics={onOpenTestAnalytics} />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Аналитика теста" }));

    expect(onOpenTestAnalytics).toHaveBeenCalledWith({ groupIds: ["g1"] });
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

/**
 * Эскиз PRD-56 (задача 2.3 плана сверки): колонки фактов сортируются, «Слабейшая тема» — нет.
 * «Мало данных» и неприменимое «Назначено» уходят в конец в обоих направлениях: пустое не
 * меньше и не больше числа.
 */
describe("SliceList — сортировка", () => {
  const ROWS = [
    { ...SLICE, id: "a", name: "Бета", passRate: 60, assigned: 30 },
    { ...SLICE, id: "b", name: "Альфа", passRate: 90, assigned: null },
    { ...SCARCE, id: "c", name: "Гамма", assigned: 5 },
    { ...SLICE, id: "d", name: "Вега", passRate: 40, assigned: 10 },
  ];
  const order = () => screen.getAllByText(/^(Альфа|Бета|Вега|Гамма)$/).map(el => el.textContent);
  const clickHeader = async (title: string) => {
    const header = screen.getAllByText(title).find(el => el.closest(".ou-grid__th")) as HTMLElement;
    await userEvent.click(header);
  };

  beforeEach(() => fetchMock.mockResolvedValue(answer(ROWS)));

  it("по умолчанию — порядок сервера", async () => {
    render(<SliceList testId="test1" />);
    await screen.findByText("Альфа");
    expect(order()).toEqual(["Бета", "Альфа", "Гамма", "Вега"]);
  });

  it("шесть колонок сортируемы, «Слабейшая тема» — нет", async () => {
    render(<SliceList testId="test1" />);
    await screen.findByText("Альфа");
    const sortable = [...document.querySelectorAll(".ou-grid__th.is-sortable")].map(el => el.textContent);
    expect(sortable).toEqual(["Срез", "Назначено", "Начато", "Завершено", "Сдали", "Средний результат"]);
  });

  it("«Сдали» — по доле, «мало данных» последним в обоих направлениях", async () => {
    render(<SliceList testId="test1" />);
    await screen.findByText("Альфа");

    await clickHeader("Сдали");
    expect(order()).toEqual(["Вега", "Бета", "Альфа", "Гамма"]);
    await clickHeader("Сдали");
    expect(order()).toEqual(["Альфа", "Бета", "Вега", "Гамма"]);
  });

  it("«Срез» — по алфавиту, «Назначено» — прочерк последним", async () => {
    render(<SliceList testId="test1" />);
    await screen.findByText("Альфа");

    await clickHeader("Срез");
    expect(order()).toEqual(["Альфа", "Бета", "Вега", "Гамма"]);
    await clickHeader("Назначено");
    expect(order()).toEqual(["Гамма", "Вега", "Бета", "Альфа"]);
  });
});
