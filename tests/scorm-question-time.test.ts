/**
 * @module tests/scorm-question-time
 *
 * Время показа вопроса в SCORM-пакете (техдолг ROADMAP §0.3: колонка «Продолжительность
 * (сек.)» в отчёте LMS пуста всегда, потому что пакет время не измерял вовсе).
 *
 * Ключевое требование — СУММА заходов, а не последний. При разрешённом возврате к
 * неотвеченным человек возвращается к вопросу, и «последний заход» показал бы две секунды
 * на задании, над которым думали минуту.
 *
 * Модуль исполняется настоящий, с подменёнными часами: измерение времени нельзя проверить,
 * пересказав его.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/questionTime.js"),
  "utf8",
);

interface Clock { t: number }

/** The real module over a clock the test drives by hand. */
function makeTracker() {
  const clock: Clock = { t: 1_000_000 };
  const fakeDate = { now: () => clock.t };
  const win: Record<string, unknown> = {};
  const tracker = new Function("Date", "window", `${src}\nreturn TBQuestionTime;`)(fakeDate, win) as {
    show: (id: string) => void;
    leave: () => void;
    totalMsFor: (id: string) => number;
    reset: () => void;
  };
  return { tracker, clock, win };
}

describe("накопление времени показа", () => {
  it("время идёт с показа вопроса до ухода с него", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 7000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(7000);
  });

  it("переход на следующий вопрос закрывает предыдущий", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 4000;
    tracker.show("q2");
    clock.t += 3000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(4000);
    expect(tracker.totalMsFor("q2")).toBe(3000);
  });

  it("возврат к вопросу СУММИРУЕТ заходы, а не заменяет последним", () => {
    // Ровно тот случай, ради которого сумма и нужна: минута раздумий, уход, возврат на две секунды.
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 60000;
    tracker.show("q2");
    clock.t += 5000;
    tracker.show("q1");
    clock.t += 2000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(62000);
  });

  it("повторный показ того же вопроса не удваивает счёт", () => {
    // render() зовут и на перерисовку (обратная связь, смена темы), а не только на переход.
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 3000;
    tracker.show("q1");
    clock.t += 2000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(5000);
  });

  it("двойной уход не добавляет времени", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 3000;
    tracker.leave();
    clock.t += 10000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(3000);
  });

  it("время можно прочитать не уходя с вопроса", () => {
    // Попытку завершают прямо с вопроса — открытый заход обязан попасть в отчёт.
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 9000;
    expect(tracker.totalMsFor("q1")).toBe(9000);
  });

  it("у невиданного вопроса времени нет", () => {
    const { tracker } = makeTracker();
    expect(tracker.totalMsFor("q-unknown")).toBe(0);
  });

  it("часы, прыгнувшие назад, не дают отрицательного времени", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t -= 5000;
    tracker.leave();
    expect(tracker.totalMsFor("q1")).toBe(0);
  });

  it("новая попытка начинает счёт заново", () => {
    const { tracker, clock } = makeTracker();
    tracker.show("q1");
    clock.t += 8000;
    tracker.leave();
    tracker.reset();
    expect(tracker.totalMsFor("q1")).toBe(0);
  });

  it("модуль выставляется глобально — его зовут из нескольких частей рантайма", () => {
    const { win } = makeTracker();
    expect(win.TBQuestionTime).toBeDefined();
  });
});
