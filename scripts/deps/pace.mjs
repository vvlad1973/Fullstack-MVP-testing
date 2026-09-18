/**
 * @module scripts/deps/pace
 * @description How long to wait before the next request to the corporate system.
 *
 * This tool talks to somebody else's production system under a live person's account, and we
 * have no documentation for it. The pace below rests on an assumption, not on anything observed:
 * a burst of requests could read to its defences as an attack, and an account is presumably
 * easier to get blocked than unblocked. That is the reasoning behind the numbers (spec section 5);
 * section 11 lists what about this system is still unconfirmed. The numbers live here, as a single
 * frozen object, rather than scattered through the client, so a "just make it faster" edit has one
 * place to hit a red test instead of quietly drifting past review.
 *
 * Stopping the run after repeated refusals is a policy for the future `repo-client.mjs` (not
 * written yet) to enforce — this module only computes the delays that policy will use.
 */

/**
 * Pace constants, frozen so a change here cannot be silently absorbed by a default parameter
 * somewhere else. Mirrors spec section 5 verbatim; a change to any value here must also change
 * that section, and vice versa.
 */
export const PACE = Object.freeze({
  baseDelayMs: 500,
  jitterMs: 200,
  retryBaseMs: 2000,
  retryMaxMs: 60000,
  longPauseEvery: 50,
  longPauseMs: 5000,
});

/**
 * Pause before an ordinary request: a fixed part plus a random one (always up to `PACE.jitterMs`),
 * so the requests do not arrive on a perfectly even machine grid.
 *
 * @param {number} [baseMs] Fixed part of the pause, in milliseconds. Overridable because the CLI
 *   exposes it via `--delay`; the jitter spread is not overridable — it is not a knob anyone is
 *   meant to turn.
 * @param {() => number} [random] Source of randomness in [0, 1); injected for tests.
 * @returns {number} Milliseconds to sleep.
 */
export function jitteredDelay(baseMs = PACE.baseDelayMs, random = Math.random) {
  return baseMs + Math.floor(random() * PACE.jitterMs);
}

/**
 * What to do after a rate-limit-shaped refusal.
 *
 * We have not seen this system answer with 429 or 503 — the branches below are written for
 * ordinary HTTP service behaviour, not for anything measured on this particular system (spec
 * section 5). `Retry-After` is honoured verbatim, with no minute cap of ours: it is the one
 * explicit instruction the server gives us, and capping it would mean disregarding it exactly
 * where we promised not to look like an attack. When it asks for longer than a minute, the run
 * should stop rather than hold a connection open that long — the caller decides how to act on
 * `stop`; this function only reports the server's ask.
 *
 * @param {number} attempt Zero-based retry number; negative values are treated as 0.
 * @param {string|null|undefined} retryAfter Value of the `Retry-After` header, if the server sent one.
 * @returns {{waitMs: number, stop: boolean, askedMs: number|null}} `waitMs`: how long to sleep
 *   (meaningless when `stop` is true); `stop`: true when the server's own ask exceeds a minute;
 *   `askedMs`: what `Retry-After` asked for in milliseconds, or null when absent/unreadable.
 */
export function retryPlan(attempt, retryAfter) {
  const safeAttempt = Math.max(0, attempt);
  const seconds = Number.parseInt(retryAfter ?? "", 10);
  if (Number.isFinite(seconds) && seconds > 0) {
    const askedMs = seconds * 1000;
    if (askedMs <= PACE.retryMaxMs) return { waitMs: askedMs, stop: false, askedMs };
    return { waitMs: 0, stop: true, askedMs };
  }
  const waitMs = Math.min(PACE.retryBaseMs * 2 ** safeAttempt, PACE.retryMaxMs);
  return { waitMs, stop: false, askedMs: null };
}

/**
 * Extra breather every fiftieth request.
 *
 * @param {number} index Zero-based index of the request about to be sent.
 * @returns {number} Milliseconds to sleep, usually zero.
 */
export function longPauseMs(index) {
  return index > 0 && index % PACE.longPauseEvery === 0 ? PACE.longPauseMs : 0;
}

/**
 * Promise that resolves after `ms` milliseconds.
 *
 * @param {number} ms
 * @returns {Promise<void>}
 */
export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
