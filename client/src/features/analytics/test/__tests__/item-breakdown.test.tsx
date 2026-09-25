/**
 * @module features/analytics/test/__tests__/item-breakdown
 * @description PRD-66 FR-24 — FR-27: карточка разбора задания.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ItemBreakdownPanel, type ItemBreakdownView, type OptionRow } from "../item-breakdown";

function option(over: Partial<OptionRow> & Pick<OptionRow, "index" | "label">): OptionRow {
  return {
    correct: false,
    share: 0.2,
    bottomShare: 0.3,
    topShare: 0.1,
    restCorrelation: -0.18,
    dead: false,
    inverted: false,
    ...over,
  };
}

function view(over: Partial<ItemBreakdownView> = {}): ItemBreakdownView {
  return {
    questionId: "q1",
    prompt: "Какая мера относится к антикоррупционным?",
    questionType: "single",
    item: {
      observations: 268,
      difficulty: 0.41,
      correctedDifficulty: 0.21,
      itemRest: 0.34,
      discrimination: 0.38,
      declaredDifficulty: 60,
      timing: { medianMs: 48_000, q1Ms: 31_000, q3Ms: 82_000, measured: 244 },
    },
    groups: { size: 72, share: 0.27, topDifficulty: 0.68, bottomDifficulty: 0.19 },
    options: [
      option({ index: 0, label: "Проверка контрагента", correct: true, share: 0.41, bottomShare: 0.19, topShare: 0.68, restCorrelation: 0.34 }),
      option({ index: 1, label: "Согласование подарка", share: 0.34, bottomShare: 0.46, topShare: 0.21 }),
      option({ index: 2, label: "Бумажный журнал", share: 0.01, bottomShare: 0.02, topShare: 0, restCorrelation: null, dead: true }),
    ],
    ...over,
  };
}

describe("ItemBreakdownPanel", () => {
  it("показывает величины задания плитками в одном ряду", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    expect(screen.getByText("Трудность")).toBeTruthy();
    expect(screen.getByText("С поправкой на угадывание")).toBeTruthy();
    expect(screen.getByText("Дискриминативность (r)")).toBeTruthy();
    expect(screen.getByText("Индекс дискриминации (D)")).toBeTruthy();
    expect(screen.getByText("Время, медиана")).toBeTruthy();
  });

  it("плитка поправки не рисуется там, где поправка неприменима", () => {
    // У сопоставления и ранжирования вероятность случайного попадания невычислима: пустая
    // плитка читалась бы как «ноль», а это утверждение (FR-17a).
    render(<ItemBreakdownPanel view={view({
      item: { ...view().item, correctedDifficulty: null },
    })} onBack={() => {}} />);

    expect(screen.queryByText("С поправкой на угадывание")).toBeNull();
  });

  it("называет крайние группы их размером, а не «четвертями»", () => {
    // 27 % — не четверть, и подменять число словом нельзя (FR-26).
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    expect(screen.getByText(/Слабые 27 %/)).toBeTruthy();
    expect(screen.getByText(/Сильные 27 %/)).toBeTruthy();
  });

  it("сравнивает замысел автора с наблюдением в ОДНОЙ шкале и делает вывод (FR-18a)", () => {
    // Автор задаёт сложность «0 — легко, 100 — сложно», а трудность p — доля решивших, где 1 —
    // легко. Раньше рядом стояли «60 → 41», будто сравнимые числа; наблюдение переводится в шкалу
    // автора: 100 × (1 − 0,41) = 59.
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);
    expect(screen.getByText("60 → 59")).toBeTruthy();
    expect(screen.getByText("расхождения нет")).toBeTruthy();
  });

  it("задание оказалось легче задуманного — так и сказано", () => {
    // «Как расшифровывается ЭДО?»: задумано лёгким (20), решают 97 %.
    render(<ItemBreakdownPanel view={view({ item: { ...view().item, declaredDifficulty: 60, difficulty: 0.9 } })} onBack={() => {}} />);
    expect(screen.getByText("60 → 10")).toBeTruthy();
    expect(screen.getByText("легче задуманного на 50")).toBeTruthy();
  });

  it("задание оказалось труднее задуманного — так и сказано", () => {
    render(<ItemBreakdownPanel view={view({ item: { ...view().item, declaredDifficulty: 20, difficulty: 0.4 } })} onBack={() => {}} />);
    expect(screen.getByText("20 → 60")).toBeTruthy();
    expect(screen.getByText("труднее задуманного на 40")).toBeTruthy();
  });

  it("поправка на угадывание называет число вариантов, ожидание и ограничение модели (FR-17b)", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);
    expect(screen.getByText("3 варианта, ожидание 0,33")).toBeTruthy();
    // Формула исходит из «знает или выбирает наугад» — частичного знания она не описывает.
    expect(screen.getByText(/частичное знание не учитывает/)).toBeTruthy();
  });

  it("у задания без заявленной трудности сравнивать не с чем — плитки нет", () => {
    // «Расхождения нет» и «сравнивать не с чем» — разные состояния (FR-18).
    render(<ItemBreakdownPanel view={view({
      item: { ...view().item, declaredDifficulty: null },
    })} onBack={() => {}} />);

    expect(screen.queryByText("Замысел и наблюдение")).toBeNull();
  });

  it("верный вариант и мёртвый дистрактор названы признаками", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    expect(screen.getByText("Верный ответ")).toBeTruthy();
    expect(screen.getByText("Мёртвый вариант")).toBeTruthy();
  });

  it("для типа без вариантов разбор не выдумывается (FR-27)", () => {
    render(<ItemBreakdownPanel view={view({ options: null })} onBack={() => {}} />);

    expect(screen.getByText(/разбор вариантов не применяется/)).toBeTruthy();
    expect(screen.queryByText("Верный ответ")).toBeNull();
  });

  it("время печатается медианой и размахом, а не средним", () => {
    render(<ItemBreakdownPanel view={view()} onBack={() => {}} />);

    expect(screen.getByText("0:48")).toBeTruthy();
    expect(screen.getByText(/половина ответов 0:31 — 1:22/)).toBeTruthy();
  });
});

/**
 * PRD-66 FR-49: разбор задания — три блока и ничего между ними: ряд плиток, таблица вариантов,
 * таблица версий содержания. Версии — последними: это разрез ВЫБОРКИ, а не свойство задания.
 */
describe("ItemBreakdownPanel — порядок блоков (FR-49)", () => {
  const versions = [
    { psychoHash: "a1b2c3d4e5", observations: 120, difficulty: 0.4, firstAt: "2026-09-01T00:00:00Z", lastAt: "2026-09-10T00:00:00Z" },
    { psychoHash: "f6e5d4c3b2", observations: 148, difficulty: 0.55, firstAt: "2026-09-11T00:00:00Z", lastAt: "2026-09-20T00:00:00Z" },
  ];

  it("варианты ответа идут раньше версий содержания", () => {
    render(<ItemBreakdownPanel
      view={view({ versions } as never)}
      onBack={() => {}}
      onSelectVersion={() => {}}
    />);

    const options = screen.getByText("Варианты ответа");
    const versionsTitle = screen.getByText(/Редакции содержания|Версии содержания/);
    expect(options.compareDocumentPosition(versionsTitle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
