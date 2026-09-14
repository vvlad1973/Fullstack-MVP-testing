/**
 * @module features/analytics/test/__tests__/question-table
 * @description PRD-56 FR-15, FR-16, FR-17, FR-22: таблица заданий теста.
 *
 * Таблица отвечает на вопрос «что чинить»: доля верных, пропуски, экспозиция, время и
 * авторская трудность в одной строке. Тип задания — пиктограммой, как в дереве контента и в
 * таблице «Оценка» редактора: словом он занимал бы колонку, ничего к ней не добавляя.
 *
 * Вид «требуют ревизии» — отбор по СОШЕДШИМСЯ признакам, и каждый назван словами: вид без
 * объяснения читается как приговор заданию.
 *
 * У измерительного задания доли верных нет вовсе (FR-22): эталона у него не существует, и
 * ноль в этой колонке был бы про него ложью.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { QuestionTable } from "../question-table";

const QUESTIONS = [
  {
    questionId: "q1", questionPrompt: "Какая мера относится к антикоррупционным?",
    questionType: "single", topicName: "Право и комплаенс", difficulty: 60,
    totalAnswers: 60, gradedAnswers: 60, correctAnswers: 25, correctPercent: 41,
    skipShare: 3, exposurePercent: 82, latencyMedianMs: 48_000, latencySampleSize: 60,
    reviewFlags: [],
  },
  {
    questionId: "q2", questionPrompt: "Быстрый и мимо",
    questionType: "multiple", topicName: "Охрана труда", difficulty: 40,
    totalAnswers: 50, gradedAnswers: 50, correctAnswers: 10, correctPercent: 20,
    skipShare: 1, exposurePercent: 90, latencyMedianMs: 3_000, latencySampleSize: 50,
    reviewFlags: [
      { kind: "fast-and-wrong", reason: "Отвечают за 3 с и мимо (20 % верных): условие, похоже, не читают" },
    ],
  },
  {
    questionId: "q3", questionPrompt: "Насколько вы согласны?",
    questionType: "scale", topicName: "Опросник", difficulty: 50,
    totalAnswers: 30, gradedAnswers: 0, correctAnswers: 0, correctPercent: null,
    skipShare: null, exposurePercent: 40, latencyMedianMs: null, latencySampleSize: 0,
    reviewFlags: [],
  },
];

describe("QuestionTable", () => {
  it("показывает задание с типом-пиктограммой и его темой", () => {
    render(<QuestionTable questions={QUESTIONS} />);

    expect(screen.getByText("Какая мера относится к антикоррупционным?")).toBeTruthy();
    expect(screen.getByText("Право и комплаенс")).toBeTruthy();
    // Тип назван пиктограммой: у неё есть доступное имя, но своей колонки нет.
    expect(screen.getByLabelText("Один ответ")).toBeTruthy();
  });

  it("печатает прочерк там, где доли верных не существует", () => {
    render(<QuestionTable questions={QUESTIONS} />);

    const row = screen.getByText("Насколько вы согласны?").closest("tr")!;
    // FR-22: у измерительного задания нет эталона — ноль здесь был бы ложью.
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("отбирает задания с признаками ревизии и считает их", async () => {
    render(<QuestionTable questions={QUESTIONS} />);

    await userEvent.click(screen.getByRole("button", { name: /Требуют ревизии/ }));

    expect(screen.getByText("Быстрый и мимо")).toBeTruthy();
    expect(screen.queryByText("Какая мера относится к антикоррупционным?")).toBeNull();
  });

  it("называет признак словами, а не помечает значком", async () => {
    render(<QuestionTable questions={QUESTIONS} />);

    await userEvent.click(screen.getByRole("button", { name: /Требуют ревизии/ }));

    expect(screen.getByText(/условие, похоже, не читают/)).toBeTruthy();
  });

  it("говорит, что ревизия никому не нужна, когда признаков нет", async () => {
    render(<QuestionTable questions={[QUESTIONS[0]]} />);

    await userEvent.click(screen.getByRole("button", { name: /Требуют ревизии/ }));

    expect(screen.getByText(/Признаки проблем не сошлись/i)).toBeTruthy();
  });

  it("ведёт из строки к прохождениям, где на задании ошиблись", async () => {
    const onOpenRegistry = vi.fn();
    render(<QuestionTable questions={QUESTIONS} onOpenRegistry={onOpenRegistry} />);

    await userEvent.click(
      screen.getByRole("button", { name: /Прохождения с ошибкой: Какая мера/ }),
    );

    // FR-17: переход ведёт к тем, кто ошибся, — это и есть следующий шаг разбора задания.
    expect(onOpenRegistry).toHaveBeenCalledWith("q1");
  });

  it("сортирует по столбцу", async () => {
    render(<QuestionTable questions={QUESTIONS} />);

    // Заголовок сортируемой колонки в ДС — не кнопка, а кликабельная ячейка: доступность
    // заголовков это отдельный долг ДС, записанный в план Э4. По умолчанию таблица уже
    // отсортирована по доле верных, поэтому проверяется ОБРАТНЫЙ порядок после клика.
    await userEvent.click(screen.getByText(/Доля верных/));

    const rows = screen.getAllByRole("row").slice(1);
    // Убывание: задание без доли верных всегда первое (его «нет значения» уезжает в конец
    // при возрастании и в начало при убывании), затем 41 %, затем 20 %.
    expect(within(rows[0]).getByText("Насколько вы согласны?")).toBeTruthy();
    expect(within(rows[2]).getByText("Быстрый и мимо")).toBeTruthy();
  });
});

describe("QuestionTable — исключение из выдачи", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ topicName: "Право и комплаенс", remaining: 11, drawCount: 10, allowed: true }),
    }));
  });

  afterEach(() => vi.unstubAllGlobals());

  it("метит исключённое задание перечёркнутым кругом с подсказкой", () => {
    render(<QuestionTable questions={[{ ...QUESTIONS[0], excludedFromDelivery: true }]} />);

    // FR-17a: тегом состояние не метится — тег стоит в одном ряду с темой и подтемой и
    // читается как ярлык СОДЕРЖАНИЯ, а речь о состоянии выдачи.
    expect(screen.getByLabelText(/Исключён из выдачи/i)).toBeTruthy();
  });

  it("отбирает исключённые отдельным видом со счётчиком", async () => {
    render(<QuestionTable questions={[QUESTIONS[0], { ...QUESTIONS[1], excludedFromDelivery: true }]} />);

    await userEvent.click(screen.getByRole("button", { name: /Исключённые/ }));

    expect(screen.getByText("Быстрый и мимо")).toBeTruthy();
    expect(screen.queryByText("Какая мера относится к антикоррупционным?")).toBeNull();
  });

  it("спрашивает подтверждение и называет последствия числами", async () => {
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Исключить из выдачи: Какая мера/ }));

    // FR-17b: окно говорит, сколько заданий останется в теме при её квоте выдачи, и что
    // опубликованная версия не меняется.
    expect(await screen.findByText(/останется 11/i)).toBeTruthy();
    expect(screen.getByText(/опубликованная версия не меняется/i)).toBeTruthy();
  });

  it("не исключает, пока подтверждение не дано", async () => {
    const onDeliveryChange = vi.fn();
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={onDeliveryChange} />);

    await userEvent.click(screen.getByRole("button", { name: /Исключить из выдачи: Какая мера/ }));
    await screen.findByText(/останется 11/i);
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onDeliveryChange).not.toHaveBeenCalled();
  });

  it("исключает задание после подтверждения", async () => {
    const onDeliveryChange = vi.fn();
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={onDeliveryChange} />);

    await userEvent.click(screen.getByRole("button", { name: /Исключить из выдачи: Какая мера/ }));
    await screen.findByText(/останется 11/i);
    await userEvent.click(screen.getByRole("button", { name: "Исключить" }));

    expect(onDeliveryChange).toHaveBeenCalledWith("q1", true);
  });

  it("запрещает исключение, после которого выдачу собрать нельзя", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ topicName: "Право", remaining: 9, drawCount: 10, allowed: false }),
    }));
    render(<QuestionTable questions={QUESTIONS} onDeliveryChange={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: /Исключить из выдачи: Какая мера/ }));

    // Не «выполнено с предупреждением»: кнопка выключена, и сказано почему.
    expect(await screen.findByText(/выдачу собрать будет нельзя/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Исключить" })).toBeDisabled();
  });

  it("возвращает задание в выдачу без подтверждения", async () => {
    // Возврат ничего не отнимает — спрашивать не о чем.
    const onDeliveryChange = vi.fn();
    render(
      <QuestionTable
        questions={[{ ...QUESTIONS[0], excludedFromDelivery: true }]}
        onDeliveryChange={onDeliveryChange}
      />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Вернуть в выдачу: Какая мера/ }));

    expect(onDeliveryChange).toHaveBeenCalledWith("q1", false);
  });
});
