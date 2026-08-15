/**
 * @module tests/run-state-codec
 * @description PRD-36 §4.6, FR-20: ряды состояния кодируются строкой, элемент адресуется
 * позицией. Декодирование обязано быть обратным кодированию без потерь — иначе после
 * продолжения прогона ученик увидит чужие ответы. FR-23: испорченный ряд считается
 * отсутствующим и не роняет разбор остального состояния.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/runState.js"),
  "utf8",
);

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const TBRunState = new Function(`${src}\nreturn TBRunState;`)() as any;

const Q = (type: string) => ({ type });

describe("кодек выдачи", () => {
  it("выдача кодируется парой «раздел.вопрос» и разворачивается обратно", () => {
    const delivery = [{ s: 0, q: 0 }, { s: 0, q: 3 }, { s: 1, q: 41 }];
    const encoded = TBRunState.encodeDelivery(delivery);
    expect(encoded).toBe("0.0,0.3,1.15");
    expect(TBRunState.decodeDelivery(encoded)).toEqual(delivery);
  });

  it("пустая выдача кодируется пустой строкой", () => {
    expect(TBRunState.encodeDelivery([])).toBe("");
    expect(TBRunState.decodeDelivery("")).toEqual([]);
  });
});

describe("кодек ответов", () => {
  const types = [Q("single"), Q("multiple"), Q("ranking"), Q("matching"), Q("allocation"), Q("single")];
  const answers = [2, [0, 3], [2, 0, 3, 1], { 0: 1, 1: 0 }, { 0: 5, 1: 10 }, undefined];

  it("каждый тип ответа переживает круг кодирования", () => {
    const encoded = TBRunState.encodeAnswers(answers, types);
    expect(TBRunState.decodeAnswers(encoded, types)).toEqual([
      2, [0, 3], [2, 0, 3, 1], { 0: 1, 1: 0 }, { 0: 5, 1: 10 }, undefined,
    ]);
  });

  it("распределение баллов не теряет значения больше 35", () => {
    const encoded = TBRunState.encodeAnswers([{ 0: 40, 1: 60 }], [Q("allocation")]);
    expect(TBRunState.decodeAnswers(encoded, [Q("allocation")])).toEqual([{ 0: 40, 1: 60 }]);
  });

  it("шкальный вопрос кодируется как единичный выбор", () => {
    const encoded = TBRunState.encodeAnswers([4], [Q("scale")]);
    expect(TBRunState.decodeAnswers(encoded, [Q("scale")])).toEqual([4]);
  });
});

describe("кодек статусов и перемешивания", () => {
  it("статусы кодируются одним символом на вопрос", () => {
    const statuses = ["answered", "skipped", "unanswered"];
    expect(TBRunState.encodeStatuses(statuses)).toBe("asu");
    expect(TBRunState.decodeStatuses("asu")).toEqual(statuses);
  });

  it("карта перемешивания переживает круг", () => {
    const maps = [[2, 0, 3, 1], null, [1, 0]];
    const encoded = TBRunState.encodeShuffle(maps);
    expect(TBRunState.decodeShuffle(encoded)).toEqual(maps);
  });
});

describe("порча ряда (FR-23)", () => {
  it("испорченная выдача читается как пустая, а не роняет разбор", () => {
    expect(TBRunState.decodeDelivery("0.0,мусор,1.2")).toEqual([{ s: 0, q: 0 }, { s: 1, q: 2 }]);
  });

  it("ответов меньше, чем вопросов — недостающие пусты, остальные на месте", () => {
    const types = [Q("single"), Q("single"), Q("single")];
    expect(TBRunState.decodeAnswers("1,2", types)).toEqual([1, 2, undefined]);
  });
});

describe("отпечаток состава", () => {
  const TEST_DATA = {
    sections: [{ questions: [{}, {}] }, { questions: [{}] }],
    breakdownKeys: ["a", "b"],
  };

  it("отпечаток собирается из состава пакета", () => {
    expect(TBRunState.fingerprint(TEST_DATA)).toBe("2:2,1:2");
  });

  it("состояние чужого пакета опознаётся по отпечатку", () => {
    expect(TBRunState.sameFingerprint("2:2,1:2", TEST_DATA)).toBe(true);
    expect(TBRunState.sameFingerprint("3:2,1,4:2", TEST_DATA)).toBe(false);
  });
});
