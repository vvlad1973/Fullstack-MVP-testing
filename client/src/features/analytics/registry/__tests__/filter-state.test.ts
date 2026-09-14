/**
 * @module features/analytics/registry/__tests__/filter-state
 * @description PRD-56 FR-03: условия отбора живут в адресе страницы.
 *
 * Ссылку на выборку пересылают коллеге, и он обязан увидеть ровно ту же — значит адрес должен
 * нести все условия и переживать круговой рейс без потерь. Обратная сторона: чужая ссылка
 * может прийти с мусором в параметрах, и экран от этого падать не должен.
 */

import { describe, expect, it } from "vitest";

import { parseFilter, filterToSearch, isEmptyFilter, type RegistryFilter } from "../filter-state";

describe("filter-state", () => {
  it("переживает круговой рейс: условия — адрес — условия", () => {
    const filter: RegistryFilter = {
      testIds: ["t1", "t2"],
      groupIds: ["g1"],
      sources: ["web", "import"],
      outcomes: ["failed"],
      from: "2026-09-01",
      to: "2026-09-30",
    };

    expect(parseFilter(filterToSearch(filter))).toEqual(filter);
  });

  it("не пишет в адрес пустые условия", () => {
    const search = filterToSearch({ testIds: [], groupIds: [], sources: [], outcomes: [] });

    expect(search).toBe("");
  });

  it("пропускает незнакомые параметры, а не падает на них", () => {
    const filter = parseFilter("?testId=t1&utm_source=mail&sort=date");

    expect(filter.testIds).toEqual(["t1"]);
  });

  it("отбрасывает значения, которых у условия быть не может", () => {
    const filter = parseFilter("?source=web&source=carrier-pigeon&outcome=exploded");

    expect(filter.sources).toEqual(["web"]);
    expect(filter.outcomes).toEqual([]);
  });

  it("понимает период, заданный одной границей", () => {
    expect(parseFilter("?from=2026-09-01").from).toBe("2026-09-01");
    expect(parseFilter("?to=2026-09-30").to).toBe("2026-09-30");
  });

  it("не принимает дату, которой не бывает", () => {
    expect(parseFilter("?from=вчера").from).toBeUndefined();
    expect(parseFilter("?to=2026-13-45").to).toBeUndefined();
  });

  it("читает несколько значений и списком, и повтором параметра", () => {
    expect(parseFilter("?testId=t1,t2").testIds).toEqual(["t1", "t2"]);
    expect(parseFilter("?testId=t1&testId=t2").testIds).toEqual(["t1", "t2"]);
  });

  it("отличает пустой фильтр от заполненного", () => {
    expect(isEmptyFilter(parseFilter(""))).toBe(true);
    expect(isEmptyFilter(parseFilter("?outcome=passed"))).toBe(false);
  });
});
