/**
 * @module tests/scorm-session-recovery
 * @description Восстановление прерванного прогона в SCORM-пакете: что рантайм делает, встретив
 * сохранённый прогон, завершённые попытки или ничего.
 *
 * Проверяется ИСХОДНЫЙ `determineRecovery` рантайма. Прежняя версия файла пересказывала его
 * логику на TypeScript и потому не поймала бы ни одной регрессии в самом пакете (PRD-36, риск
 * «модули состояния не покрыты»): реплика оставалась зелёной независимо от того, что происходит
 * в `sessionRecovery.js`. Вместе с ней ушли ещё три блока таких же реплик (сохранение попытки,
 * beforeunload, склейка APP_URL) — ни один из них не исполнял продуктовый код и ни одной строки
 * покрытия не давал.
 *
 * Правила, которые файл охраняет (см. шапку `sessionRecovery.js`):
 *   - без таймера прерванный прогон восстанавливается с того же вопроса;
 *   - с таймером — только если якорь активного времени PRD-20 позволяет восстановить остаток;
 *   - адаптивный режим прогон не восстанавливает никогда, показывает последнюю попытку;
 *   - протухший (старше суток) прогон приравнивается к отсутствующему;
 *   - режим маршрутизатора восстанавливает секционный чекпоинт, а не позицию в вопросах.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

const src = readFileSync(
  resolve(process.cwd(), "server/scorm/template/app/utils/scorm/sessionRecovery.js"),
  "utf8",
);

type Recovery = { action: string; session?: any; attempt?: any };

interface RuntimeEnv {
  /** `suspend_data` as the runtime would have parsed it. */
  suspend: unknown;
  /** The baked TEST_DATA of the package under test. */
  TEST_DATA: unknown;
  /** PRD-20 active-time anchor, or null when absent/tampered. */
  anchor?: unknown;
  /** `cmi.total_time` in seconds, or null when unreadable. */
  totalSec?: number | null;
}

function determineRecoveryIn(env: RuntimeEnv): Recovery {
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const factory = new Function(
    "TEST_DATA",
    "state",
    "readSuspendObj",
    "readTimerAnchor",
    "readTotalTimeSec",
    "writeSuspendObj",
    "console",
    `${src}\nreturn determineRecovery;`,
  );
  return factory(
    env.TEST_DATA,
    {},
    () => env.suspend,
    () => env.anchor ?? null,
    () => (env.totalSec === undefined ? null : env.totalSec),
    () => undefined,
    { log: () => undefined },
  )() as Recovery;
}

const LINEAR = { mode: "standard", timeLimitMinutes: null, flowPolicy: { mode: "linear_flat" } };
const TIMED = { mode: "standard", timeLimitMinutes: 30, flowPolicy: { mode: "linear_flat" } };
const ADAPTIVE = { mode: "adaptive", timeLimitMinutes: null, flowPolicy: { mode: "linear_flat" } };
const ROUTER = { mode: "standard", timeLimitMinutes: null, flowPolicy: { mode: "router_by_topics" } };

const session = (over: Record<string, unknown> = {}) => ({
  savedAt: new Date().toISOString(),
  currentIndex: 1,
  answers: { q1: 0 },
  flatQuestions: [{ question: { id: "q1" } }, { question: { id: "q2" } }],
  ...over,
});

const attempt = (percent: number) => ({
  attemptNumber: 1,
  completedAt: new Date().toISOString(),
  percent,
  passed: percent >= 60,
});

describe("determineRecovery: линейный режим без таймера", () => {
  it("прерванный прогон восстанавливается", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 1, attempts: [], currentSession: session() },
      TEST_DATA: LINEAR,
    });
    expect(r.action).toBe("restore");
    expect(r.session.currentIndex).toBe(1);
  });

  it("протухший прогон не восстанавливается", () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 1, attempts: [], currentSession: session({ savedAt: stale }) },
      TEST_DATA: LINEAR,
    });
    expect(r.action).toBe("start_fresh");
  });

  it("прогон без выданных вопросов равносилен его отсутствию", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 0, attempts: [], currentSession: session({ flatQuestions: [] }) },
      TEST_DATA: LINEAR,
    });
    expect(r.action).toBe("start_fresh");
  });

  it("без прогона и без попыток тест начинается заново", () => {
    const r = determineRecoveryIn({ suspend: { attemptsUsed: 0, attempts: [] }, TEST_DATA: LINEAR });
    expect(r.action).toBe("start_fresh");
  });
});

describe("determineRecovery: тест с ограничением времени (PRD-20)", () => {
  it("якорь активного времени позволяет продолжить прогон", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 1, attempts: [], currentSession: session() },
      TEST_DATA: TIMED,
      anchor: { limitMinutes: 30, baselineTotalSec: 120 },
      totalSec: 300,
    });
    expect(r.action).toBe("restore");
  });

  it("без якоря прогон не восстанавливается — показывается последняя попытка", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 1, attempts: [attempt(70)], currentSession: session() },
      TEST_DATA: TIMED,
      anchor: null,
    });
    expect(r.action).toBe("show_last_attempt");
    expect(r.attempt.percent).toBe(70);
  });

  it("якорь от ДРУГОГО лимита времени не годится: ученик не получает лимит заново", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 1, attempts: [], currentSession: session() },
      TEST_DATA: TIMED,
      anchor: { limitMinutes: 45, baselineTotalSec: 120 },
      totalSec: 300,
    });
    expect(r.action).toBe("start_fresh");
  });
});

describe("determineRecovery: адаптивный режим", () => {
  it("показывает последнюю попытку, а не лучшую", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 2, attempts: [attempt(90), attempt(50)], currentSession: session() },
      TEST_DATA: ADAPTIVE,
    });
    expect(r.action).toBe("show_last_attempt");
    expect(r.attempt.percent).toBe(50);
  });

  it("без завершённых попыток начинает заново, прогон в работе игнорируется", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 0, attempts: [], currentSession: session() },
      TEST_DATA: ADAPTIVE,
    });
    expect(r.action).toBe("start_fresh");
  });
});

describe("determineRecovery: режим маршрутизатора", () => {
  it("секционный чекпоинт восстанавливается своим действием", () => {
    const r = determineRecoveryIn({
      suspend: {
        attemptsUsed: 0,
        attempts: [],
        currentSession: session({ flowMode: "router_by_topics" }),
      },
      TEST_DATA: ROUTER,
    });
    expect(r.action).toBe("restore_router");
  });

  it("чекпоинт линейного прогона в маршрутизаторе не годится", () => {
    const r = determineRecoveryIn({
      suspend: { attemptsUsed: 0, attempts: [], currentSession: session({ flowMode: "linear_flat" }) },
      TEST_DATA: ROUTER,
    });
    expect(r.action).toBe("start_fresh");
  });
});
