/**
 * @module shared/report/__tests__/report-context.breakdown-feedback
 *
 * PRD-50 FR-50 в ОТЧЁТЕ: текст подтемы выдаётся, когда доля БАЛЛОВ подтемы ниже общего
 * проходного порога теста, — «правило живёт в `shared/breakdown/feedback` и работает
 * одинаково на экране итогов, в отчёте и в SCORM-пакете» (§14).
 *
 * Дефект, пойманный живой приёмкой демонстрационного теста: сборщик отчёта не передавал
 * общий порог в общий построитель, а без порога правило по построению не отбирает ничего
 * («сравнивать не с чем — текст выдаётся везде, где автор его написал»). Итог: экран
 * печатал две рекомендации из пяти, а скачанный с него PDF — все пять, включая подтемы со
 * стопроцентным результатом. Расхождение двух выдач запрещено PRD-51 §5.2.
 */
import { describe, it, expect } from "vitest";
import { buildReportContext } from "../report-context";

const feedback = (text: string) => ({ format: "plain" as const, text, links: [], assets: [], events: [] });

/** Одна тема: подтема «Разобрана» на 100 %, подтема «Провалена» на 40 %. */
const result = {
  overallPassed: true,
  overallPercent: 70,
  totalQuestions: 4,
  totalCorrect: 3,
  totalEarnedPoints: 7,
  totalPossiblePoints: 10,
  topicResults: [
    {
      topicId: "t1",
      topicName: "Часть 1",
      correct: 3,
      total: 4,
      percent: 70,
      passed: true,
      earnedPoints: 7,
      possiblePoints: 10,
      breakdown: [
        { scope: "section:t1", axis: "tag", key: "Разобрана", items: 2, answered: 2, earned: 5, possible: 5, unitEarned: 2, unitPossible: 2, percentPoints: 100, percentUnits: 100 },
        { scope: "section:t1", axis: "tag", key: "Провалена", items: 2, answered: 2, earned: 2, possible: 5, unitEarned: 1, unitPossible: 2, percentPoints: 40, percentUnits: 50 },
      ],
      breakdownFeedback: {
        Разобрана: feedback("Подтема освоена — читать нечего."),
        Провалена: feedback("Подтема просела — вот что делать."),
      },
    },
  ],
};

describe("тексты подтем в отчёте (PRD-50 FR-50)", () => {
  it("печатает текст подтемы ниже порога и молчит о подтеме выше него", () => {
    const ctx = buildReportContext(
      {
        result,
        testName: "Тест",
        overallPassRule: { type: "percent", value: 70 },
      } as never,
      { values: {} } as never,
    );
    const texts = (ctx.result as { recommendations?: { texts: string[] } }).recommendations?.texts ?? [];
    expect(texts, "текст просевшей подтемы обязан быть в документе").toContain(
      "Подтема просела — вот что делать.",
    );
    expect(texts, "подтема со 100 % не должна приносить рекомендацию").not.toContain(
      "Подтема освоена — читать нечего.",
    );
  });

  it("без общего порога печатает всё написанное — сравнивать не с чем", () => {
    const ctx = buildReportContext({ result, testName: "Тест" } as never, { values: {} } as never);
    const texts = (ctx.result as { recommendations?: { texts: string[] } }).recommendations?.texts ?? [];
    expect(texts).toHaveLength(2);
  });
});
