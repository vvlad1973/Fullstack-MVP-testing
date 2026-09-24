/**
 * @module features/analytics/test/__tests__/item-quality
 * @description PRD-66: вкладка «Качество заданий».
 *
 * Проверяется то, что легко потерять при правке: термины в заголовках (а не пересказ),
 * признак-симптом с числами под ним, разные пороги у трудности и коэффициентов и то, что
 * невычислимое место остаётся пустым, а не нулевым.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { ItemQualityPanel, type ItemQualityRow, type ItemQualityView } from "../item-quality";

function row(over: Partial<ItemQualityRow> & Pick<ItemQualityRow, "questionId">): ItemQualityRow {
  return {
    observations: 150,
    difficulty: 0.55,
    correctedDifficulty: 0.4,
    itemRest: 0.35,
    discrimination: 0.42,
    declaredDifficulty: null,
    difficultyConfidence: "reliable",
    coefficientConfidence: "reliable",
    flags: { tooHard: false, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false },
    timingFlags: { rushed: false, slow: false },
    prompt: "Вопрос",
    topicName: "Тема",
    questionType: "single",
    ...over,
  };
}

function view(over: Partial<ItemQualityView> = {}): ItemQualityView {
  return {
    items: [row({ questionId: "q1" })],
    reliability: { alpha: 0.84, items: 42, respondents: 486, totalSd: 5.2, dichotomous: true },
    sem: 2.1,
    cutBand: null,
    sample: { respondents: 486, responses: 4860, bySource: { web: 210, telemetry: 244 }, unknownVersionShare: 0 },
    firstAttemptOnly: true,
    ...over,
  };
}

/**
 * PRD-66 FR-22: прогноз Спирмена-Брауна — сколько заданий добавить или снять ради надёжности
 * 0,80 (цель задана константой, решение владельца 2026-09-24).
 *
 * Прогноз живёт ПОДПИСЬЮ под надёжностью, а не своей плиткой: это совет к действию, а не
 * измеренная величина, и в ряду метрик он читался бы как ещё одно измерение.
 */
describe("ItemQualityPanel — прогноз длины (FR-22)", () => {
  it("говорит, сколько заданий добавить до целевой надёжности", () => {
    render(<ItemQualityPanel view={view({
      reliability: { alpha: 0.64, items: 20, respondents: 300, totalSd: 4.1, dichotomous: true },
      lengthForecast: { target: 0.8, factor: 2.25, itemsDelta: 25 },
    })} />);

    expect(screen.getByText(/до 0,80 — ещё 25 заданий/)).toBeTruthy();
  });

  it("у теста надёжнее целевого говорит, сколько заданий МОЖНО СНЯТЬ", () => {
    // Единственное число трека, которое разрешает сократить прогон участника: всё остальное
    // на экране только добавляет автору работы.
    render(<ItemQualityPanel view={view({
      lengthForecast: { target: 0.8, factor: 0.44, itemsDelta: -22 },
    })} />);

    expect(screen.getByText(/22 задания можно снять/)).toBeTruthy();
  });

  it("без прогноза строки нет вовсе", () => {
    render(<ItemQualityPanel view={view({ lengthForecast: null })} />);

    expect(screen.queryByText(/можно снять/)).toBeNull();
    expect(screen.queryByText(/до 0,80/)).toBeNull();
  });

  it("оговорка о качестве добавляемых заданий названа в «Терминах»", async () => {
    // Прогноз исходит из того, что новые задания будут такими же, как нынешние. На практике
    // они обычно хуже, поэтому число оптимистично, и умалчивать об этом нельзя.
    render(<ItemQualityPanel view={view()} />);
    await userEvent.click(screen.getByRole("button", { name: "Термины" }));

    expect(screen.getByText(/такого же качества/)).toBeTruthy();
  });
});

