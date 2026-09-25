/**
 * @module features/analytics/lms-import/__tests__/lms-import-form
 * @description Форма загрузки выгрузки LMS: список загрузок с учётом в расчётах (PRD-66 FR-12)
 * и подписи плана.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { getQueryFn, queryClient } from "@/lib/queryClient";
import { LmsImportForm, type LmsInspectResult } from "../lms-import-form";

const INSPECT: LmsInspectResult = {
  kind: "lmsExport", testId: "t1", testTitle: "Тест", rows: 3, questionIds: 2,
  scaleKeys: [], variableNames: [], unknownColumns: [],
};

const BATCHES = [
  { id: "b1", fileName: "сентябрь.xlsx", importedAt: "2026-09-11T20:40:00Z", rowsCreated: 3, rowsUpdated: 0, rowsLinked: 0, counted: true },
  { id: "b2", fileName: "август.xlsx", importedAt: "2026-08-14T07:12:00Z", rowsCreated: 18, rowsUpdated: 0, rowsLinked: 0, counted: false },
];

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  queryClient.clear();
  queryClient.setDefaultOptions({ queries: { retry: false, queryFn: getQueryFn({ on401: "throw" }) } });
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
  fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/analytics/lms-import/batches/t1") return ok(BATCHES);
    if (url.startsWith("/api/analytics/lms-import/batches/") && init?.method === "PATCH") {
      return ok({ ok: true, counted: JSON.parse(String(init.body)).counted });
    }
    if (url.startsWith("/api/analytics/lms-import?dryRun=true")) {
      return ok({ testId: "t1", testTitle: "Тест", rowsTotal: 3, rowsCreated: 2, rowsUpdated: 1, rowsSkipped: 0, rowsLinked: 0, warnings: [] });
    }
    return ok([]);
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => vi.unstubAllGlobals());

function renderForm() {
  const file = new File(["x"], "выгрузка.xlsx");
  return render(
    <QueryClientProvider client={queryClient}>
      <LmsImportForm file={file} inspect={INSPECT} />
    </QueryClientProvider>,
  );
}

describe("<LmsImportForm /> — учёт загрузки в расчётах (PRD-66 FR-12)", () => {
  it("у каждой загрузки свой переключатель «В расчётах» с текущим состоянием", async () => {
    renderForm();

    const switches = await screen.findAllByRole("checkbox", { name: "В расчётах" });
    expect(switches).toHaveLength(2);
    expect((switches[0] as HTMLInputElement).checked).toBe(true);
    expect((switches[1] as HTMLInputElement).checked).toBe(false);
  });

  it("снятая загрузка подписана: из чисел убрана, данные целы", async () => {
    // Выключенный переключатель в списке легко не заметить — подпись говорит словами.
    renderForm();

    expect(await screen.findByText(/не учитывается в расчётах — данные сохранены/)).toBeInTheDocument();
    expect(screen.getAllByText(/не учитывается в расчётах/)).toHaveLength(1);
  });

  it("переключение снимает загрузку с учёта сразу, без подтверждения", async () => {
    renderForm();

    const [first] = await screen.findAllByRole("checkbox", { name: "В расчётах" });
    fireEvent.click(first);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/analytics/lms-import/batches/b1",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ counted: false }) }),
    ));
  });

  it("после переключения числа аналитики на странице пересчитываются", async () => {
    // Ключи запросов аналитики — целые адреса («/api/analytics/psychometrics/t1»), и сброс по
    // ключу ["/api/analytics"] их не задевал: страница показывала числа со снятой загрузкой.
    queryClient.setQueryData(["/api/analytics/psychometrics/t1?source=import"], { items: [] });
    queryClient.setQueryData(["/api/analytics/tests/t1", "?groupId=g1"], { summary: {} });
    queryClient.setQueryData(["/api/tests"], []);
    renderForm();

    const [first] = await screen.findAllByRole("checkbox", { name: "В расчётах" });
    fireEvent.click(first);

    await waitFor(() => expect(
      queryClient.getQueryState(["/api/analytics/psychometrics/t1?source=import"])?.isInvalidated,
    ).toBe(true));
    expect(queryClient.getQueryState(["/api/analytics/tests/t1", "?groupId=g1"])?.isInvalidated).toBe(true);
    // Чужие данные не трогаются.
    expect(queryClient.getQueryState(["/api/tests"])?.isInvalidated).toBe(false);
  });
});

describe("<LmsImportForm /> — план загрузки", () => {
  it("счётчики плана читаются как прогноз в одной форме", async () => {
    renderForm();
    fireEvent.click(await screen.findByRole("button", { name: "Проверить" }));

    for (const label of ["Будет добавлено: 2", "Будет обновлено: 1", "Будет пропущено: 0", "Будет связано: 0"]) {
      expect(await screen.findByText(label)).toBeInTheDocument();
    }
  });
});
