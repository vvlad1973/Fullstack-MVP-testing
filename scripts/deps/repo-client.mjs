/**
 * @module scripts/deps/repo-client
 * @description Asks the corporate system whether a package version is allowed.
 *
 * The client carries no verdicts: it delivers records and nothing else. Everything it knows
 * about the API was recovered from a saved session and the client bundle — there is no
 * documentation — so the request shape here is the one the real web client sends, field for
 * field, including `state: {}` and `strict: false`.
 */

import { PACE, jitteredDelay, longPauseMs, retryPlan, sleep as realSleep } from "./pace.mjs";

const ENDPOINT = "/gateway/artifacts/findArtifacts";
const PAGE = 50;
const MAX_RECORDS = 200;
const MAX_REFUSALS = 3;

/**
 * Builds an Error that means "stop the whole run", not just "this one package failed" — the
 * three cases below (dead login, repeated refusals, a `Retry-After` longer than a minute) are
 * exactly the ones spec section 5 says must end the run rather than skip a package and move on.
 * The `stopRun` flag is how the CLI tells the two apart; it deliberately does NOT rely on
 * sniffing the message text with a regex, because a reworded message would silently turn a
 * required stop into a skipped package — the failure mode is invisible until the account it was
 * meant to protect gets blocked.
 *
 * @param {string} message Human-readable reason, already in the language the CLI prints.
 * @returns {Error & {stopRun: true}}
 */
function stopError(message) {
  return Object.assign(new Error(message), { stopRun: true });
}

/**
 * @param {object} options
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(opts?: {force?: boolean}) => Promise<string>} options.getToken
 * @param {(ms: number) => Promise<void>} [options.sleep]
 * @param {() => number} [options.random]
 * @param {string} [options.baseUrl]
 * @param {number} [options.delayMs] Pause before each request; the CLI may widen it.
 * @returns {{findArtifacts: (pkg: object) => Promise<Array<object>>, sent: () => number}}
 */
export function createClient({
  fetchImpl = fetch,
  getToken,
  sleep = realSleep,
  random = Math.random,
  baseUrl = "https://repository.rt.ru",
  delayMs = PACE.baseDelayMs,
} = {}) {
  let sent = 0;

  /** One request, with the pace, the 401 retry and the refusal backoff applied. */
  async function request(pkg, offset) {
    let refusals = 0;
    let retriedAuth = false;
    for (;;) {
      const breather = longPauseMs(sent);
      if (breather) await sleep(breather);
      await sleep(jitteredDelay(delayMs, random));
      sent += 1;

      const token = await getToken(retriedAuth ? { force: true } : undefined);
      const response = await fetchImpl(`${baseUrl}${ENDPOINT}`, {
        method: "POST",
        headers: { "Content-Type": "application/json;charset=utf-8", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          npm: { name: pkg.name, scope: pkg.scope ?? "", version: pkg.version, state: {} },
          offset,
          limit: PAGE,
          strict: false,
        }),
      });

      if (response.ok) return (await response.json()).artifacts ?? [];

      if (response.status === 401) {
        if (retriedAuth) throw stopError("401 от системы после обновления токена: вход больше не действует");
        retriedAuth = true;
        continue;
      }

      refusals += 1;
      const plan = retryPlan(refusals - 1, response.headers?.get?.("Retry-After") ?? null);
      if (plan.stop) {
        throw stopError(
          `Система просит подождать ${Math.round(plan.askedMs / 1000)} секунд — это дольше минуты, ` +
            `прогон остановлен. Проверенное сохранено в кэше, вернитесь позже.`,
        );
      }
      if (refusals >= MAX_REFUSALS) {
        throw stopError(`${response.status} от системы трижды подряд: прогон остановлен`);
      }
      await sleep(plan.waitMs);
    }
  }

  return {
    sent: () => sent,

    /**
     * All records the system has for this name, narrowed by the version substring (spec
     * section 2.2 — the API matches a version as a SUBSTRING, not a prefix and not exact
     * equality). The caller decides which record is actually ours — see `classify.mjs`.
     */
    async findArtifacts(pkg) {
      const collected = [];
      for (let offset = 0; offset < MAX_RECORDS; offset += PAGE) {
        const page = await request(pkg, offset);
        collected.push(...page);
        if (page.length < PAGE) break;
      }
      return collected;
    },
  };
}
