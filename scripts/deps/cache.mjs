/**
 * @module scripts/deps/cache
 * @description On-disk cache of findArtifacts answers, one file per package version.
 *
 * The cache is what makes the timid pace affordable: a full run costs minutes, a repeat run
 * costs only the packages whose version changed. A corrupt or torn file is treated as a miss
 * rather than an error — a cache that can break the tool is worse than no cache.
 */

import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cache defaults, mirroring spec section 5 (`tmp/deps-cache/`, a 7-day TTL) the same way
 * `PACE` in pace.mjs mirrors its own section: a single frozen object, so a "just keep it
 * around longer" edit has one place to hit a red test instead of drifting past review.
 * `dir` stays a required parameter below rather than a default — unlike a numeric pace
 * value, a wrong path has a real filesystem side effect, so nothing here silently resolves
 * one; `CACHE.dir` exists for callers (the CLI, the future `repo-client.mjs`) to read.
 */
export const CACHE = Object.freeze({
  dir: "tmp/deps-cache",
  ttlMs: 7 * 24 * 60 * 60 * 1000,
});

/**
 * Cache file name for a package.
 *
 * `/` is replaced with `!` because a path separator cannot sit inside a single file name —
 * that is a filesystem constraint, not an npm one. It is the only character among
 * `@scope/name` that needed handling: Windows also forbids `< > : " \ | ? *`, but npm never
 * puts any of those into a name or scope, so none of them can reach here.
 *
 * `!` was NOT picked because npm forbids it in a name — it does not, and an earlier version
 * of this comment claimed a name/version alphabet (lowercase letters, digits, `-`, `_`, `.`)
 * that does not hold. Verified directly: `encodeURIComponent("a!b") === "a!b"`, i.e. npm's
 * own name-validity check (URL-friendliness) does not exclude `!`, nor `~ ' ( ) *`, nor a
 * legacy uppercase name. So no separator drawn from characters npm merely tends not to use
 * is safe by charset alone — a package could, in principle, be named to contain almost any
 * of them.
 *
 * What actually rules out a collision between a SCOPED and an UNSCOPED package is
 * structural, not charset-based: an unscoped package's own name can never contain `@`
 * anywhere (the same URL-friendliness check fails on a bare `@`, and `@scope/name` is the
 * only shape npm carves out an exception for), while a scoped file name built here always
 * starts with its scope's own leading `@`. A string that starts with `@` and a string that
 * cannot contain `@` at all can never be equal — regardless of what `!` or anything else
 * does inside the rest of either name. That is the actual guarantee behind the cache key in
 * spec §4 (`@scope!name@version`). It is also why an earlier version of this function, which
 * joined scope and name with `__` — an ordinary legal name character — let the unscoped
 * package `a__b` collide with the scoped package `@a/b` on one cache file: nothing about
 * `__` carried the leading-`@` distinction. Do not "clean up" the `!` back to `__` or `-`;
 * both reopen that collision.
 *
 * This does not prove two DIFFERENT scoped packages can never collide — e.g. scope `@a` name
 * `b!c` and scope `@a!b` name `c` both flatten to `@a!b!c`. Nothing in this project's
 * lockfiles has ever had a `!` inside a name, and it would take a legacy-style name npm
 * itself steers people away from, but the leading-`@` argument above does not rule it out.
 *
 * @param {{name: string, scope: string, version: string}} pkg
 * @returns {string}
 */
export function cacheFileName(pkg) {
  const scope = pkg.scope ? `${pkg.scope}!` : "";
  return `${scope}${pkg.name}@${pkg.version}.json`;
}

/**
 * Reads a cached findArtifacts answer for a package, if one exists and has not expired. A
 * stale entry is deleted as it is found — free housekeeping, since the file is already open
 * and about to be re-fetched anyway. There is no separate `existsSync` check: a missing file
 * fails `readFileSync` the same way a corrupt one fails `JSON.parse`, and the `catch` below
 * already treats both as a miss.
 *
 * @param {string} dir Cache directory.
 * @param {{name: string, scope: string, version: string}} pkg
 * @param {{now: number, ttlMs?: number}} options `ttlMs` defaults to `CACHE.ttlMs`.
 * @returns {Array<object>|null} Cached artifacts, or null on a miss, a stale or a broken entry.
 */
export function readCached(dir, pkg, { now, ttlMs = CACHE.ttlMs }) {
  const file = join(dir, cacheFileName(pkg));
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (typeof saved.savedAt !== "number" || now - saved.savedAt > ttlMs) {
      rmSync(file, { force: true });
      return null;
    }
    return saved.artifacts ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes a findArtifacts answer to the cache, tagged with the time it was saved. Written to a
 * sibling `.tmp` file first and moved into place with `renameSync`, which is atomic on both
 * Windows and POSIX: a run interrupted mid-write leaves no half-written file for the next run
 * to trip over. This tool never runs more than one request at a time (spec §5), so a single
 * fixed `.tmp` name per target file is not a collision risk.
 *
 * @param {string} dir Cache directory; created when missing.
 * @param {{name: string, scope: string, version: string}} pkg
 * @param {Array<object>} artifacts
 * @param {{now: number}} options
 */
export function writeCached(dir, pkg, artifacts, { now }) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, cacheFileName(pkg));
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify({ savedAt: now, artifacts }), "utf8");
  renameSync(tmp, file);
}
