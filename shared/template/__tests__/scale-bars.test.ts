/**
 * Линейчатая диаграмма шкал: общая ось, столбики и числа.
 *
 * Закрепляется главное, ради чего вид заведён, — ОДНА ось на все строки. Карточки, которые
 * он заменяет, масштабируются доменом своей шкалы, и «27 из 45» рядом с «30 из 98» давали
 * почти одинаковую длину; здесь длина обязана говорить о величине.
 */
import { describe, expect, it } from "vitest";
import { buildScaleBars } from "../scale-bars";
import { buildMeasureView } from "../measure-view";
import { LEVEL_SCHEMES } from "../level-ramp";
import type { ScaleInterpretation } from "../../scales/interpretation";

function interp(domainMax: number, extra: Partial<ScaleInterpretation> = {}): ScaleInterpretation {
  return { domainMin: 0, domainMax, displayMax: null, valence: "none", bands: [], ...extra };
}

function measure(key: string, name: string, value: number, interpretation: ScaleInterpretation) {
  return { key, name, value, visibility: "level_and_value" as const, interpretation };
}

/** Карточки строит то же ядро, что и в контексте итогов: диаграмма берёт их надписи. */
function bars(measures: ReturnType<typeof measure>[], showMax = true) {
  const views = measures.map((m) =>
    buildMeasureView({ ...m, requestedKind: "bars", ramp: LEVEL_SCHEMES.traffic, showMax }),
  );
  return buildScaleBars({ measures, views, ramp: LEVEL_SCHEMES.traffic });
}

describe("линейчатая диаграмма шкал", () => {
  it("кладёт все шкалы на ОДНУ ось — наибольший максимум из показанных", () => {
    const out = bars([
      measure("a", "Короткая", 27, interp(45)),
      measure("b", "Длинная", 30, interp(98)),
    ]);
    expect(out?.axisMinText).toBe("0");
    expect(out?.axisMaxText).toBe("98");
    // 27 и 30 от одной оси 0..98 — 27.6 % и 30.6 %. От своих доменов было бы 60 % и 30.6 %.
    expect(out?.rows[0].widthPercent).toBeCloseTo(27.6, 1);
    expect(out?.rows[1].widthPercent).toBeCloseTo(30.6, 1);
  });

  it("печатает число тем же текстом, что карточка", () => {
    const withMax = bars([measure("a", "Шкала", 21, interp(98))]);
    expect(withMax?.rows[0].valueLabel).toBe("21 из 98");
    const withoutMax = bars([measure("a", "Шкала", 21, interp(98))], false);
    expect(withoutMax?.rows[0].valueLabel).toBe("21");
    expect(withoutMax?.rows[0].valueText).toBe("21");
  });

  it("берёт предел рисунка автора, когда он задан", () => {
    // `displayMax` — то же, чем роза укорачивает луч: две фигуры одного экрана не должны
    // спорить о масштабе.
    const out = bars([measure("a", "Шкала", 20, interp(98, { displayMax: 40 }))]);
    expect(out?.axisMaxText).toBe("40");
    expect(out?.rows[0].widthPercent).toBeCloseTo(50, 1);
  });

  it("красит столбик по положению в СВОЁМ домене, а не на общей оси", () => {
    // Иначе высокий балл короткой шкалы читался бы как низкий: цвет говорит об уровне.
    const ramp = LEVEL_SCHEMES.traffic;
    const graded = interp(45, { valence: "higher_is_better" });
    const out = buildScaleBars({
      measures: [measure("a", "Короткая", 45, graded), measure("b", "Длинная", 45, interp(98, { valence: "higher_is_better" }))],
      views: [
        buildMeasureView({ ...measure("a", "Короткая", 45, graded), requestedKind: "bars", ramp }),
        buildMeasureView({ ...measure("b", "Длинная", 45, interp(98, { valence: "higher_is_better" })), requestedKind: "bars", ramp }),
      ],
      ramp,
    });
    // Первая шкала на своём максимуме — благоприятный край рампы; вторая на 46 % — нет.
    expect(out?.rows[0].color).toBe(ramp.favorable);
    expect(out?.rows[1].color).not.toBe(ramp.favorable);
  });

  it("не строится, когда домена нет ни у одной шкалы", () => {
    const out = bars([measure("a", "Без домена", 12, { domainMin: null, domainMax: null, displayMax: null, valence: "none", bands: [] })]);
    // Строка без столбика — это число, притворяющееся диаграммой; такую шкалу печатает
    // карточка, куда её отправил откат вида.
    expect(out).toBeNull();
  });

  it("пропускает шкалу без домена, оставляя остальные на общей оси", () => {
    const out = bars([
      measure("a", "С доменом", 49, interp(98)),
      measure("b", "Без домена", 12, { domainMin: null, domainMax: null, displayMax: null, valence: "none", bands: [] }),
    ]);
    expect(out?.rows).toHaveLength(1);
    expect(out?.rows[0].key).toBe("a");
    expect(out?.rows[0].widthPercent).toBeCloseTo(50, 1);
  });

  it("держит значение за пределом домена в границах оси", () => {
    const out = bars([measure("a", "Перебор", 120, interp(98))]);
    expect(out?.rows[0].widthPercent).toBe(100);
  });
});
