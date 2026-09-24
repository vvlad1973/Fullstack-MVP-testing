/**
 * @module server/services/analytics/__tests__/psychometrics
 * @description Сведение матрицы наблюдений и расчётного движка (PRD-66).
 *
 * Формулы проверены в `shared/psychometrics` на эталонных наборах; здесь проверяется ровно то,
 * что делает этот слой: какому заданию какая величина положена, какой порог к какому числу
 * применён и что показывается, а что скрыто за недостатком данных.
 */
import { describe, expect, it } from "vitest";

import { computePsychometrics, firstAttemptOnly, type QuestionInfo } from "../psychometrics";
import type { ResponseFact } from "../response-matrix";

/** Заготовка наблюдения: всё, что не названо, для расчёта безразлично. */
function fact(over: Partial<ResponseFact> & Pick<ResponseFact, "questionId" | "respondentId">): ResponseFact {
  return {
    observationId: `obs-${over.respondentId}`,
    source: "web",
    psychoHash: "hash-1",
    outcome: "correct",
    score: null,
    maxScore: null,
    scoreRatio: 1,
    latencyMs: null,
    answer: null,
    formKey: null,
    groupKeys: [],
    occurredAt: new Date("2026-09-20T10:00:00Z"),
    ...over,
  } as ResponseFact;
}

/** Четыре респондента и четыре задания — тот же эталонный набор, что у движка. */
const RESPONSES: ResponseFact[] = [];
for (const [respondentId, q1, q2, q3, q4] of [
  ["A", 1, 1, 1, 1], ["B", 1, 1, 1, 0], ["C", 1, 1, 0, 0], ["D", 0, 1, 0, 0],
] as Array<[string, number, number, number, number]>) {
  RESPONSES.push(fact({ respondentId, questionId: "q1", scoreRatio: q1 }));
  RESPONSES.push(fact({ respondentId, questionId: "q2", scoreRatio: q2 }));
  RESPONSES.push(fact({ respondentId, questionId: "q3", scoreRatio: q3 }));
  RESPONSES.push(fact({ respondentId, questionId: "q4", scoreRatio: q4 }));
}

const question = (id: string, over: Partial<QuestionInfo> = {}): QuestionInfo => ({
  id,
  type: "single",
  prompt: "Вопрос",
  dataJson: { options: ["A", "B", "C", "D"] },
  difficulty: null,
  ...over,
});

const CTX = {
  questionById: new Map([
    ["q1", question("q1")],
    ["q2", question("q2")],
    ["q3", question("q3")],
    ["q4", question("q4")],
  ]),
  minObservations: 10,
};

