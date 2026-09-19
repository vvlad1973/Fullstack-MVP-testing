/**
 * @module shared/template/short-answer-dom
 *
 * Wires the typed-answer field (PRD-57 §6.5) to its host, on BOTH hosts — the web
 * question screen and the in-package renderer (PRD-12 FR-30).
 *
 * Interaction everywhere else in the unified renderer is delegated through a click on
 * `data-action`, but a text field is different in kind: the answer changes on every
 * keystroke, not on a choice, so the field is subscribed to directly. The contract
 * mirrors {@link module:shared/template/allocation-dom} — the host supplies the
 * accessors, this module returns the unsubscribe function.
 *
 * The RAW string is handed over, untrimmed: what the learner typed is what travels to
 * the LMS report and to the attempt review, and folding it would show them something
 * they did not write. Normalisation belongs to the comparison alone
 * ({@link module:shared/answer-check/normalize}).
 */

/** Minimal element shape used here — keeps the module free of `lib.dom` assumptions. */
type El = {
  querySelector(sel: string): El | null;
  value?: string;
  addEventListener(type: string, cb: (e: never) => void): void;
  removeEventListener(type: string, cb: (e: never) => void): void;
};

/** What the field needs from the screen that owns the answer. */
export interface ShortAnswerHost {
  /** Current answer as the host stores it. */
  getAnswer(): string;
  /** Called with the raw field value on every change. */
  setAnswer(value: string): void;
  /** True while the answer is read-only (feedback shown, section frozen, review). */
  isLocked?(): boolean;
}

/** Detaches every listener {@link attachShortAnswer} installed. */
export type DetachShortAnswer = () => void;

/**
 * Subscribe the typed-answer field inside `root`.
 *
 * Returns a no-op detach when the screen carries no such field, so a host may call this
 * for every question without first asking what type is on screen.
 *
 * @param root Container that holds the rendered question (shadow root or element).
 * @param host The screen that owns the answer.
 * @returns The unsubscribe function.
 */
export function attachShortAnswer(root: El, host: ShortAnswerHost): DetachShortAnswer {
  const field = root.querySelector('[data-action="short-answer"]');
  if (!field) return () => {};
  const onInput = (): void => {
    if (host.isLocked?.()) return;
    host.setAnswer(typeof field.value === "string" ? field.value : "");
  };
  field.addEventListener("input", onInput as (e: never) => void);
  return () => field.removeEventListener("input", onInput as (e: never) => void);
}
