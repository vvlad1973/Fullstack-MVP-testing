/**
 * @module shared/report/__tests__/paginate-dom.backgrounds
 *
 * Фон листов отчёта: картинка-подложка остаётся титульной, а листы продолжения печатаются
 * тем фоном, который шаблон объявил под классом `tb-report--continued`.
 *
 * Ни многолистовой раскладки, ни вычисленного `background` из таблиц стилей jsdom не
 * строит, поэтому каскад здесь изображает двойник `getComputedStyle`: инлайновая картинка
 * перебивает всё, класс продолжения даёт фон продолжения, иначе — фон корня. Предмет
 * проверки — порядок замера: что снимается и ставится на время и что возвращается после.
 * Сам каскад и растеризацию проверяет прогон в браузере.
 */
import { describe, expect, it } from "vitest";
import { CONTINUED_SHEET_CLASS, pageBackgrounds } from "../paginate-dom";

const IMAGE = 'url("data:image/png;base64,AAAA")';
const ROOT_BG = "rgb(28, 28, 43)";
const CONTINUED_BG = "rgb(255, 255, 255)";

/**
 * Документ с двойником каскада шаблона.
 *
 * @param declaresContinued Объявил ли шаблон правило под классом продолжения.
 * @returns Документ, чей `defaultView.getComputedStyle` считает `background` по состоянию
 *   элемента в момент вызова.
 */
function docWithCascade(declaresContinued: boolean): Document {
  const view = {
    getComputedStyle: (el: HTMLElement) => ({
      background: el.style.backgroundImage
        ? el.style.backgroundImage
        : declaresContinued && el.classList.contains(CONTINUED_SHEET_CLASS)
          ? CONTINUED_BG
          : ROOT_BG,
    }),
  };
  return { defaultView: view } as unknown as Document;
}

/**
 * Корень отчёта, каким его отдаёт макет.
 *
 * @param inlineImage Инлайновая подложка; пустая строка — автор подложку убрал.
 * @returns Корень `.tb-report`.
 */
function root(inlineImage = IMAGE): HTMLElement {
  const el = document.createElement("div");
  el.className = "tb-report";
  if (inlineImage) el.style.backgroundImage = inlineImage;
  return el;
}

describe("pageBackgrounds", () => {
  it("титульной — картинка, продолжению — фон, объявленный под классом продолжения", () => {
    const { cover, rest } = pageBackgrounds(root(), docWithCascade(true));
    expect(cover).toContain("data:image/png");
    expect(rest).toBe(CONTINUED_BG);
  });

  it("шаблон без правила под классом: продолжению — фон корня без картинки", () => {
    const { rest } = pageBackgrounds(root(), docWithCascade(false));
    expect(rest).toBe(ROOT_BG);
  });

  it("корень без картинки: титульная — фон корня, продолжение — фон под классом", () => {
    const { cover, rest } = pageBackgrounds(root(""), docWithCascade(true));
    expect(cover).toBe(ROOT_BG);
    expect(rest).toBe(CONTINUED_BG);
  });

  it("после замера корень прежний: картинка на месте, класса продолжения нет", () => {
    const el = root();
    pageBackgrounds(el, docWithCascade(true));
    expect(el.style.backgroundImage).toContain("data:image/png");
    expect(el.classList.contains(CONTINUED_SHEET_CLASS)).toBe(false);
  });
});
