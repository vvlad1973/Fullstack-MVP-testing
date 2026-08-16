/**
 * @module tests/certification-report-document
 *
 * PRD-51 Э4 — ДОКУМЕНТ ОТЧЁТА шаблона «Сертификация» (FR-22).
 *
 * Пиннятся метрики, снятые с референса (§10.3), и объявления документа. Облик проверяется
 * растром в приёмке; здесь — то, чего растр не покажет: если полотно титула перестанет
 * быть белым, снимок это увидит, а вот подмену `course.title` на статику или блок,
 * объявленный без раскладки, — нет.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const CERT = path.join(process.cwd(), "templates", "certification");
const css = fs.readFileSync(path.join(CERT, "styles", "report.css"), "utf8");

describe("лист документа «Сертификации» светлый", () => {
  it("фон листа — серый референса, а не тёмный эталона", () => {
    expect(css).toMatch(/\.tb-report\s*\{[^}]*background:\s*#E2E2E2/i);
  });

  it("полотно титула белое", () => {
    expect(css).toMatch(/\.tb-report__cover\s*\{[^}]*background:\s*#FFFFFF/i);
  });

  it("карточка вердикта тёмная — единственный тёмный узел документа", () => {
    expect(css).toMatch(/\.tb-report__card--verdict\s*\{[^}]*background:\s*#101828/i);
  });

  it("бейдж счётчика оранжевый", () => {
    expect(css).toMatch(/\.tb-report__topic-group-counter\s*\{[^}]*background:\s*#FF4F12/i);
  });

  it("цвета исхода объявлены оба", () => {
    expect(css).toContain("#FF4F12");
    expect(css).toContain("#19D7A4");
  });

  it("знак исхода рисуется стилем по классу вердикта, а не ветвлением в разметке", () => {
    expect(css).toMatch(/\.tb-report\.is-pass\s+\.tb-report__mark::before/);
    expect(css).toMatch(/\.tb-report\.is-fail\s+\.tb-report__mark::before/);
  });
});
