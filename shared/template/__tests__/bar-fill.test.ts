/**
 * @module shared/template/__tests__/bar-fill
 *
 * Окраска полос подтем: разрешение режима из параметров оформления и готовая заливка
 * «по доле».
 *
 * Главное свойство заливки — полоса шириной `p` показывает ЛЕВУЮ ЧАСТЬ рампы, растянутой
 * на всю дорожку: начинается неблагоприятным краем и кончается цветом рампы в точке `p`.
 * Отсюда проверки концов, а не только формы строки.
 */
import { describe, expect, it } from "vitest";
import { barFillCss, barFillFromParams } from "../bar-fill";
import { LEVEL_SCHEMES, type LevelRamp } from "../level-ramp";

/** Брендовая пара «Сертификации» — схема «Своя» без середины. */
const BRAND: LevelRamp = { favorable: "163.9 79.2% 47.1%", mid: null, unfavorable: "15.4 100% 53.5%" };

/** Цветовые остановки заливки: `[цвет, позиция]`. */
function stops(css: string): Array<[string, number]> {
  const body = css.replace(/^linear-gradient\(90deg, /, "").replace(/\)$/, "");
  return body.split(/,\s*(?=hsl\()/).map((s) => {
    const m = /^(hsl\([^)]*\)) ([\d.]+)%$/.exec(s.trim());
    if (!m) throw new Error("неразборная остановка: " + s);
    return [m[1], Number(m[2])];
  });
}

describe("barFillFromParams", () => {
  it("режим «по вердикту» и отсутствие параметра дают null — контекст прежний", () => {
    expect(barFillFromParams({})).toBeNull();
    expect(barFillFromParams({ breakdownBarFill: "verdict" })).toBeNull();
    expect(barFillFromParams(null)).toBeNull();
  });

  it("неизвестное значение читается как «по вердикту», а не перекрашивает экран", () => {
    expect(barFillFromParams({ breakdownBarFill: "gradient" })).toBeNull();
  });

  it("«по доле» берёт рампу из схемы уровней теста", () => {
    expect(barFillFromParams({ breakdownBarFill: "share", levelScheme: "neutral" })).toEqual({
      mode: "share",
      ramp: LEVEL_SCHEMES.neutral,
    });
    expect(
      barFillFromParams({
        breakdownBarFill: "share",
        levelScheme: "custom",
        levelColorFavorable: BRAND.favorable,
        levelColorUnfavorable: BRAND.unfavorable,
      }),
    ).toEqual({ mode: "share", ramp: BRAND });
  });

  it("«нейтральная» тоже передаётся построителю: она снимает вердикт с полосы", () => {
    expect(barFillFromParams({ breakdownBarFill: "neutral" })?.mode).toBe("neutral");
  });
});

describe("barFillCss", () => {
  it("пустая полоса заливки не получает", () => {
    expect(barFillCss(BRAND, 0)).toBe("");
    expect(barFillCss(BRAND, -5)).toBe("");
    expect(barFillCss(BRAND, Number.NaN)).toBe("");
  });

  it("полная полоса идёт от неблагоприятного края к благоприятному", () => {
    const s = stops(barFillCss(BRAND, 100));
    expect(s[0]).toEqual(["hsl(15.4, 100%, 53.5%)", 0]);
    expect(s[s.length - 1]).toEqual(["hsl(163.9, 79.2%, 47.1%)", 100]);
  });

  it("короткая полоса — левая часть рампы: конец не благоприятный, а цвет рампы в точке доли", () => {
    const full = stops(barFillCss(BRAND, 100));
    const quarter = stops(barFillCss(BRAND, 25));
    // Остановка 0.25 полной рампы и конец четвертной полосы — один и тот же цвет.
    const atQuarter = full.find(([, pos]) => pos === 25)![0];
    expect(quarter[quarter.length - 1]).toEqual([atQuarter, 100]);
    expect(quarter[0]).toEqual(["hsl(15.4, 100%, 53.5%)", 0]);
  });

  it("позиции остановок отсчитываются от заливки и растут до 100 %", () => {
    const s = stops(barFillCss(BRAND, 40));
    const positions = s.map(([, pos]) => pos);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(positions[0]).toBe(0);
    expect(positions[positions.length - 1]).toBe(100);
  });

  it("рампа с серединой получает остановку ровно в её точке", () => {
    const s = stops(barFillCss(LEVEL_SCHEMES.traffic, 100));
    expect(s).toContainEqual(["hsl(38, 92%, 50%)", 50]);
  });

  it("испорченный цвет своей схемы не попадает в style: подставляется край светофора", () => {
    const css = barFillCss({ favorable: "red; background: url(x)", mid: "oops", unfavorable: BRAND.unfavorable }, 100);
    expect(css).not.toMatch(/url|red|oops/);
    expect(stops(css)[stops(css).length - 1][0]).toBe("hsl(142, 76%, 36%)");
  });
});
