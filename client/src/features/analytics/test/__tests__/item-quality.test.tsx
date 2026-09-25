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

  it("предупреждает о ключах, построенных разными алгоритмами (FR-43)", () => {
    // Один человек с двумя ключами попадает в выборку дважды, и число респондентов завышено.
    // Это не «ослабленные показатели», а прямая ошибка в составе выборки, поэтому баннер
    // отдельный и тоном выше.
    render(<ItemQualityPanel view={view({
      bias: { unevenDelivery: false, importShare: 0.4, mixedAnonymity: true },
    })} />);

    expect(screen.getByText(/посчитаны дважды/i)).toBeTruthy();
    // Совет обязан вести к исправлению ключа, а не к снятию с учёта законных данных.
    expect(screen.getByText(/скриптом обезличивания/i)).toBeTruthy();
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

/**
 * PRD-66 FR-05, FR-48: эвристики PRD-56 «Требуют ревизии» — признаками таблицы качества.
 *
 * Они идут сразу за прямыми дефектами (отрицательная дискриминация, угадывание) и перед прочими
 * признаками, а на малой выборке — вместо «мало данных»: там они единственное, что можно сказать.
 */
describe("ItemQualityPanel — эвристики «Требуют ревизии» (FR-05, FR-48)", () => {
  const HARD_AND_FREQUENT = { kinds: ["hard-and-frequent"], exposurePercent: 82, correctPercent: 41, latencyMedianMs: 30_000 };
  const FAST_AND_WRONG = { kinds: ["fast-and-wrong"], exposurePercent: 40, correctPercent: 30, latencyMedianMs: 4_000 };

  /** Строки таблицы сверху вниз — по тексту вопроса. */
  const order = () => screen.getAllByText(/^Вопрос /).map((el) => el.textContent);

  it("«Заезжено и трудно» — с числами показов и верных, как в эскизе", () => {
    render(<ItemQualityPanel
      view={view({ items: [row({ questionId: "q1", prompt: "Вопрос 1" })] })}
      heuristics={{ q1: HARD_AND_FREQUENT }}
    />);

    expect(screen.getByText("Заезжено и трудно")).toBeTruthy();
    expect(screen.getByText("82 % показов, 41 % верных")).toBeTruthy();
  });

  it("«Слишком быстрые ответы» — с медианой времени и долей верных", () => {
    render(<ItemQualityPanel
      view={view({ items: [row({ questionId: "q1", prompt: "Вопрос 1" })] })}
      heuristics={{ q1: FAST_AND_WRONG }}
    />);

    expect(screen.getByText("Слишком быстрые ответы")).toBeTruthy();
    expect(screen.getByText("медиана 4 с при 30 % верных")).toBeTruthy();
  });

  it("порядок: отрицательная дискриминация, эвристика, прочие признаки", () => {
    render(<ItemQualityPanel
      view={view({ items: [
        row({ questionId: "q-hard", prompt: "Вопрос трудный", flags: { tooHard: true, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false } }),
        row({ questionId: "q-heur", prompt: "Вопрос эвристика" }),
        row({ questionId: "q-neg", prompt: "Вопрос ключ", itemRest: -0.2, flags: { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false } }),
      ] })}
      heuristics={{ "q-heur": HARD_AND_FREQUENT }}
    />);

    expect(order()).toEqual(["Вопрос ключ", "Вопрос эвристика", "Вопрос трудный"]);
  });

  it("на малой выборке эвристика стоит вместо «мало данных» и поднимает задание вверх", () => {
    render(<ItemQualityPanel
      view={view({ items: [
        row({ questionId: "q-ok", prompt: "Вопрос спокойный" }),
        row({ questionId: "q-thin", prompt: "Вопрос мало", observations: 12, coefficientConfidence: "insufficient" }),
      ] })}
      heuristics={{ "q-thin": HARD_AND_FREQUENT }}
    />);

    // «Мало данных» есть и в переключателе вида таблицы — смотрим строку задания.
    const thinRow = screen.getByText("Вопрос мало").closest("tr") as HTMLElement;
    expect(within(thinRow).getByText("Заезжено и трудно")).toBeTruthy();
    expect(within(thinRow).queryByText("Мало данных")).toBeNull();
    expect(order()).toEqual(["Вопрос мало", "Вопрос спокойный"]);
  });

  it("эвристика считается в «под подозрением»", () => {
    render(<ItemQualityPanel
      view={view({ items: [row({ questionId: "q1", prompt: "Вопрос 1" }), row({ questionId: "q2", prompt: "Вопрос 2" })] })}
      heuristics={{ q2: HARD_AND_FREQUENT }}
    />);

    // «Под подозрением» есть и в переключателе вида таблицы — берём плитку.
    const tile = screen.getAllByText("Под подозрением")
      .map((el) => el.closest(".ou-card"))
      .find((card): card is HTMLElement => !!card && !card.querySelector("table")) as HTMLElement;
    expect(within(tile).getByText("1")).toBeTruthy();
  });
});

/**
 * PRD-66 FR-48a: колонки таблицы заданий сортируются, «Признак» — по рангу подозрения.
 *
 * Без этого порядок по умолчанию невозвратен: стоит отсортировать по n, и вернуться к «сначала
 * самое тревожное» нечем. «Мало данных» — последними в обоих направлениях.
 */
describe("ItemQualityPanel — сортировка колонок (FR-48a)", () => {
  const NEG = { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false };
  const HARD = { tooHard: true, tooEasy: false, negativeDiscrimination: false, atChanceLevel: false };
  const items = [
    row({ questionId: "a", prompt: "Вопрос А", difficulty: 0.9, observations: 300 }),
    row({ questionId: "b", prompt: "Вопрос Б", difficulty: 0.1, observations: 120, flags: HARD }),
    row({ questionId: "c", prompt: "Вопрос В", difficulty: 0.5, observations: 200, itemRest: -0.3, flags: NEG }),
    row({ questionId: "d", prompt: "Вопрос Г", difficulty: null, observations: 5, itemRest: null, coefficientConfidence: "insufficient" }),
  ];
  const order = () => screen.getAllByText(/^Вопрос [А-Г]$/).map((el) => el.textContent);
  /** Щелчок по заголовку колонки: он и переключает направление. */
  const clickHeader = async (title: string) => {
    const header = screen.getAllByText(title).find((el) => el.closest(".ou-grid__th")) as HTMLElement;
    await userEvent.click(header);
  };

  it("по умолчанию — по силе подозрения, «мало данных» в конце", () => {
    render(<ItemQualityPanel view={view({ items })} />);
    expect(order()).toEqual(["Вопрос В", "Вопрос Б", "Вопрос А", "Вопрос Г"]);
  });

  it("все пять колонок помечены сортируемыми", () => {
    render(<ItemQualityPanel view={view({ items })} />);
    expect(document.querySelectorAll(".ou-grid__th.is-sortable")).toHaveLength(5);
  });

  it("трудность сортируется по значению, пустое — последним в обоих направлениях", async () => {
    render(<ItemQualityPanel view={view({ items })} />);

    await clickHeader("Трудность");
    expect(order()).toEqual(["Вопрос Б", "Вопрос В", "Вопрос А", "Вопрос Г"]);
    await clickHeader("Трудность");
    expect(order()).toEqual(["Вопрос А", "Вопрос В", "Вопрос Б", "Вопрос Г"]);
  });

  it("n сортируется по числу наблюдений", async () => {
    render(<ItemQualityPanel view={view({ items })} />);

    await clickHeader("n");
    expect(order()).toEqual(["Вопрос Г", "Вопрос Б", "Вопрос В", "Вопрос А"]);
  });

  it("«Признак» возвращает порядок подозрения, обратное направление — от спокойных к тревожным", async () => {
    render(<ItemQualityPanel view={view({ items })} />);
    await clickHeader("n");

    await clickHeader("Признак");
    expect(order()).toEqual(["Вопрос В", "Вопрос Б", "Вопрос А", "Вопрос Г"]);
    await clickHeader("Признак");
    // «Мало данных» остаётся последним и здесь: признака у задания нет не потому, что оно здорово.
    expect(order()).toEqual(["Вопрос А", "Вопрос Б", "Вопрос В", "Вопрос Г"]);
  });
});

/**
 * PRD-66 FR-38: коэффициент при 30 ≤ n < 100 выводится с меткой ориентировочности.
 *
 * Уровень `tentative` движок считал всегда, а экран его не показывал: «0,26» на сорока
 * наблюдениях и на четырёхстах выглядели одинаково.
 */
describe("ItemQualityPanel — ориентировочные коэффициенты (FR-38)", () => {
  const NEG = { tooHard: false, tooEasy: false, negativeDiscrimination: true, atChanceLevel: false };

  it("задание без признака помечено «Ориентировочно» с числом наблюдений, как в эскизе", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", prompt: "Вопрос 1", observations: 44, coefficientConfidence: "tentative" })],
    })} />);

    expect(screen.getByText("Ориентировочно")).toBeTruthy();
    expect(screen.getByText("44 наблюдения")).toBeTruthy();
  });

  it("у задания с признаком признак главный, а оговорка — в числах под ним", () => {
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1", prompt: "Вопрос 1", observations: 44, coefficientConfidence: "tentative",
        itemRest: -0.2, discrimination: -0.1, flags: NEG,
      })],
    })} />);

    expect(screen.getByText("Сильные ошибаются чаще")).toBeTruthy();
    expect(screen.getByText(/ориентировочно, 44 наблюдения/)).toBeTruthy();
  });

  it("у признака по трудности оговорки нет: трудность под правило не попадает (FR-38a)", () => {
    render(<ItemQualityPanel view={view({
      items: [row({
        questionId: "q1", prompt: "Вопрос 1", observations: 44, coefficientConfidence: "tentative",
        difficulty: 0.97, flags: { tooHard: false, tooEasy: true, negativeDiscrimination: false, atChanceLevel: false },
      })],
    })} />);

    expect(screen.getByText("Слишком лёгкое")).toBeTruthy();
    expect(screen.queryByText(/ориентировочно/)).toBeNull();
  });

  it("ориентировочность — не подозрение: в «Под подозрением» не считается", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", prompt: "Вопрос 1", observations: 44, coefficientConfidence: "tentative" })],
    })} />);

    const tile = screen.getAllByText("Под подозрением")
      .map((el) => el.closest(".ou-card"))
      .find((card): card is HTMLElement => !!card && !card.querySelector("table")) as HTMLElement;
    expect(within(tile).getByText("0")).toBeTruthy();
  });

  it("при ста наблюдениях и больше оговорки нет", () => {
    render(<ItemQualityPanel view={view({
      items: [row({ questionId: "q1", prompt: "Вопрос 1", observations: 150, coefficientConfidence: "reliable" })],
    })} />);

    expect(screen.queryByText("Ориентировочно")).toBeNull();
    expect(screen.queryByText(/ориентировочно/)).toBeNull();
  });
});
