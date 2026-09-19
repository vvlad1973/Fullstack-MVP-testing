/**
 * @module tests/scorm-interactions
 *
 * PRD-57 FR-27: как короткий ответ уезжает в отчёт LMS.
 *
 * Функции рантайма пакета исполняются в песочнице тем же приёмом, каким это делает
 * `tests/lms-attempt-result.test.ts`: объявления функций не требуют ни состояния прогона,
 * ни SCORM-хоста, поэтому проверять их можно по отдельности.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const qTypeSrc = readFileSync(resolve(process.cwd(), "server/scorm/template/app/utils/qtype.js"), "utf8");
const resultsSrc = readFileSync(resolve(process.cwd(), "server/scorm/template/app/render/resultsPage.js"), "utf8");

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const runtime = new Function(
  "TBTemplate",
  `${qTypeSrc}
   ${resultsSrc}
   return { mapScormType: mapScormType, formatResponse: formatResponse,
            correctPatternFor: correctPatternFor };`,
)({}) as {
  mapScormType: (q: unknown) => string;
  formatResponse: (q: unknown, ans: unknown) => string;
  correctPatternFor: (q: unknown) => string;
};

const literalRules = {
  answerKind: "text",
  join: "any",
  rules: [
    { kind: "text", match: "wildcard", value: "Ростехнадзор" },
    { kind: "text", match: "wildcard", value: "РТН" },
  ],
};

const wildcardRules = {
  answerKind: "text",
  join: "any",
  rules: [{ kind: "text", match: "wildcard", value: "Федеральная служба по * надзору" }],
};

describe("короткий ответ в отчёте LMS", () => {
  it("уезжает взаимодействием fill-in", () => {
    expect(runtime.mapScormType({ type: "short" })).toBe("fill-in");
  });

  it("ответ участника уходит строкой как есть", () => {
    expect(runtime.formatResponse({ type: "short" }, "  Ростехнадзор ")).toBe("  Ростехнадзор ");
    expect(runtime.formatResponse({ type: "short" }, null)).toBe("");
  });

  it("эталон пишется, когда все правила буквальные", () => {
    expect(runtime.correctPatternFor({ type: "short", correct: literalRules })).toBe("Ростехнадзор[,]РТН");
  });

  it("правило с подстановочным знаком эталона не даёт вовсе", () => {
    // `*` не предусмотрен стандартом для `fill-in`: отправить образец эталоном значило бы
    // соврать в отчёте, а промолчать — честно.
    expect(runtime.correctPatternFor({ type: "short", correct: wildcardRules })).toBe("");
  });

  it("у задания без правил эталона нет", () => {
    expect(runtime.correctPatternFor({ type: "short", correct: { answerKind: "text", join: "any", rules: [] } })).toBe("");
    expect(runtime.correctPatternFor({ type: "short", correct: {} })).toBe("");
  });

  it("прочие типы своего эталона не теряют", () => {
    expect(runtime.correctPatternFor({ type: "single", correct: { correctIndex: 2 } })).toBe("3");
  });
});