describe("ItemQualityPanel", () => {
  it("называет величины ТЕРМИНАМИ, а не пересказом", () => {
    // У величины есть имя, и методист заказчика должен его узнать: «Различает» вместо
    // «Дискриминативности» — придуманный оборот, которого нет ни в одном учебнике.
    render(<ItemQualityPanel view={view()} />);

    expect(screen.getByText("Надёжность (альфа)")).toBeTruthy();
    expect(screen.getByText("Ошибка измерения")).toBeTruthy();
    expect(screen.getByText("Трудность")).toBeTruthy();
    expect(screen.getByText("Дискриминативность")).toBeTruthy();
  });

  it("признак называет СИМПТОМ, а числа под ним — основание", () => {
    // «Ошибка в ключе» — догадка, которую расчёт проверить не может; она идёт подписью, а
    // заголовком стоит то, что видно в числах.
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1",
        itemRest: -0.21,
        discrimination: -0.14,
        flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false },
      })],
    })} />);

    expect(screen.getByText("Сильные ошибаются чаще")).toBeTruthy();
    // Числа под заголовком — основание признака: сам он причины не называет.
    expect(screen.getByText(/дискриминативность .?0,21, индекс .?0,14/)).toBeTruthy();
  });

  it("у задания с малой выборкой трудность видна, а коэффициент — нет", () => {
    // Два порога сосуществуют (FR-38a): трудность живёт при пороге инстанса, коэффициенты — с
    // тридцати наблюдений.
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1",
        observations: 12,
        difficulty: 0.33,
        difficultyConfidence: "reliable",
        coefficientConfidence: "insufficient",
      })],
    })} />);

    expect(screen.getByText("0,33")).toBeTruthy();
    expect(screen.getByText("мало данных")).toBeTruthy();
  });

  it("невычислимую величину печатает прочерком, а не нулём", () => {
    // Ноль в дискриминативности означал бы «задание никого не различает» — совсем другое
    // утверждение, чем «посчитать было не на чем».
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", itemRest: null, discrimination: null })],
    })} />);

    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });

  it("причину отсутствия надёжности называет словами", () => {
    render(<ItemQualityPanel view={view({ reliability: "no-variance", sem: null })} />);
    expect(screen.getByText(/все набрали поровну/)).toBeTruthy();
  });

  it("показывает состав выборки и режим попыток", () => {
    // Числа обязаны говорить, на чём они стоят: источник и режим попыток меняют их сильнее
    // любого фильтра.
    render(<ItemQualityPanel view={view()} />);

    expect(screen.getByText(/веб — 210/)).toBeTruthy();
    expect(screen.getByText(/телеметрия LMS — 244/)).toBeTruthy();
    expect(screen.getByText("только первая попытка")).toBeTruthy();
  });

  it("предупреждает, когда проходной балл попал внутрь интервала ошибки", () => {
    render(<ItemQualityPanel view={view({ cutBand: { low: 26.8, high: 31.2, z: 1.96, withinBand: 0 } })} />);
    expect(screen.getByText(/Проходной балл попадает внутрь интервала/)).toBeTruthy();
  });

  it("называет, скольких участников интервал задел на самом деле (FR-21a)", () => {
    // «Решение ненадёжно» без числа затронутых предупреждает ни о чём: двое из шестидесяти и
    // половина потока требуют разных действий.
    render(<ItemQualityPanel view={view({ cutBand: { low: 26.8, high: 31.2, z: 1.96, withinBand: 37 } })} />);

    // Знаменатель — участники с ПОЛНЫМ набором, по которым считалась надёжность, а не вся
    // выборка: при неравномерной выдаче это разные числа, и смешивать их в одной фразе нельзя.
    expect(screen.getByText(/Затронуто 37 из 486 участников с полным набором/)).toBeTruthy();
  });

  it("никого не задело — так и говорит, а не молчит", () => {
    // Молчание читалось бы как «не посчитали». Интервал у порога есть, но пока в него никто
    // не попал — это хорошая новость, и она стоит слов.
    render(<ItemQualityPanel view={view({ cutBand: { low: 26.8, high: 31.2, z: 1.96, withinBand: 0 } })} />);

    expect(screen.getByText(/в него не попал никто/)).toBeTruthy();
  });

  it("предупреждает о смешении сырых и предобезличенных выгрузок (FR-43)", () => {
    // Ключи участников в этих файлах считаются по-разному, один человек попадает в выборку
    // дважды, и число респондентов завышено. Это не «ослабленные показатели», а прямая
    // ошибка в составе выборки, поэтому баннер отдельный и тоном выше.
    render(<ItemQualityPanel view={view({
      bias: { unevenDelivery: false, importShare: 0.4, mixedAnonymity: true },
    })} />);

    expect(screen.getByText(/посчитаны дважды/i)).toBeTruthy();
  });

  it("без смешения такого баннера нет", () => {
    render(<ItemQualityPanel view={view({
      bias: { unevenDelivery: false, importShare: 0, mixedAnonymity: false },
    })} />);

    expect(screen.queryByText(/посчитаны дважды/i)).toBeNull();
  });

  it("доля невыданных наблюдений стоит рядом с трудностью задания (FR-41)", () => {
    // У выборки из импорта это и есть мера смещения `p`: трудность посчитана по тем, кто
    // задание видел, и чем больше невыданных, тем меньше выборка под числом.
    render(<ItemQualityPanel view={view({ items: [row({ questionId: "q1", missingShare: 0.31 })] })} />);

    expect(screen.getByText(/не выдано 31 %/)).toBeTruthy();
  });

  it("задание, выданное всем, доли не печатает — ноль там не о чем говорить", () => {
    render(<ItemQualityPanel view={view({ items: [row({ questionId: "q1", missingShare: 0 })] })} />);

    expect(screen.queryByText(/не выдано/)).toBeNull();
  });

  it("доля наблюдений с неизвестной редакцией выводится рядом с составом выборки", () => {
    render(<ItemQualityPanel view={view({
      sample: { respondents: 10, responses: 100, bySource: { import: 100 }, unknownVersionShare: 0.42 },
    })} />);

    expect(screen.getByText(/редакция неизвестна — 42 %/)).toBeTruthy();
  });

  it("кнопки выгрузок ведут на свои ручки", () => {
    render(<ItemQualityPanel view={view()} exportHref="/api/x/export" matrixHref="/api/x/matrix" />);

    expect(screen.getByText("Психометрический отчёт").closest("a")?.getAttribute("href")).toBe("/api/x/export");
    expect(screen.getByText("Матрица ответов").closest("a")?.getAttribute("href")).toBe("/api/x/matrix");
  });

  it("без ссылок выгрузок кнопок нет — интерфейс не обещает того, чего не делает", () => {
    render(<ItemQualityPanel view={view()} />);
    expect(screen.queryByText("Матрица ответов")).toBeNull();
  });

  it("список открывается самым тревожным: порядок по СИЛЕ подозрения (AC-02, FR-48)", () => {
    // Испорченный ключ чинят первым, поэтому он и стоит первым — независимо от того, в каком
    // порядке задания пришли с сервера.
    const calm = row({ questionId: "calm" });
    const easy = row({
      questionId: "easy",
      difficulty: 0.97,
      flags: { tooHard: false, tooEasy: true, negativeDiscrimination: false, atChanceLevel: false },
    });
    const broken = row({
      questionId: "broken",
      itemRest: -0.3,
      flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false },
    });
    render(<ItemQualityPanel view={view({ items: [calm, easy, broken] })} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[0].textContent).toContain("Сильные ошибаются чаще");
  });

  it("задание с малой выборкой стоит последним — признака нет не потому, что оно здорово", () => {
    const thin = row({ questionId: "thin", observations: 12, coefficientConfidence: "insufficient" });
    const easy = row({
      questionId: "easy",
      flags: { tooHard: false, tooEasy: true, negativeDiscrimination: false, atChanceLevel: false },
    });
    render(<ItemQualityPanel view={view({ items: [thin, easy] })} />);

    const rows = screen.getAllByRole("row").slice(1);
    expect(rows[rows.length - 1].textContent).toContain("Мало данных");
  });

  it("«мало данных» говорит, сколько собрано и сколько ЕЩЁ нужно (AC-05)", () => {
    // Иначе признак не подсказывает действия: ждать ещё неделю или бросать задание вовсе.
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", observations: 12, coefficientConfidence: "insufficient" })],
    })} />);

    expect(screen.getByText(/12 из 30 · нужно ещё 18 наблюдений/)).toBeTruthy();
  });

  it("баннер смещения показывается при неоднородной выдаче (AC-06, FR-39)", () => {
    render(<ItemQualityPanel view={view({ bias: { unevenDelivery: true, importShare: 0 } })} />);

    expect(screen.getByText("Показатели дискриминации ослаблены")).toBeTruthy();
    expect(screen.getByText(/Выдача неоднородна/)).toBeTruthy();
  });

  it("у теста с однородной выдачей баннера нет — он был бы ложной тревогой", () => {
    render(<ItemQualityPanel view={view({ bias: { unevenDelivery: false, importShare: 0 } })} />);
    expect(screen.queryByText("Показатели дискриминации ослаблены")).toBeNull();
  });

  it("тот же баннер поднимает заметная доля импорта (FR-40)", () => {
    // Там бинарный исход вместо доли балла и неизвестная редакция — повод другой, и назван он
    // своими словами.
    render(<ItemQualityPanel view={view({ bias: { unevenDelivery: false, importShare: 0.4 } })} />);

    expect(screen.getByText(/доля наблюдений пришла из импорта \(40 %\)/)).toBeTruthy();
  });

  it("у теста, где все задания измерительные, вкладка показывает только шкалы (FR-52)", () => {
    // Вскрыто приёмкой: таблица с восемью строками «мало данных · 0 из 30» и плитками с
    // прочерками читается как поломка экрана, хотя всё в порядке — проверять просто нечего.
    render(<ItemQualityPanel view={view({ measurementOnly: true })} />);

    expect(screen.getByText("Тест измерительный")).toBeTruthy();
    expect(screen.queryByText("Надёжность (альфа)")).toBeNull();
    expect(screen.queryByText("Задания")).toBeNull();
  });

  it("счётчик «под подозрением» считает задания с признаками, а не все подряд", () => {
    const clean = row({ questionId: "q1" });
    const broken = row({
      questionId: "q2",
      flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false },
    });
    render(<ItemQualityPanel view={view({ items: [clean, broken] })} />);

    // Плитка и фильтр называются одинаково — считаем по плитке, она в карточке сводки.
    const tile = screen.getAllByText("Под подозрением")
      .map(node => node.closest(".ou-card__body"))
      .find(Boolean)!;
    expect(within(tile as HTMLElement).getByText("1")).toBeTruthy();
  });
});
