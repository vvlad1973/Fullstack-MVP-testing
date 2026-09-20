/**
 * @module tests/rich-atoms
 * @description Атомарные узлы визуального редактора текста задания (PRD-57 FR-09b).
 *
 * Требование гарантирует по ПОСТРОЕНИЮ: листинг, формула и пропуск в визуальном редакторе
 * живут едиными объектами — курсор внутрь не попадает, форматирование их не рвёт, удаление
 * уносит узел целиком. Значит перед показом они заворачиваются в неразрывные узлы, а перед
 * сохранением разворачиваются обратно — байт в байт, иначе правка оформления потихоньку
 * съедала бы код и формулы.
 */
import { describe, it, expect } from "vitest";

import { toAtoms, fromAtoms } from "../shared/text/rich-atoms";

describe("заворачивание", () => {
  it("листинг становится неразрывным узлом", () => {
    const out = toAtoms('<p>Код:</p><pre><code class="language-sql">SELECT 1;</code></pre>');
    expect(out).toContain('contenteditable="false"');
    expect(out).toContain('data-atom="code"');
    expect(out).toContain("SELECT 1;");
  });

  it("формула — тоже узел, и её запись видна автору", () => {
    const out = toAtoms("<p>Доля $$E = mc^2$$ большая</p>");
    expect(out).toContain('data-atom="formula"');
    expect(out).toContain("$$E = mc^2$$");
  });

  it("пропуск — узел с именем поля", () => {
    const out = toAtoms("<p>Столица — {{city}}.</p>");
    expect(out).toContain('data-atom="blank"');
    expect(out).toContain("{{city}}");
  });

  it("обычный текст не трогается вовсе", () => {
    const source = "<p>Просто <b>текст</b></p>";
    expect(toAtoms(source)).toBe(source);
  });

  it("доллары ВНУТРИ листинга формулой не становятся", () => {
    // Это показанный автором код, и подменять его — портить задание.
    const out = toAtoms('<pre><code class="language-bash">echo $$PID</code></pre>');
    expect(out).not.toContain('data-atom="formula"');
  });

  it("скобки внутри листинга пропуском не становятся", () => {
    const out = toAtoms("<pre><code>{{ шаблон }}</code></pre>");
    expect(out).not.toContain('data-atom="blank"');
  });
});

describe("разворачивание", () => {
  it("возвращает исходную разметку байт в байт", () => {
    for (const source of [
      '<p>Код:</p><pre><code class="language-sql">SELECT 1;</code></pre>',
      "<p>Доля $$E = mc^2$$ большая</p>",
      "<p>Столица — {{city}}.</p>",
      "<p>Просто <b>текст</b></p>",
    ]) {
      expect(fromAtoms(toAtoms(source))).toBe(source);
    }
  });

  it("узел, набранный редактором по-своему, всё равно разворачивается", () => {
    // Браузер вправе переписать атрибуты узла местами или добавить свои — разворачивание
    // опирается на признак атома, а не на точное написание тега.
    const edited = '<span data-atom="blank" class="tb-atom" contenteditable="false">{{city}}</span>';
    expect(fromAtoms(`<p>${edited}</p>`)).toBe("<p>{{city}}</p>");
  });

  it("текст без атомов проходит без изменений", () => {
    expect(fromAtoms("<p>Просто текст</p>")).toBe("<p>Просто текст</p>");
  });

  it("пустая строка не роняет ни одну сторону", () => {
    expect(toAtoms("")).toBe("");
    expect(fromAtoms("")).toBe("");
  });
});
