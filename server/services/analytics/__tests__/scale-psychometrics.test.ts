/**
 * @module server/services/analytics/__tests__/scale-psychometrics
 * @description PRD-66 FR-29 — FR-32: психометрика измерительных шкал.
 */
import { describe, expect, it } from "vitest";

import { computeScalePsychometrics, type ScaleContext } from "../scale-psychometrics";
import type { ResponseFact } from "../response-matrix";

function fact(over: Partial<ResponseFact> & Pick<ResponseFact, "questionId" | "respondentId" | "answer">): ResponseFact {
  return {
    observationId: `obs-${over.respondentId}`,
    source: "web",
    psychoHash: "hash-1",
    // Измерительный ответ не бывает ни верным, ни неверным: доли балла у него нет.
    outcome: "neutral",
    score: null,
    maxScore: null,
    scoreRatio: null,
    latencyMs: null,
    formKey: null,
    groupKeys: [],
    occurredAt: new Date("2026-09-20T10:00:00Z"),
    ...over,
  } as ResponseFact;
}

/** Пункт шкалы: ответ — индекс градации, вклад равен индексу. */
const ITEM_INFO = (questionId: string) => ({
  questionId,
  prompt: `Пункт ${questionId}`,
  type: "scale",
  gradeLabels: ["Никогда", "Редко", "Иногда", "Часто", "Всегда"],
});

/** Единицы измерения: каждая градация вносит свой номер в шкалу. */
function measurementsFor(questionIds: string[], scaleKey = "burnout") {
  return questionIds.flatMap(questionId =>
    [0, 1, 2, 3, 4].map(grade => ({
      questionId,
      scaleKey,
      sourceType: "option" as const,
      sourceKey: String(grade),
      value: grade,
      weight: 1,
    })));
}

const CTX: ScaleContext = {
  measurements: measurementsFor(["s1", "s2", "s3"]),
  scaleLabels: new Map([["burnout", "Эмоциональное истощение"]]),
  itemById: new Map([
    ["s1", ITEM_INFO("s1")],
    ["s2", ITEM_INFO("s2")],
    ["s3", ITEM_INFO("s3")],
  ]),
};

/** Пять респондентов; третий пункт отвечает ПРОТИВ шкалы — его вклад зеркален. */
const RESPONSES: ResponseFact[] = [];
for (const [respondentId, a, b, c] of [
  ["R1", 0, 0, 4], ["R2", 1, 1, 3], ["R3", 2, 2, 2], ["R4", 3, 3, 1], ["R5", 4, 4, 0],
] as Array<[string, number, number, number]>) {
  RESPONSES.push(fact({ respondentId, questionId: "s1", answer: a }));
  RESPONSES.push(fact({ respondentId, questionId: "s2", answer: b }));
  RESPONSES.push(fact({ respondentId, questionId: "s3", answer: c }));
}

describe("computeScalePsychometrics", () => {
  it("считает альфу шкалы по ВКЛАДАМ, а не по номерам градаций", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);

    expect(scale.scaleKey).toBe("burnout");
    expect(scale.label).toBe("Эмоциональное истощение");
    expect(scale.respondents).toBe(5);
    expect(typeof scale.reliability).not.toBe("string");
  });

  it("пункт, ведущий себя против шкалы, помечается — без догадки о причине", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    const third = scale.items.find(i => i.questionId === "s3")!;

    expect(third.itemRest!).toBeLessThan(0);
    expect(third.againstScale).toBe(true);
  });

  it("вместо причины даёт ВЫЧИСЛИМОЕ следствие: альфу с перевёрнутым вкладом (FR-31b)", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    const third = scale.items.find(i => i.questionId === "s3")!;
    const before = typeof scale.reliability === "string" ? null : scale.reliability.alpha;

    expect(third.alphaIfMirrored).not.toBeNull();
    expect(third.alphaIfMirrored!).toBeGreaterThan(before!);
  });

  it("согласованному пункту следствие не показывается — переворачивать нечего", () => {
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    expect(scale.items.find(i => i.questionId === "s1")!.alphaIfMirrored).toBeNull();
  });

  it("распределение по градациям берёт их число у ВОПРОСА", () => {
    // Шкалу задаёт автор: бывает и семибалльная, и десятибалльная (FR-30b).
    const [scale] = computeScalePsychometrics(RESPONSES, CTX);
    const first = scale.items.find(i => i.questionId === "s1")!;

    expect(first.distribution).toHaveLength(5);
    expect(first.distribution.every(share => share === 0.2)).toBe(true);
    expect(first.gradeLabels[0]).toBe("Никогда");
  });

  it("мёртвый пункт опознаётся по форме распределения", () => {
    const flat: ResponseFact[] = [];
    for (const respondentId of ["R1", "R2", "R3", "R4", "R5"]) {
      flat.push(fact({ respondentId, questionId: "s1", answer: 2 }));
      flat.push(fact({ respondentId, questionId: "s2", answer: 1 }));
    }
    const [scale] = computeScalePsychometrics(flat, {
      ...CTX,
      measurements: measurementsFor(["s1", "s2"]),
    });

    expect(scale.items.find(i => i.questionId === "s1")!.dead).toBe(true);
  });

  it("ипсативная методика помечается: вклады там связаны по построению (FR-32)", () => {
    // Сумма вкладов у каждого респондента одна и та же — так устроено распределение баллов.
    const ipsative: ResponseFact[] = [];
    for (const [respondentId, a, b] of [["R1", 1, 3], ["R2", 2, 2], ["R3", 3, 1]] as Array<[string, number, number]>) {
      ipsative.push(fact({ respondentId, questionId: "s1", answer: a }));
      ipsative.push(fact({ respondentId, questionId: "s2", answer: b }));
    }
    const [scale] = computeScalePsychometrics(ipsative, {
      ...CTX,
      measurements: measurementsFor(["s1", "s2"]),
    });

    expect(scale.ipsative).toBe(true);
  });

  it("задание, не вносящее вклада ни в одну шкалу, в расчёт не идёт", () => {
    const withGraded = [...RESPONSES, fact({ respondentId: "R1", questionId: "q-graded", answer: 0 })];
    const [scale] = computeScalePsychometrics(withGraded, CTX);

    expect(scale.items.map(i => i.questionId)).not.toContain("q-graded");
  });

  it("на пустой выборке шкал не выдумывает", () => {
    expect(computeScalePsychometrics([], CTX)).toEqual([]);
  });
});
