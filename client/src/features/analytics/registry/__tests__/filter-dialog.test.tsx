/**
 * @module features/analytics/registry/__tests__/filter-dialog
 * @description PRD-56 FR-02: окно условий отбора реестра.
 *
 * Условия задаются целиком в одном окне и применяются разом: набор из пяти полей, меняемых по
 * одному прямо в списке, заставлял бы перезапрашивать выборку на каждый щелчок.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RegistryFilterDialog } from "../filter-dialog";

const EMPTY = { testIds: [], groupIds: [], formIds: [], snapshotIds: [], sources: [], outcomes: [] };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: string) => ({
    ok: true,
    json: async () => (String(input).includes("/api/groups")
      ? [{ id: "g1", name: "Отдел продаж" }]
      : [{ id: "t1", title: "Сертификация руководителей" }]),
  })));
});

afterEach(() => vi.unstubAllGlobals());

describe("RegistryFilterDialog", () => {
  it("применяет отмеченные условия разом, а не по одному", async () => {
    const onApply = vi.fn();
    render(<RegistryFilterDialog open filter={EMPTY} onApply={onApply} onClose={() => {}} />);

    await userEvent.click(await screen.findByLabelText("Импорт"));
    await userEvent.click(screen.getByLabelText("Не сдал"));
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApply).toHaveBeenCalledTimes(1);
    expect(onApply).toHaveBeenCalledWith(
      expect.objectContaining({ sources: ["import"], outcomes: ["failed"] }),
    );
  });

  it("не трогает условия, если окно закрыли отменой", async () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    render(<RegistryFilterDialog open filter={EMPTY} onApply={onApply} onClose={onClose} />);

    await userEvent.click(await screen.findByLabelText("Веб"));
    await userEvent.click(screen.getByRole("button", { name: "Отмена" }));

    expect(onApply).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it("показывает уже применённые условия отмеченными", async () => {
    render(
      <RegistryFilterDialog
        open
        filter={{ ...EMPTY, sources: ["telemetry"], from: "2026-09-01" }}
        onApply={() => {}}
        onClose={() => {}}
      />,
    );

    expect((await screen.findByLabelText("Телеметрия LMS")) as HTMLInputElement).toBeChecked();
    expect((screen.getByLabelText("Период с") as HTMLInputElement).value).toBe("2026-09-01");
  });

  it("сбрасывает все условия одной кнопкой", async () => {
    const onApply = vi.fn();
    render(
      <RegistryFilterDialog
        open
        filter={{ ...EMPTY, sources: ["web"], outcomes: ["passed"] }}
        onApply={onApply}
        onClose={() => {}}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "Сбросить" }));
    await userEvent.click(screen.getByRole("button", { name: "Применить" }));

    expect(onApply).toHaveBeenCalledWith(EMPTY);
  });
});
