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
        if (retriedAuth) throw new Error("401 от системы после обновления токена: вход больше не действует");
        retriedAuth = true;
        continue;
      }

      refusals += 1;
      const plan = retryPlan(refusals - 1, response.headers?.get?.("Retry-After") ?? null);
      if (plan.stop) {
        throw new Error(
          `Система просит подождать ${Math.round(plan.askedMs / 1000)} секунд — это дольше минуты, ` +
            `прогон остановлен. Проверенное сохранено в кэше, вернитесь позже.`,
        );
      }
      if (refusals >= MAX_REFUSALS) {
        throw new Error(`${response.status} от системы трижды подряд: прогон остановлен`);
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
