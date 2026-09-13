/**
 * @module features/analytics/registry/__tests__/registry
 * @description PRD-56 FR-01 - FR-03: экран реестра прохождений.
 *
 * Проверяется договор экрана с человеком и с сервером: какие условия он показывает чипами,
 * что запрашивает при их смене, как догружает следующую порцию и что говорит, когда под
 * условия ничего не подошло. Разметку рисуют компоненты ui-kit — их поведение здесь не
 * переспрашивается.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PassageRegistry } from "../passage-registry";

/** Ответ ручки реестра: одна страница прохождений и общее число. */
function page(rows: unknown[], total: number) {
  return { ok: true, json: async () => ({ rows, total, limit: 25, offset: 0 }) };
}

const ROW = {
  id: "web-1", participant: "Морозова Анна", participantKey: null, userId: "u1",
  testId: "t1", testTitle: "Сертификация руководителей",
  startedAt: "2026-09-11T14:00:00.000Z", finishedAt: "2026-09-11T14:20:00.000Z",
  durationMs: 1_200_000, percent: 78, passed: true, outcome: "passed",
  source: "web", groupId: null,
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(page([ROW], 1));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("IntersectionObserver", class {
    observe() { /* догрузка проверяется отдельным тестом */ }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Условия последнего запроса к ручке реестра. */
function lastQuery(): URLSearchParams {
  const url = String(fetchMock.mock.calls.at(-1)?.[0] ?? "");
  return new URLSearchParams(url.slice(url.indexOf("?")));
}

describe("PassageRegistry", () => {
  it("показывает прохождения, которые вернула ручка", async () => {
    render(<PassageRegistry filter={{ testIds: [], groupIds: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />);

    expect(await screen.findByText("Морозова Анна")).toBeTruthy();
    expect(screen.getByText("Сертификация руководителей")).toBeTruthy();
  });

  it("печатает в подвале, сколько строк показано из скольких", async () => {
    fetchMock.mockResolvedValue(page([ROW], 128));

    render(<PassageRegistry filter={{ testIds: [], groupIds: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />);

    expect(await screen.findByText(/Показано 1 из 128/)).toBeTruthy();
  });

  it("переносит условия отбора в запрос", async () => {
    render(
      <PassageRegistry
        filter={{ testIds: ["t1"], groupIds: [], sources: ["import"], outcomes: ["failed"], from: "2026-09-01" }}
        onFilterChange={() => {}}
      />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const query = lastQuery();
    expect(query.getAll("testId")).toEqual(["t1"]);
    expect(query.getAll("source")).toEqual(["import"]);
    expect(query.getAll("outcome")).toEqual(["failed"]);
    expect(query.get("from")).toBe("2026-09-01");
  });

  it("показывает применённые условия чипами и снимает их по одному", async () => {
    const onFilterChange = vi.fn();
    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], sources: ["import"], outcomes: [], from: "2026-09-01", to: "2026-09-30" }}
        onFilterChange={onFilterChange}
      />,
    );

    expect(await screen.findByText(/Источник: импорт/)).toBeTruthy();
    expect(screen.getByText(/Период: 2026-09-01 — 2026-09-30/)).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: /Снять условие: Источник: импорт/ }));

    expect(onFilterChange).toHaveBeenCalledWith(
      expect.objectContaining({ sources: [], from: "2026-09-01" }),
    );
  });

  it("сбрасывает все условия разом", async () => {
    const onFilterChange = vi.fn();
    render(
      <PassageRegistry
        filter={{ testIds: ["t1"], groupIds: [], sources: ["web"], outcomes: [] }}
        onFilterChange={onFilterChange}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: /Сбросить/ }));

    expect(onFilterChange).toHaveBeenCalledWith({
      testIds: [], groupIds: [], sources: [], outcomes: [],
    });
  });

  it("говорит, что условия не подошли, а не просто «нет данных»", async () => {
    fetchMock.mockResolvedValue(page([], 0));

    render(
      <PassageRegistry
        filter={{ testIds: [], groupIds: [], sources: ["import"], outcomes: [] }}
        onFilterChange={() => {}}
      />,
    );

    expect(await screen.findByText(/Под эти условия не подошло ни одного прохождения/)).toBeTruthy();
  });

  it("запрашивает первую порцию заново, когда условия изменились", async () => {
    const { rerender } = render(
      <PassageRegistry filter={{ testIds: [], groupIds: [], sources: [], outcomes: [] }} onFilterChange={() => {}} />,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    rerender(
      <PassageRegistry filter={{ testIds: [], groupIds: [], sources: ["web"], outcomes: [] }} onFilterChange={() => {}} />,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastQuery().get("offset")).toBe("0");
  });
});
