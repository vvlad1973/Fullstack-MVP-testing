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
  value?: string;
  matches?(sel: string): boolean;
  addEventListener(type: string, cb: (e: never) => void): void;
  removeEventListener(type: string, cb: (e: never) => void): void;
};

/** The `input` event as this module reads it. */
type InputEvent = { target: El | null };

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
 * Subscribe to the typed-answer field inside `root`.
 *
 * DELEGATED, not bound to the element: `input` bubbles, and the field is replaced on
 * every re-render — the package binds its interaction ONCE at start-up, long before any
 * question exists, so grabbing the element at attach time would leave the learner typing
 * into a field nobody listens to. That is exactly how it failed on the package host while
 * the web host, which re-attaches after each render, looked fine.
 *
 * Attaching twice to the same root is harmless: the second call installs its own listener
 * and its own detach, and both write the same value.
 *
 * @param root Container that holds the rendered question (document, shadow root, element).
 * @param host The screen that owns the answer.
 * @returns The unsubscribe function.
 */
export function attachShortAnswer(root: El, host: ShortAnswerHost): DetachShortAnswer {
  const onInput = (event: InputEvent): void => {
    const field = event?.target;
    if (!field || !field.matches?.('[data-action="short-answer"]')) return;
    if (host.isLocked?.()) return;
    host.setAnswer(typeof field.value === "string" ? field.value : "");
  };
  root.addEventListener("input", onInput as (e: never) => void);
  return () => root.removeEventListener("input", onInput as (e: never) => void);
}
