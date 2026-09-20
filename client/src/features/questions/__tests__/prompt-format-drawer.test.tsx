// @vitest-environment jsdom
/**
 * @module features/questions/__tests__/prompt-format-drawer.test
 *
 * PRD-57 §4.3: режим ввода текста задания переключается над полем, и переключение не
 * теряет содержимого молча (FR-09c).
 *
 * Проверяется то, что автор увидит первым: переключатель на месте, перевод спрашивает
 * согласия, и формат уезжает на сервер вместе с текстом — без него набранное тегами
 * прочиталось бы как разметка.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Question, Topic } from "@shared/schema";

const guardMock = vi.hoisted(() => vi.fn());
vi.mock("@/features/content-protection/use-content-guard", () => ({
  useContentGuard: () => ({ guard: guardMock, dialogProps: { open: false } }),
}));

import { QuestionEditorDrawer, type QuestionEditorDrawerProps } from "../question-editor-drawer";

const topics = [{ id: "t1", name: "Охрана труда" }] as unknown as Topic[];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ id: "new-id" }),
    text: async (): Promise<string> => JSON.stringify({ id: "new-id" }),
  }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderDrawer(overrides: Partial<QuestionEditorDrawerProps> = {}) {
  const props: QuestionEditorDrawerProps = {
    open: true,
    question: null,
    topics,
    onClose: vi.fn(),
    onSaved: vi.fn(),
    defaultTopicId: "t1",
    ...overrides,
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <QuestionEditorDrawer {...props} />
    </QueryClientProvider>,
  );
}

/** Тело последнего сохранения задания. */
function savedBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls.find((c) => String(c[0]).includes("/api/questions"));
  return JSON.parse(String((call![1] as { body: string }).body));
}

describe("переключатель режимов", () => {
  it("стоит над полем текста", () => {
    renderDrawer();
    expect(screen.getByTestId("seg-prompt-format")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Разметка" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "HTML" })).toBeTruthy();
  });

  it("новое задание открывается в разметке: так написаны все прежние", () => {
    renderDrawer();
    expect(screen.getByRole("button", { name: "Разметка" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("сохранённое задание открывается в своём режиме", () => {
    const htmlQuestion = {
      id: "q1", topicId: "t1", type: "single",
      prompt: "<p>Текст</p>", promptFormat: "html",
      dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
      tags: [], feedbackMode: "general",
    } as unknown as Question;
    renderDrawer({ question: htmlQuestion });
    expect(screen.getByRole("button", { name: "HTML" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("переключение с переводом", () => {
  it("спрашивает согласия и называет, что произойдёт", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Текст **жирный**" },
    });
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));

    expect(await screen.findByText("Перевести текст в HTML?")).toBeTruthy();
    expect(screen.getByText(/станут тегами/)).toBeTruthy();
    // До согласия текст не тронут.
    expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value)
      .toBe("Текст **жирный**");
  });

  it("после согласия текст переведён", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), {
      target: { value: "Текст **жирный**" },
    });
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    fireEvent.click(await screen.findByTestId("confirm-mode-switch"));

    await waitFor(() => expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value)
      .toContain("<strong>жирный</strong>"));
  });

  it("отмена оставляет и текст, и режим прежними", async () => {
    renderDrawer();
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: "Текст" } });
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    // «Отмена» две: в подвале ящика и в окне перехода — нужна вторая.
    fireEvent.click(screen.getAllByRole("button", { name: "Отмена" }).at(-1)!);

    await waitFor(() => expect(screen.queryByText("Перевести текст в HTML?")).toBeNull());
    expect((screen.getByTestId("input-question-prompt") as HTMLTextAreaElement).value).toBe("Текст");
    expect(screen.getByRole("button", { name: "Разметка" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("обратный перевод называет непредставимое числами (FR-09c)", async () => {
    const htmlQuestion = {
      id: "q1", topicId: "t1", type: "single",
      prompt: '<table><tr><td>1</td></tr></table><p class="lead">Текст</p>',
      promptFormat: "html",
      dataJson: { options: ["А", "Б"] }, correctJson: { correctIndex: 0 },
      tags: [], feedbackMode: "general",
    } as unknown as Question;
    renderDrawer({ question: htmlQuestion });

    fireEvent.click(screen.getByRole("button", { name: "Разметка" }));
    expect(await screen.findByTestId("mode-switch-losses")).toBeTruthy();
    expect(screen.getByText(/Таблица — 1/)).toBeTruthy();
  });
});

describe("сохранение", () => {
  /** Заполнить минимально валидное задание с одиночным выбором. */
  const fillValid = (prompt: string) => {
    fireEvent.change(screen.getByTestId("input-question-prompt"), { target: { value: prompt } });
    fireEvent.change(screen.getByTestId("input-option-0"), { target: { value: "Париж" } });
    fireEvent.change(screen.getByTestId("input-option-1"), { target: { value: "Лондон" } });
  };

  it("формат уезжает вместе с текстом", async () => {
    renderDrawer();
    fillValid("Текст");
    fireEvent.click(screen.getByRole("button", { name: "HTML" }));
    fireEvent.click(await screen.findByTestId("confirm-mode-switch"));

    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savedBody().promptFormat).toBe("html");
  });

  it("у обычного задания формат — разметка", async () => {
    renderDrawer();
    fillValid("Текст");
    const submit = screen.getByTestId("button-submit-question");
    await waitFor(() => expect(submit).not.toBeDisabled());
    fireEvent.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(savedBody().promptFormat).toBe("markdown");
  });
});
