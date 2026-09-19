import { describe, it, expect } from "vitest";
import { renderShortAnswer } from "../shared/template/question-interaction";

describe("renderShortAnswer", () => {
  it("рисует одно однострочное поле", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, null);
    expect(html).toContain("ou-field__input");
    expect(html).not.toContain("<textarea");
  });

  it("подставляет ответ участника", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, "РТН");
    expect(html).toContain('value="РТН"');
  });

  it("экранирует ответ, а не исполняет его", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, '"><img src=x onerror=alert(1)>');
    expect(html).not.toContain("<img");
    expect(html).toContain("&quot;");
  });

  it("показывает единицу измерения подписью у поля", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, null, { numeric: true, unit: "°C" });
    expect(html).toContain("ou-field__affix");
    expect(html).toContain("°C");
    expect(html).toContain('inputmode="decimal"');
  });

  it("в режиме только для чтения поле заперто", () => {
    const html = renderShortAnswer({ type: "short", dataJson: {} }, "РТН", { readonly: true });
    expect(html).toContain("disabled");
  });
});

describe("attachShortAnswer", () => {
  const mount = (html: string): HTMLElement => {
    const root = document.createElement("div");
    root.innerHTML = html;
    return root;
  };

  it("отдаёт хосту набранную строку как есть, без нормализации", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount(renderShortAnswer({ type: "short", dataJson: {} }, null));
    const seen: string[] = [];
    const detach = attachShortAnswer(root, { getAnswer: () => "", setAnswer: (v) => seen.push(v) });

    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "  Ростехнадзор ";
    input.dispatchEvent(new Event("input"));

    expect(seen).toEqual(["  Ростехнадзор "]);
    detach();
  });

  it("после отписки ничего не отдаёт", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount(renderShortAnswer({ type: "short", dataJson: {} }, null));
    const seen: string[] = [];
    const detach = attachShortAnswer(root, { getAnswer: () => "", setAnswer: (v) => seen.push(v) });
    detach();

    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "поздно";
    input.dispatchEvent(new Event("input"));

    expect(seen).toEqual([]);
  });

  it("молчит, пока ответ заперт", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const root = mount(renderShortAnswer({ type: "short", dataJson: {} }, null));
    const seen: string[] = [];
    attachShortAnswer(root, { getAnswer: () => "", setAnswer: (v) => seen.push(v), isLocked: () => true });

    const input = root.querySelector("input") as HTMLInputElement;
    input.value = "не считается";
    input.dispatchEvent(new Event("input"));

    expect(seen).toEqual([]);
  });

  it("не падает, когда поля на экране нет", async () => {
    const { attachShortAnswer } = await import("../shared/template/short-answer-dom");
    const detach = attachShortAnswer(mount("<div></div>"), { getAnswer: () => "", setAnswer: () => {} });
    expect(() => detach()).not.toThrow();
  });
});
