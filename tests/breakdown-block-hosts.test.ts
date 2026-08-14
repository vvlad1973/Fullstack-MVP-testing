/**
 * @module tests/breakdown-block-hosts
 * @description PRD-50 FR-28/FR-44 (Э4), задача 8: записи разреза в области ТЕСТА доезжают
 * до сборщика контекста на ОБОИХ хостах, и берутся они из СОХРАНЁННОГО результата.
 *
 * Контекст сам по себе не покажет ничего: ядро считает записи давно, но веб-адаптер
 * перечисляет поля результата поимённо, а пакет держит их в плоском списке для формул и
 * не клал в попытку вовсе. Главное, что здесь стережётся: тест БЕЗ включённого блока даёт
 * ровно прежний контекст и ровно прежнюю запись попытки.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";
import type { AttemptResult, TopicResult } from "../shared/schema";
import { breakdownDisplaySchema } from "../shared/schema";
import { buildResultContext, buildReportInput, type MeasuresSource } from "../server/services/result-context";

const sectionEntry = {
  scope: "section:law", axis: "tag", key: "ПДн", items: 2, answered: 2, earned: 1, possible: 2,
  unitEarned: 1, unitPossible: 2, percentPoints: 50, percentUnits: 50,
};
const testEntry = { ...sectionEntry, scope: "test", items: 4, answered: 4, earned: 3, possible: 4,
  unitEarned: 3, unitPossible: 4, percentPoints: 75, percentUnits: 75 };

const storedTopic = (): TopicResult =>
  ({
    topicId: "law", topicName: "Право", correct: 1, total: 2, percent: 50,
    earnedPoints: 1, possiblePoints: 2, passed: false, passRule: null,
    recommendedCourses: [], recommendedEvents: [], recommendedAssets: [], feedbackTexts: [],
    breakdown: [sectionEntry],
  }) as unknown as TopicResult;

const storedResult = (breakdowns?: unknown[]): AttemptResult =>
  ({
    totalCorrect: 3, totalQuestions: 4, overallPercent: 75,
    totalEarnedPoints: 3, totalPossiblePoints: 4, overallPassed: true,
    topicResults: [storedTopic()],
    ...(breakdowns === undefined ? {} : { breakdowns }),
  }) as unknown as AttemptResult;

const measures = (breakdownDisplayJson?: unknown): MeasuresSource =>
  ({
    scales: [], variables: [], blockSettings: {}, hasPassThreshold: true,
    ...(breakdownDisplayJson === undefined ? {} : { breakdownDisplayJson }),
  }) as unknown as MeasuresSource;

const BLOCK_ON = { visibility: "bar", basis: "units", placement: "block" };

// ─── Настройка теста ─────────────────────────────────────────────────────────

describe("настройка разреза принимает положение показа", () => {
  it("принимает все три положения", () => {
    for (const placement of ["topics", "block", "both"]) {
      expect(breakdownDisplaySchema.parse({ visibility: "bar", basis: "units", placement }).placement)
        .toBe(placement);
    }
  });

  it("настройка, сохранённая до Э4, остаётся валидной и без положения", () => {
    const parsed = breakdownDisplaySchema.parse({ visibility: "bar", basis: "points" });
    expect(parsed.placement).toBeUndefined();
  });

  it("чужое значение положения отвергается, а не толкуется молча", () => {
    expect(breakdownDisplaySchema.safeParse({ visibility: "bar", basis: "units", placement: "card" }).success)
      .toBe(false);
  });
});

// ─── Веб-хост ────────────────────────────────────────────────────────────────

describe("веб-хост: сохранённые записи области теста доезжают до контекста", () => {
  it("экран печатает сводный блок из записей попытки", () => {
    const { result } = buildResultContext(storedResult([testEntry]), "Тест", measures(BLOCK_ON));
    const rows = (result as { breakdown?: Array<Record<string, unknown>> }).breakdown;
    expect(rows).toHaveLength(1);
    // Числа — сохранённые (4 вопроса, 75 %), а не сумма секционной записи темы (2 и 50 %).
    expect(rows![0]).toMatchObject({ key: "ПДн", items: 4, barPercent: 75 });
    expect(result.blocks?.map((b) => b.key)).toContain("breakdown");
  });

  it("блок выключен — контекст без единого нового поля", () => {
    const { result } = buildResultContext(
      storedResult([testEntry]),
      "Тест",
      measures({ visibility: "bar", basis: "units" }),
    );
    expect("breakdown" in result).toBe(false);
    expect(result.blocks?.map((b) => b.key)).not.toContain("breakdown");
  });

  it("попытка, оценённая до PRD-50, записей не несёт — блока нет", () => {
    const { result } = buildResultContext(storedResult(), "Тест", measures(BLOCK_ON));
    expect("breakdown" in result).toBe(false);
  });

  it("вход отчёта везёт те же записи, что экран (§5.2)", () => {
    const input = buildReportInput(storedResult([testEntry]), "Тест", {}, measures(BLOCK_ON));
    expect(input.result.breakdowns).toEqual([testEntry]);
    expect(input.breakdownDisplay).toMatchObject({ placement: "block" });
  });

  it("тест без записей — вход отчёта прежний", () => {
    const input = buildReportInput(storedResult(), "Тест", {}, measures(BLOCK_ON));
    expect("breakdowns" in input.result).toBe(false);
  });
});

// ─── Пакет SCORM ─────────────────────────────────────────────────────────────

const runtime = (file: string) =>
  readFileSync(resolve(process.cwd(), "server/scorm/template/app", file), "utf8");

describe("пакет SCORM: рантайм передаёт записи области теста", () => {
  const viewSrc = runtime("render/viewResults.js");
  const pdfSrc = runtime("utils/pdfExport.js");
  const suspendSrc = runtime("utils/scorm/suspendAttempts.js");

  /** Достаёт плоскую ES5-функцию из рантайма пакета. */
  const lift = (src: string, name: string) => {
    const match = src.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n\\}`));
    if (!match) throw new Error(`${name} not found`);
    // eslint-disable-next-line @typescript-eslint/no-implied-eval
    return new Function(`${match[0]}\n;return ${name};`)() as (...args: never[]) => unknown;
  };

  it("читатель берёт ТОЛЬКО область теста, из любой формы результата", () => {
    const vrTestBreakdown = lift(viewSrc, "vrTestBreakdown") as (r: unknown) => unknown[];
    // Текущая попытка: плоский список обеих областей.
    expect(vrTestBreakdown({ breakdowns: [sectionEntry, testEntry] })).toEqual([testEntry]);
    // Сохранённая попытка: только область теста.
    expect(vrTestBreakdown({ breakdowns: [testEntry] })).toEqual([testEntry]);
    // Попытка старого пакета: поля нет вовсе.
    expect(vrTestBreakdown({})).toEqual([]);
  });

  it("оба экрана итогов кладут записи во ВХОД сборщика", () => {
    // Два экрана — финиш и «Мой результат»; пропуск одного читается как «блок то есть, то
    // нет» и ничем другим не ловится.
    expect(viewSrc.match(/input\.breakdowns = \w+;/g)).toHaveLength(2);
    expect(viewSrc.match(/= vrTestBreakdown\(results\);/g)).toHaveLength(2);
  });

  it("отчёт пакета собирается из тех же записей, что экран", () => {
    expect(pdfSrc).toMatch(/vrTestBreakdown\(results\)/);
    expect(pdfSrc).toMatch(/input\.breakdowns = testRows/);
  });

  it("сохранённая попытка уносит записи области теста, и только их", () => {
    const testScopeBreakdowns = lift(suspendSrc, "testScopeBreakdowns") as (e: unknown) => unknown;
    expect(testScopeBreakdowns([sectionEntry, testEntry])).toEqual([testEntry]);
    // Тест без ключей не должен утяжелять suspend_data ни на байт: `JSON.stringify`
    // гасит `undefined`, а пустой массив писался бы в КАЖДУЮ попытку КАЖДОГО теста.
    expect(testScopeBreakdowns([sectionEntry])).toBeUndefined();
    expect(testScopeBreakdowns(undefined)).toBeUndefined();
    expect(JSON.stringify({ breakdowns: testScopeBreakdowns([]) })).toBe("{}");
  });

  it("запись попытки несёт поле, иначе «Мой результат» печатал бы пустой блок", () => {
    expect(suspendSrc).toMatch(/breakdowns: testScopeBreakdowns\(resultData\.breakdowns\)/);
  });
});

// ─── Шаблоны ─────────────────────────────────────────────────────────────────

describe("оба поставляемых шаблона знают ключ блока", () => {
  const manifest = (p: string) => JSON.parse(readFileSync(resolve(process.cwd(), p), "utf8")) as {
    resultsBlockOrder: Record<string, string[]>;
    labels: Array<{ key: string; default: string }>;
  };

  for (const [name, path] of [
    ["Стандартный", "server/scorm/templates/default/manifest.json"],
    ["Сертификация", "templates/certification/manifest.json"],
  ]) {
    it(`«${name}» объявляет breakdown в порядке блоков и надпись его заголовка`, () => {
      const m = manifest(path);
      expect(m.resultsBlockOrder.default).toContain("breakdown");
      expect(m.labels.some((l) => l.key === "results.breakdown" && l.default.length > 0)).toBe(true);
    });
  }
});
