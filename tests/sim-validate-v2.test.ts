/**
 * @module tests/sim-validate-v2
 * @description Checks version 2 adds (v2-design.md sections 1 and 2.6): kinds, ends, stages, routes,
 * costs, device actions; a version 1 scenario is checked as its upgrade.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { validateScenario } from "@shared/sim/validate";
import { asScenario } from "@shared/sim/upgrade";
import type { Scenario } from "@shared/sim/contract";

const v1 = JSON.parse(readFileSync(resolve(process.cwd(), "tests/fixtures/sim/scenario-v1.json"), "utf8"));
const stored = (s: Scenario) => {
  const c = structuredClone(s);
  c.media.forEach((m, i) => { m.file = `/api/media/00000000-0000-0000-0000-00000000000${i % 10}`; });
  return validateScenario(c, { mode: "stored" });
};
const v2 = (): Scenario => structuredClone(asScenario(v1));

function research(): Scenario {
  return {
    format: "skillum.sim-scenario", version: 2, kind: "research",
    meta: { title: "R", task: "T" }, media: [],
    stages: [{ id: "find", title: "Поиск" }],
    variants: [{ device: "desktop", stage: { w: 10, h: 10 }, start: "a", scenes: [
      { id: "a", title: "A", elements: [], stage: "find", zones: [{ id: "go", x: 0, y: 0, w: 5, h: 5, effects: [{ goto: "b" }] }] },
      { id: "b", title: "B", elements: [], end: { outcome: "finale", title: "Нашёл", target: true } },
    ] }],
  };
}

describe("перевод и версии", () => {
  it("эталон v1 и его перевод в v2 проходят одинаково", () => {
    expect(stored(v2()).errors).toEqual([]);
    expect(stored(v1 as never).errors).toEqual([]);
  });
  it("версия новее 2 — «новее»", () => {
    expect(stored({ ...v2(), version: 3 } as never).errors[0]).toMatch(/новее/);
  });
});

describe("вид сценария", () => {
  it("исследовательский сценарий без ролей и цели проходит", () => {
    expect(validateScenario(research(), { mode: "stored" })).toEqual({ errors: [], warnings: [] });
  });
  it("у исследовательского сценария нет проверок цели и концов success", () => {
    const s = research();
    s.goal = { checks: [] };
    s.variants[0].scenes[1].end = { outcome: "success" };
    const { errors } = validateScenario(s, { mode: "stored" });
    expect(errors).toContain("У исследовательского сценария не бывает проверок цели");
    expect(errors).toContain("Сцена «B»: конец success бывает только у контрольного сценария");
  });
  it("у контрольного сценария роль обязательна, финалов нет", () => {
    const s = v2();
    delete s.variants[0].scenes[0].zones![0].role;
    s.variants[0].scenes[0].end = undefined;
    const tail = s.variants[0].scenes.at(-1)!;
    tail.end = { outcome: "finale", title: "Х" };
    const { errors } = stored(s);
    expect(errors.some((e) => /неизвестная роль undefined/.test(e))).toBe(true);
    expect(errors).toContain(`Сцена «${tail.title}»: финал бывает только у исследовательского сценария`);
  });
  it("неизвестный вид", () => {
    expect(validateScenario({ ...research(), kind: "quiz" }, { mode: "stored" }).errors).toContain("Вид сценария должен быть control или research");
  });
});

describe("этапы, стоимость, устройство", () => {
  it("сцена ссылается на необъявленный этап", () => {
    const s = research();
    s.variants[0].scenes[0].stage = "ghost";
    expect(validateScenario(s, { mode: "stored" }).errors).toContain("Сцена «A»: этап ghost не объявлен");
  });
  it("отрицательная стоимость и чужое устройству действие", () => {
    const s = research();
    Object.assign(s.variants[0].scenes[0].zones![0], { cost: -1, action: "tap" });
    const { errors } = validateScenario(s, { mode: "stored" });
    expect(errors).toContain("Сцена «A»: зона go — стоимость должна быть числом не меньше нуля");
    expect(errors).toContain("Сцена «A»: зона go: действие tap не бывает на устройстве «десктоп»");
  });
  it("два варианта одного устройства", () => {
    const s = research();
    s.variants.push(structuredClone(s.variants[0]));
    expect(validateScenario(s, { mode: "stored" }).errors).toContain("Вариант для устройства «десктоп» объявлен дважды");
  });
});

describe("маршруты в проверке", () => {
  it("ошибки маршрутов попадают в ошибки сценария", () => {
    const s = v2();
    s.variants[0].routes = [{ id: "r", title: "Р", rating: 2, keys: [{ scene: s.variants[0].start, action: "ghost" }] }];
    const { errors } = stored(s);
    expect(errors.some((e) => e.startsWith("Маршрут «Р»: оценка"))).toBe(true);
  });
});
