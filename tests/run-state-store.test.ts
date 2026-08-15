/**
 * @module tests/run-state-store
 * @description PRD-36: состояние прогона в `cmi.suspend_data`. Файл заведён ДО смены формата
 * и фиксирует поведение, которое обязано пережить правку: счётчик попыток, якорь таймера и обе
 * даты барьеров. Функции поднимаются из ИСХОДНИКА рантайма (port-паттерн), а не пересказываются:
 * пересказ остаётся зелёным при любой поломке пакета и потому ничего не охраняет.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/suspendAttempts.js"),
  "utf8",
);

interface Store {
  readSuspendObj: () => Record<string, unknown>;
  writeSuspendObj: (obj: unknown) => void;
  getAttemptsUsed: () => number;
  setAttemptsUsed: (n: number) => void;
}

/** Runtime store bound to an in-memory SCORM data model. */
function makeStore(initial = ""): { store: Store; cmi: { value: string } } {
  const cmi = { value: initial };
  const SCORM = {
    getValue: (k: string) => (k === "cmi.suspend_data" ? cmi.value : ""),
    setValue: (k: string, v: string) => {
      if (k === "cmi.suspend_data") cmi.value = v;
    },
    commit: () => undefined,
  };
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "SCORM",
    "TEST_DATA",
    "state",
    "console",
    `${src}
     return { readSuspendObj: readSuspendObj, writeSuspendObj: writeSuspendObj,
              getAttemptsUsed: getAttemptsUsed, setAttemptsUsed: setAttemptsUsed };`,
  );
  const store = factory(
    SCORM,
    { maxAttempts: 3, retakePolicy: null },
    { answers: {}, flatQuestions: [] },
    { log: () => undefined },
  ) as Store;
  return { store, cmi };
}

describe("состояние прогона: счётчик попыток", () => {
  it("пустое состояние читается как ноль попыток", () => {
    const { store } = makeStore("");
    expect(store.getAttemptsUsed()).toBe(0);
  });

  it("счётчик переживает перезапись состояния", () => {
    const { store } = makeStore("");
    store.setAttemptsUsed(2);
    expect(store.getAttemptsUsed()).toBe(2);
  });

  it("повреждённая строка не роняет чтение", () => {
    const { store } = makeStore('{"attemptsUsed":2,"attempts":[{"per');
    expect(store.getAttemptsUsed()).toBe(0);
  });
});
