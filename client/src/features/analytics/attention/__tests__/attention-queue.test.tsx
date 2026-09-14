/**
 * @module features/analytics/attention/__tests__/attention-queue
 * @description PRD-56 FR-10, FR-11: экран очереди «требует внимания».
 *
 * Экран говорит «сделай»: у каждой позиции названа причина, и каждая ведёт к участнику и его
 * прохождению. Поэтому проверяется не только состав, но и то, что пустая очередь читается как
 * «дел нет», а не как «ничего не загрузилось».
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AttentionQueue } from "../attention-queue";

const ITEMS = [
  {
    kind: "overdue", participantId: "u2", participant: "Сафин Ильдар",
    testId: "test1", testTitle: "Сертификация", dueAt: "2026-09-01T00:00:00.000Z",
  },
  {
    kind: "failed", participantId: "u1", participant: "Морозова Анна",
    testId: "test1", testTitle: "Сертификация", observationId: "web-1",
  },
  {
    kind: "abandoned", participantId: "u3", participant: "Кузнецов Павел",
    testId: "test1", testTitle: "Сертификация", observationId: "web-2",
    startedAt: "2026-09-10T09:00:00.000Z",
  },
  {
    kind: "exhausted", participantId: "u4", participant: "Зуева Полина",
    testId: "test1", testTitle: "Сертификация", observationId: "web-3",
  },
];

let fetchMock: ReturnType<typeof vi.fn>;

function answer(items: unknown[]) {
  return {
    ok: true,
    json: async () => ({
      items,
      counts: { overdue: 1, failed: 1, abandoned: 1, exhausted: 1 },
    }),
  };
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(answer(ITEMS));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

describe("AttentionQueue", () => {
  it("показывает дела всех четырёх видов и называет причину каждого", async () => {
    render(<AttentionQueue />);

    expect(await screen.findByText("Сафин Ильдар")).toBeTruthy();
    expect(screen.getByText(/Срок истёк, к тесту не приступали/i)).toBeTruthy();
    expect(screen.getByText(/Не сдал, попытки остались/i)).toBeTruthy();
    expect(screen.getByText(/Начал и не завершил/i)).toBeTruthy();
    expect(screen.getByText(/Попытки исчерпаны/i)).toBeTruthy();
  });

  it("ведёт из позиции к прохождению участника", async () => {
    const onOpenPassage = vi.fn();
    render(<AttentionQueue onOpenPassage={onOpenPassage} />);

    await userEvent.click(await screen.findByRole("button", { name: /Морозова Анна/ }));

    expect(onOpenPassage).toHaveBeenCalledWith(
      expect.objectContaining({ observationId: "web-1", participant: "Морозова Анна" }),
    );
  });

  it("не предлагает открыть прохождение там, где его нет", async () => {
    // У просроченного назначения прохождения не существует: к тесту не приступали.
    render(<AttentionQueue onOpenPassage={() => {}} />);

    await screen.findByText("Сафин Ильдар");
    expect(screen.queryByRole("button", { name: /Сафин Ильдар/ })).toBeNull();
  });

  it("пустая очередь читается как «дел нет»", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ items: [], counts: { overdue: 0, failed: 0, abandoned: 0, exhausted: 0 } }),
    });

    render(<AttentionQueue />);

    expect(await screen.findByText(/Дел нет/i)).toBeTruthy();
  });

  it("сообщает об ошибке, а не выдаёт её за отсутствие дел", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    render(<AttentionQueue />);

    expect(await screen.findByText(/Не удалось загрузить очередь/i)).toBeTruthy();
  });
});
