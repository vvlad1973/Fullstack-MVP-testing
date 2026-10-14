import { describe, it, expect } from "vitest";
import { plainTextToHtml, sanitizePastedHtml } from "../rte-paste";

describe("sanitizePastedHtml", () => {
  it("снимает встроенные шрифты и размеры Word, оставляя жирный и абзацы", () => {
    const html =
      '<meta charset="utf-8"><!--StartFragment--><p class="MsoNormal" style="font-family:\'Times New Roman\';font-size:12pt">' +
      '<b style="mso-bidi-font-weight:normal"><span style="font-family:\'Times New Roman\'">Целевой уровень</span></b> говорит о…</p><!--EndFragment-->';
    const out = sanitizePastedHtml(html);
    expect(out).toBe("<p><b>Целевой уровень</b> говорит о…</p>");
    expect(out).not.toMatch(/style|font|Times/i);
  });

  it("div и заголовки становятся абзацами, span и font — просто текстом", () => {
    expect(sanitizePastedHtml("<div>Один</div><h2>Два</h2><font face=Arial>три</font>")).toBe("<p>Один</p><p>Два</p>три");
  });

  it("ссылки оставляет только http(s) и mailto, без прочих атрибутов", () => {
    expect(sanitizePastedHtml('<a href="https://a.ru" style="color:red" onclick="x()">я</a>')).toBe('<a href="https://a.ru">я</a>');
    expect(sanitizePastedHtml('<a href="javascript:alert(1)">я</a>')).toBe("я");
  });

  it("выбрасывает script и style вместе с содержимым", () => {
    expect(sanitizePastedHtml("<style>p{}</style><script>alert(1)</script><p>Текст</p>")).toBe("<p>Текст</p>");
  });

  it("списки сохраняются", () => {
    expect(sanitizePastedHtml('<ul style="x"><li class="a">Раз</li></ul>')).toBe("<ul><li>Раз</li></ul>");
  });
});

describe("plainTextToHtml", () => {
  it("строки становятся абзацами, разметка экранируется", () => {
    expect(plainTextToHtml("Раз\n\n<b>два</b>")).toBe("<p>Раз</p><p>&lt;b&gt;два&lt;/b&gt;</p>");
  });
});