describe("computePsychometrics", () => {
  it("считает по каждому заданию трудность и оба показателя дискриминативности", () => {
    const result = computePsychometrics(RESPONSES, CTX);
    const q1 = result.items.find(i => i.questionId === "q1")!;

    expect(q1.observations).toBe(4);
    expect(q1.difficulty).toBe(0.75);
    expect(q1.itemRest).toBeCloseTo(0.5222329678, 9);
    expect(q1.discrimination).toBe(1);
  });

  it("поправка на угадывание считается только там, где вероятность вычислима", () => {
    const matching = new Map(CTX.questionById);
    matching.set("q1", question("q1", { type: "matching", dataJson: { left: [], right: [] } }));

    const result = computePsychometrics(RESPONSES, { ...CTX, questionById: matching });

    // У «один ответ из четырёх» поправка есть: (0,75 − 0,25) / 0,75 = 0,6(6).
    expect(result.items.find(i => i.questionId === "q4")!.correctedDifficulty).toBeCloseTo(0, 12);
    // У сопоставления её нет вовсе — пустое место честнее нуля.
    expect(result.items.find(i => i.questionId === "q1")!.correctedDifficulty).toBeNull();
  });

  it("признак «на уровне угадывания» появляется, когда поправка ушла в ноль и ниже", () => {
    // q4: p = 0,25 при четырёх вариантах — ровно вероятность случайного попадания.
    const q4 = computePsychometrics(RESPONSES, CTX).items.find(i => i.questionId === "q4")!;
    expect(q4.flags.atChanceLevel).toBe(true);
  });

  it("слишком лёгкое и слишком трудное задание помечаются по порогам трудности", () => {
    const items = computePsychometrics(RESPONSES, CTX).items;
    expect(items.find(i => i.questionId === "q2")!.flags.tooEasy).toBe(true);
    expect(items.find(i => i.questionId === "q4")!.flags.tooHard).toBe(false);
  });

  it("к трудности и к коэффициентам применяются РАЗНЫЕ пороги (FR-38a)", () => {
    // Четыре наблюдения: трудности мало даже для порога инстанса, коэффициентам — тем более.
    const small = computePsychometrics(RESPONSES, CTX).items[0];
    expect(small.difficultyConfidence).toBe("insufficient");
    expect(small.coefficientConfidence).toBe("insufficient");

    // Двенадцать наблюдений: трудность выводится, коэффициент — нет. Ровно тот случай, который
    // экран обязан объяснять.
    const twelve: ResponseFact[] = [];
    for (let i = 0; i < 12; i += 1) {
      twelve.push(fact({ respondentId: `R${i}`, questionId: "q1", scoreRatio: i % 2 }));
      twelve.push(fact({ respondentId: `R${i}`, questionId: "q2", scoreRatio: 1 }));
    }
    const item = computePsychometrics(twelve, CTX).items.find(i => i.questionId === "q1")!;
    expect(item.difficultyConfidence).toBe("reliable");
    expect(item.coefficientConfidence).toBe("insufficient");
  });

  it("считает надёжность теста и ошибку измерения", () => {
    const result = computePsychometrics(RESPONSES, CTX);
    if (typeof result.reliability === "string") throw new Error("ожидался коэффициент");

    expect(result.reliability.alpha).toBeCloseTo(2 / 3, 12);
    expect(result.reliability.respondents).toBe(4);
    expect(result.sem).toBeCloseTo(0.7453559925, 9);
  });

  it("строит интервал вокруг проходного балла в тех же единицах, что и сумма", () => {
    // Сумма считается в долях баллов по четырём пунктам, поэтому порог 70 % — это 2,8.
    const result = computePsychometrics(RESPONSES, { ...CTX, cutRatio: 0.7 });
    expect(result.cutBand!.low).toBeCloseTo(2.8 - 1.96 * result.sem!, 9);
  });

  it("без проходного балла интервала нет — его не из чего строить", () => {
    expect(computePsychometrics(RESPONSES, CTX).cutBand).toBeNull();
  });

  it("рассказывает, на чём стоят числа: источники и доля неизвестных редакций", () => {
    const mixed = [
      ...RESPONSES,
      fact({ respondentId: "E", questionId: "q1", source: "import", psychoHash: null }),
    ];

    const { sample } = computePsychometrics(mixed, CTX);

    expect(sample.respondents).toBe(5);
    expect(sample.bySource).toEqual({ web: 16, import: 1 });
    expect(sample.unknownVersionShare).toBeCloseTo(1 / 17, 12);
  });

  it("измерительные ответы в трудность не идут, но наблюдение не теряется", () => {
    const withNeutral = [
      ...RESPONSES,
      fact({ respondentId: "E", questionId: "q1", outcome: "neutral", scoreRatio: null }),
    ];

    const q1 = computePsychometrics(withNeutral, CTX).items.find(i => i.questionId === "q1")!;
    expect(q1.observations).toBe(4);
    expect(q1.difficulty).toBe(0.75);
  });

  it("наблюдение без опознанного респондента в расчёт не идёт", () => {
    // Без ключа человека нельзя ни построить способность, ни отличить его вторую попытку от
    // чужой первой.
    const anonymous = [...RESPONSES, fact({ respondentId: null as never, questionId: "q1" })];
    expect(computePsychometrics(anonymous, CTX).sample.respondents).toBe(4);
  });

  it("на пустой выборке возвращает пустоту, а не нули и NaN", () => {
    const empty = computePsychometrics([], CTX);
    expect(empty.items).toEqual([]);
    expect(empty.reliability).toBe("too-few-items");
    expect(empty.sem).toBeNull();
    expect(empty.sample.unknownVersionShare).toBe(0);
  });
});

describe("firstAttemptOnly", () => {
  it("оставляет ПЕРВУЮ попытку каждого респондента", () => {
    // Повторная попытка не независима: человек помнит задания, и она говорит о памяти не
    // меньше, чем о способности.
    const responses: ResponseFact[] = [
      fact({ respondentId: "A", questionId: "q1", observationId: "first", occurredAt: new Date("2026-09-01T10:00:00Z") }),
      fact({ respondentId: "A", questionId: "q1", observationId: "second", occurredAt: new Date("2026-09-05T10:00:00Z") }),
      fact({ respondentId: "B", questionId: "q1", observationId: "b-only", occurredAt: new Date("2026-09-03T10:00:00Z") }),
    ];

    const kept = firstAttemptOnly(responses);

    expect(kept.map(r => r.observationId)).toEqual(["first", "b-only"]);
  });

  it("наблюдения без респондента отбрасывает — их попытки не сосчитать", () => {
    expect(firstAttemptOnly([fact({ respondentId: null as never, questionId: "q1" })])).toEqual([]);
  });
});
