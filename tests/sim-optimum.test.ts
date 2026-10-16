/**
 * @module tests/sim-optimum
 * @description The cheapest way through a scenario (v2-design.md section 2.2): Dijkstra over run
 * states, so conditions are honoured; traps never taken; a field typed by one action; a limit that
 * says «unknown» instead of guessing; route keys passed in order.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cheapestPath } from "@shared/sim/optimum";
import { playable } from "@shared/sim/variant";
import type { Scenario, Scene } from "@shared/sim/contract";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));

function graph(scenes: Scene[], extra: Partial<Scenario> = {}): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "control",
    meta: { title: "G", task: "T" }, media: [],
    fields: [{ id: "f", fill: "keyboard" }],
    goal: { checks: [] },
    variants: [{ device: "desktop", stage: { w: 100, h: 100 }, start: scenes[0].id, scenes }],
    ...extra,
  };
}
const z = (id: string, effects: unknown[], more: Record<string, unknown> = {}) =>
  ({ id, role: "path", x: 0, y: 0, w: 1, h: 1, effects, ...more }) as never;

describe("оптимум", () => {
  it("эталонный сценарий: путь найден, его стоимость конечна", () => {
    const found = cheapestPath(playable(v1));
    expect(found.status).toBe("found");
    if (found.status === "found") {
      expect(found.cost).toBeGreaterThan(0);
      expect(found.scenes[0]).toBe(playable(v1).start);
    }
  });

  it("выбирает дешёвый путь из двух", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("long", [{ goto: "b" }]), z("short", [{ goto: "goal" }], { role: "alt", cost: 1.5 })] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    const found = cheapestPath(playable(s));
    expect(found).toMatchObject({ status: "found", cost: 1.5, steps: [{ scene: "a", action: "short" }] });
  });

  it("условие зоны учитывается: сначала заполнить поле", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], fields: [{ field: "f", x: 0, y: 0, w: 1, h: 1, editable: true }],
        zones: [z("save", [{ goto: "goal" }], { when: { filled: ["f"] }, otherwise: [] })] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 2, steps: [{ scene: "a", action: "field:f" }, { scene: "a", action: "save" }] });
  });

  it("ловушки не берутся, шаги в сторону можно исключить", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [
        z("trap", [{ goto: "goal" }], { role: "trap", error: "E", cost: 0 }),
        z("side", [{ goto: "goal" }], { role: "detour" }),
        z("main", [{ goto: "b" }]),
      ] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 1 });
    expect(cheapestPath(playable(s), { detours: false })).toMatchObject({ status: "found", cost: 2 });
  });

  it("цель с непрошедшей проверкой — не цель", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("go", [{ set: "g", value: "нет" }, { goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ], { fields: [{ id: "g", fill: "effect", check: { rules: [{ kind: "equals", value: "да" }] } as never }], goal: { checks: [{ field: "g" }] } });
    expect(cheapestPath(playable(s)).status).toBe("none");
  });

  it("ключевые действия маршрута проходятся по порядку", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("short", [{ goto: "goal" }]), z("via", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "goal" }])] },
      { id: "goal", title: "Цель", elements: [], end: { outcome: "success" } },
    ]);
    expect(cheapestPath(playable(s), { keys: [{ scene: "a", action: "via" }] })).toMatchObject({ status: "found", cost: 2 });
  });

  it("предел состояний — «неизвестно», а не догадка", () => {
    expect(cheapestPath(playable(v1), { maxStates: 2 }).status).toBe("limit");
  });

  it("исследовательский сценарий ищет путь до целевого финала", () => {
    const s = graph([
      { id: "a", title: "A", elements: [], zones: [z("x", [{ goto: "other" }]), z("y", [{ goto: "b" }])] },
      { id: "b", title: "B", elements: [], zones: [z("b-go", [{ goto: "found" }])] },
      { id: "other", title: "Не то", elements: [], end: { outcome: "finale", title: "Сдался" } },
      { id: "found", title: "Нашёл", elements: [], end: { outcome: "finale", title: "Нашёл", target: true } },
    ], { kind: "research", goal: undefined });
    expect(cheapestPath(playable(s))).toMatchObject({ status: "found", cost: 2, scenes: ["a", "b", "found"] });
  });
});
