/**
 * @module components/__tests__/select-portal.test
 * @description `Select` with `portal`: the menu leaves the field for the document body, so a
 * scrolling ancestor can no longer clip it; picking still works, and the default `Select`
 * keeps its menu in place.
 */
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Select } from "@skillum/ui-kit";

const OPTIONS = [
  { value: "a", label: "Первый" },
  { value: "b", label: "Второй" },
];

describe("<Select portal>", () => {
  it("draws the menu in the body, outside the field", () => {
    render(<Select portal options={OPTIONS} value="a" onChange={() => {}} data-testid="sel" />);
    fireEvent.click(within(screen.getByTestId("sel")).getByRole("button"));
    const list = screen.getByRole("listbox");
    expect(screen.getByTestId("sel").contains(list)).toBe(false);
    expect(document.body.contains(list)).toBe(true);
    expect(list.closest(".ou-select__menu")).not.toBeNull();
  });

  it("a press on an option does not close the menu before the pick", () => {
    const onChange = vi.fn();
    render(<Select portal options={OPTIONS} value="a" onChange={onChange} data-testid="sel" />);
    fireEvent.click(within(screen.getByTestId("sel")).getByRole("button"));
    const option = screen.getByRole("option", { name: "Второй" });
    fireEvent.mouseDown(option);
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    fireEvent.click(option);
    expect(onChange).toHaveBeenCalledWith("b");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("a press outside closes the menu", () => {
    render(<Select portal options={OPTIONS} value="a" onChange={() => {}} data-testid="sel" />);
    fireEvent.click(within(screen.getByTestId("sel")).getByRole("button"));
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("returnFocus={false} leaves the focus where the host put it", () => {
    render(<Select portal returnFocus={false} options={OPTIONS} value="a" onChange={() => {}} data-testid="sel" />);
    const trigger = within(screen.getByTestId("sel")).getByRole("button");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: "Второй" }));
    expect(document.activeElement).not.toBe(trigger);
  });

  it("without portal the menu stays inside the field, as before", () => {
    render(<Select options={OPTIONS} value="a" onChange={() => {}} data-testid="sel" />);
    fireEvent.click(within(screen.getByTestId("sel")).getByRole("button"));
    expect(screen.getByTestId("sel").contains(screen.getByRole("listbox"))).toBe(true);
  });
});
