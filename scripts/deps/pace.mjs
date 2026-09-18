/**
 * @module scripts/deps/pace
 * @description How long to wait before the next request to the corporate system.
 *
 * This tool talks to somebody else's production system under a live person's account. Several
 * hundred requests arriving as fast as the network allows look exactly like an attack, and an
 * account is far easier to get blocked than unblocked. So the pace is deliberately timid, the
 * numbers live here rather than scattered through the client, and persistence after a refusal
 * is capped: three failures in a row stop the run, because pushing on is precisely the
 * behaviour that defences are built to punish.
 */

const BASE_DELAY_MS = 500;
const JITTER_MS = 200;
const RETRY_BASE_MS = 2000;
const RETRY_MAX_MS = 60000;
const LONG_PAUSE_EVERY = 50;
const LONG_PAUSE_MS = 5000;

/**
 * Pause before an ordinary request: a fixed part plus a random one, so the requests do not
 * arrive on a perfectly even machine grid.
 *
 * @param {number} [baseMs] Fixed part of the pause, in milliseconds.
 * @param {number} [spreadMs] Upper bound of the random part, in milliseconds.
 * @param {() => number} [random] Source of randomness in [0, 1); injected for tests.
 * @returns {number} Milliseconds to sleep.
 */
export function jitteredDelay(baseMs = BASE_DELAY_MS, spreadMs = JITTER_MS, random = Math.random) {
  return baseMs + Math.floor(random() * spreadMs);
}

/**
 * Pause after a refusal (429 or 503).
 *
 * @param {number} attempt Zero-based retry number.
 * @param {string|null} retryAfter Value of the `Retry-After` header, if the server sent one.
 * @returns {number} Milliseconds to sleep, never more than a minute.
 */
export function retryDelayMs(attempt, retryAfter) {
  const seconds = Number.parseInt(retryAfter ?? "", 10);
  if (Number.isFinite(seconds) && seconds > 0) return Math.min(seconds * 1000, RETRY_MAX_MS);
  return Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS);
}

/**
 * Extra breather every fiftieth request.
 *
 * @param {number} index Zero-based index of the request about to be sent.
 * @param {{every?: number, pauseMs?: number}} [options] Overrides for tests.
 * @returns {number} Milliseconds to sleep, usually zero.
 */
export function longPauseMs(index, { every = LONG_PAUSE_EVERY, pauseMs = LONG_PAUSE_MS } = {}) {
  return index > 0 && index % every === 0 ? pauseMs : 0;
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
