/**
 * @module scripts/deps/lockfile
 * @description Turns an npm lockfile (lockfileVersion 3) into the flat list of distinct
 * packages the allowance check asks about, each carrying the chain that pulls it in.
 *
 * Two things here are not decoration. Scope is split off the name because the corporate API
 * takes it as a SEPARATE field — `@electric-sql/pglite` searched as one string finds nothing,
 * which reads exactly like "forbidden". And the reverse graph exists because a forbidden
 * transitive dependency cannot simply be removed: the report has to name who pulls it.
 */

const NM = "node_modules/";

/** Package name as written in the manifest, taken off a lockfile key. */
export function packageNameFromKey(key) {
  const at = key.lastIndexOf(NM);
  return at === -1 ? key : key.slice(at + NM.length);
}

/**
 * Splits `@scope/name` into its parts.
 * @param {string} fullName Name as npm writes it.
 * @returns {{scope: string, name: string}} Scope keeps its `@`; it is empty for plain packages.
 */
export function splitScope(fullName) {
  if (!fullName.startsWith("@")) return { scope: "", name: fullName };
  const slash = fullName.indexOf("/");
  if (slash === -1) return { scope: "", name: fullName };
  return { scope: fullName.slice(0, slash), name: fullName.slice(slash + 1) };
}

/**
 * Finds which lockfile entry a dependency of `parentKey` resolves to, following npm's own
 * rule: the nested copy wins, otherwise walk up towards the root.
 *
 * @param {Record<string, object>} packages The lockfile `packages` map.
 * @param {string} parentKey Key of the dependent entry (`""` for the project root).
 * @param {string} depName Dependency name, scope included.
 * @returns {string|null} Key of the resolved entry, or null when the lockfile has no such copy.
 */
export function resolveDependencyKey(packages, parentKey, depName) {
  let prefix = parentKey;
  for (;;) {
    const candidate = prefix ? `${prefix}/${NM}${depName}` : `${NM}${depName}`;
    if (Object.hasOwn(packages, candidate)) return candidate;
    if (!prefix) return null;
    const cut = prefix.lastIndexOf(NM);
    prefix = cut <= 0 ? "" : prefix.slice(0, cut - 1);
  }
}

/** Stable identifier of a lockfile entry: `@scope/name@version`. */
function idOf(key, entry) {
  return `${packageNameFromKey(key)}@${entry.version}`;
}

/** Every dependency name an entry declares, across all four kinds. */
function declaredDependencies(entry) {
  return [
    ...Object.keys(entry.dependencies ?? {}),
    ...Object.keys(entry.devDependencies ?? {}),
    ...Object.keys(entry.optionalDependencies ?? {}),
    ...Object.keys(entry.peerDependencies ?? {}),
  ];
}

/**
 * Reads the lockfile into distinct packages.
 *
 * A package installed both as a dependency and a devDependency counts as production: the
 * stricter reading is the safe one, because that copy does ship.
 *
 * @param {object} lock Parsed `package-lock.json`.
 * @param {{rootName?: string}} [options] What to call the project itself in `requiredBy`.
 * @returns {Array<{id: string, key: string, name: string, scope: string, version: string,
 *   dev: boolean, requiredBy: string[]}>}
 */
export function parseLockfile(lock, { rootName = "проект" } = {}) {
  const packages = lock.packages ?? {};
  const byId = new Map();

  for (const [key, entry] of Object.entries(packages)) {
    if (key === "" || entry.link || !entry.version) continue;
    const { scope, name } = splitScope(packageNameFromKey(key));
    const id = idOf(key, entry);
    const seen = byId.get(id);
    if (seen) {
      if (entry.dev !== true) seen.dev = false;
      continue;
    }
    byId.set(id, { id, key, name, scope, version: entry.version, dev: entry.dev === true, requiredBy: [] });
  }

  for (const [key, entry] of Object.entries(packages)) {
    if (entry.link) continue;
    const parentId = key === "" ? rootName : idOf(key, entry);
    for (const depName of declaredDependencies(entry)) {
      const depKey = resolveDependencyKey(packages, key, depName);
      if (!depKey) continue;
      const dep = byId.get(idOf(depKey, packages[depKey]));
      if (dep && dep.id !== parentId && !dep.requiredBy.includes(parentId)) dep.requiredBy.push(parentId);
    }
  }

  return [...byId.values()];
}
