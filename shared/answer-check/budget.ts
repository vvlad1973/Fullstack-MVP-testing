/**
 * @module shared/answer-check/budget
 *
 * The TIME budget of a comparison (PRD-57 FR-28o — FR-28s). One module, three hosts: the
 * question drawer, the server and the SCORM package must measure the same way and agree on
 * what «too long» means — a second implementation would mean the author saves a rule the
 * editor called fast and the runtime refuses to run (FR-28s).
 *
 * What lives here is the ARITHMETIC: the numbers, one measured run, and the strings that
 * provoke backtracking. What does NOT live here is the killing: only the host knows what it
 * can terminate — a worker thread on the server, a web worker in the browser, nothing at
 * all in an LMS that forbids them.
 *
 * Pure and framework-free — safe to bundle into the SCORM runtime.
 */

/**
 * How long ONE comparison may take at run time before the answer is left unchecked.
 *
 * A second is generous for a comparison that normally takes a fraction of a millisecond;
 * it is deliberately not tighter, because the cost of being wrong here falls on the
 * learner, whose answer stops being graded. The installation overrides it through
 * `limits.answerCheckBudgetMs`, so the stand measurement (#51) changes a setting rather
 * than the code.
 */
export const DEFAULT_BUDGET_MS = 1000;

/**
 * When the author is told their expression is slow.
 *
 * Two hundred milliseconds is already far outside «доли секунды» (§6.4), and the warning
 * is only a warning — the rule saves either way (FR-28p1).
 */
export const DEFAULT_WARN_MS = 200;

/** A measured run: what it produced and how long it took. */
export interface Measured<T> {
  value: T;
  ms: number;
}

/**
 * Run and time one comparison.
 *
 * @param run The comparison itself; it must be synchronous — the point is to measure how
 *   long the engine is BLOCKED, and an async wrapper would measure the wrong thing.
 */
export function measure<T>(run: () => T): Measured<T> {
  const started = Date.now();
  const value = run();
  return { value, ms: Date.now() - started };
}

/**
 * Strings that provoke catastrophic backtracking (FR-28o, the save-time run).
 *
 * The shape is what matters, and §6.4 explains why: the blow-up lives on an answer that
 * does NOT match, because a matching answer stops the engine at the first success. So each
 * string is a run of repeated, separator-joined chunks — many ways to split the same text
 * between repetitions — with a tail that fits nothing.
 *
 * Lengths grow, because the cost grows fourfold every two characters: a set that stops at
 * twenty characters would call `^(\S+\s?)+ надзору$` fast (23 ms) and miss that it needs
 * 27 seconds at thirty.
 */
export function provocations(): string[] {
  const lengths = [10, 14, 18, 22, 26, 30];
  return lengths.map((length) => `${"аб ".repeat(Math.ceil(length / 3)).slice(0, length)}!`);
}
