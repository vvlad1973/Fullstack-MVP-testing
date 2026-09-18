/**
 * @module scripts/deps/cache
 * @description On-disk cache of findArtifacts answers, one file per package version.
 *
 * The cache is what makes the timid pace affordable: a full run costs minutes, a repeat run
 * costs only the packages whose version changed. A corrupt file is treated as a miss rather
 * than an error — a cache that can break the tool is worse than no cache.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Cache file name for a package.
 *
 * `/` is the only character in `@scope/name` that cannot sit in a file name, so it is
 * replaced with `!` and nothing else is touched: `@electric-sql/pglite@0.4.1` becomes
 * `@electric-sql!pglite@0.4.1.json`. `!` is chosen deliberately, not `_` or `-`: an npm
 * package name and version may only contain lowercase letters, digits, `-`, `_` and `.`
 * (scope adds `@` and `/` — see docs/specs/tooling/deps-check.md §2.2), so `!` can never
 * occur inside a real name or version. That makes the split unambiguous and the mapping
 * collision-free: no unscoped package's own name can ever equal `<scope>!<name>` for some
 * other scoped package, because producing that string would require a `!` (or a `/`) in a
 * name npm itself would refuse to publish. An earlier version joined scope and name with
 * `__`, which IS a legal name character — `@a/b` and the unscoped package `a__b` collided
 * on the same cache file, and the cache would silently hand back the wrong package's
 * verdict. Do not "simplify" this separator back to `__` or `-`: both are legal in an npm
 * name and reopen that exact collision.
 *
 * @param {{name: string, scope: string, version: string}} pkg
 * @returns {string}
 */
export function cacheFileName(pkg) {
  const scope = pkg.scope ? `${pkg.scope}!` : "";
  return `${scope}${pkg.name}@${pkg.version}.json`;
}

/**
 * Reads a cached findArtifacts answer for a package, if one exists and has not expired.
 *
 * @param {string} dir Cache directory.
 * @param {{name: string, scope: string, version: string}} pkg
 * @param {{now: number, ttlMs: number}} options
 * @returns {Array<object>|null} Cached artifacts, or null on a miss, a stale or a broken entry.
 */
export function readCached(dir, pkg, { now, ttlMs }) {
  const file = join(dir, cacheFileName(pkg));
  if (!existsSync(file)) return null;
  try {
    const saved = JSON.parse(readFileSync(file, "utf8"));
    if (typeof saved.savedAt !== "number" || now - saved.savedAt > ttlMs) return null;
    return saved.artifacts ?? null;
  } catch {
    return null;
  }
}

/**
 * Writes a findArtifacts answer to the cache, tagged with the time it was saved.
 *
 * @param {string} dir Cache directory; created when missing.
 * @param {{name: string, scope: string, version: string}} pkg
 * @param {Array<object>} artifacts
 * @param {{now: number}} options
 */
export function writeCached(dir, pkg, artifacts, { now }) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, cacheFileName(pkg)), JSON.stringify({ savedAt: now, artifacts }), "utf8");
}
