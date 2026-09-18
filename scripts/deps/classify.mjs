/**
 * @module scripts/deps/classify
 * @description Turns one findArtifacts response into a verdict about one package.
 *
 * The API matches a version as a PREFIX: asking for `4.4.3` also returns `4.4.30`. Taking the
 * first record of the answer would therefore let a neighbouring version decide the fate of
 * ours, so the verdict is only ever read off a record whose version matches exactly.
 *
 * An empty answer means the package is absent from the corporate base and has to be requested.
 * That is not the same as a ban, and the report says so in different words — but it blocks a
 * build just as surely, so both count as a failure.
 */

/** @enum {string} */
export const OUTCOME = { OK: "ok", WARN: "warn", BLOCK: "block", ERROR: "error" };

/**
 * How each known status maps onto an outcome. A status missing from this table is NOT treated
 * as permission: the vocabulary was recovered from the client bundle, not from documentation,
 * so an unfamiliar value means we learned something, and the report must show it.
 */
const STATUS_OUTCOME = {
  PERMITTED: OUTCOME.OK,
  RESTRICTED: OUTCOME.BLOCK,
  PARTIALLY_PERMITTED: OUTCOME.WARN,
  REQUESTED: OUTCOME.WARN,
  VERIFICATION: OUTCOME.WARN,
  NOTFOUND: OUTCOME.WARN,
  UNCHECKABLE: OUTCOME.WARN,
  UNDEFINED: OUTCOME.WARN,
};

/**
 * Finds the record that is exactly this package, or null.
 *
 * A missing scope is normalised to "" on both sides as a defensive measure: the recorded HAR
 * session never actually returned `scope: null` (every record used "" or a real scope), but
 * nothing documents the API well enough to rule it out, and treating an unseen `null` as a
 * mismatch would risk a false "not in the base" for an unscoped package. The lockfile side
 * always uses "".
 *
 * @param {Array<object>|null|undefined} artifacts Records from `findArtifacts`.
 * @param {{name: string, scope: string, version: string}} pkg
 * @returns {object|null} The first exact match, or null when none exists.
 */
export function matchArtifact(artifacts, pkg) {
  const wanted = pkg.scope ?? "";
  return (
    (artifacts ?? []).find(
      (a) => a?.npm?.name === pkg.name && (a?.npm?.scope ?? "") === wanted && a?.npm?.version === pkg.version,
    ) ?? null
  );
}

/**
 * @param {object} pkg Package as produced by `parseLockfile`.
 * @param {Array<object>|null|undefined} artifacts Records from `findArtifacts`.
 * @returns {{id: string, name: string, scope: string, version: string, dev: boolean,
 *   requiredBy: string[], outcome: string, status: string, known: boolean, zone: string|null,
 *   comment: string, alerts: object[]}}
 */
export function classify(pkg, artifacts) {
  const base = {
    id: pkg.id,
    name: pkg.name,
    scope: pkg.scope,
    version: pkg.version,
    dev: pkg.dev,
    requiredBy: pkg.requiredBy ?? [],
  };
  const matched = matchArtifact(artifacts, pkg);
  if (!matched) {
    return { ...base, outcome: OUTCOME.BLOCK, status: "ABSENT", known: true, zone: null, comment: "", alerts: [] };
  }
  const status = matched.state?.status ?? "UNDEFINED";
  return {
    ...base,
    outcome: STATUS_OUTCOME[status] ?? OUTCOME.WARN,
    status,
    known: Object.hasOwn(STATUS_OUTCOME, status),
    zone: matched.state?.zone ?? null,
    comment: matched.state?.comment ?? "",
    alerts: matched.alerts ?? [],
  };
}

/**
 * Outcome for a package we failed to ask about at all (network error, or 5xx after retries).
 *
 * @param {object} pkg Package as produced by `parseLockfile`.
 * @param {Error} error The error that ended the attempt.
 * @returns {{id: string, name: string, scope: string, version: string, dev: boolean,
 *   requiredBy: string[], outcome: string, status: string, known: boolean, zone: string|null,
 *   comment: string, alerts: object[]}}
 */
export function failed(pkg, error) {
  return {
    id: pkg.id,
    name: pkg.name,
    scope: pkg.scope,
    version: pkg.version,
    dev: pkg.dev,
    requiredBy: pkg.requiredBy ?? [],
    outcome: OUTCOME.ERROR,
    status: "ERROR",
    known: true,
    zone: null,
    comment: error.message,
    alerts: [],
  };
}
