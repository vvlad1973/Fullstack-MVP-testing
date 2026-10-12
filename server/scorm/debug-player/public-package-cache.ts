/**
 * @module server/scorm/debug-player/public-package-cache
 * @description Built packages served under a public test link. One package per published
 * snapshot is shared by every visitor: the package is read-only, the visitor's state lives
 * in their own browser (shim + localStorage), so building it per visitor would only burn CPU.
 */
import { buildScormExportData } from "../build-export-data";
import { generateScormPackage } from "../../scorm-exporter";
import { unzipPackage } from "./session-store";

/** An unpacked package ready to serve file by file. */
export interface PublicPackage {
  files: Map<string, Buffer>;
  launch: string;
}

/** How many snapshots stay cached at once; the oldest is dropped first. */
const MAX_ENTRIES = 20;

const cache = new Map<string, Promise<PublicPackage>>();

/**
 * The package of a test's published snapshot, built once per `(testId, snapshotId)`.
 * Concurrent callers share one in-flight build; a failed build is evicted so the next
 * request retries instead of serving the error forever.
 */
export function getPublicPackage(testId: string, snapshotId: string): Promise<PublicPackage> {
  const key = `${testId}:${snapshotId}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const pending = (async () => {
    const data = await buildScormExportData(testId, { source: "export" });
    const buffer = await generateScormPackage({ ...data, telemetry: null });
    return unzipPackage(buffer);
  })();
  pending.catch(() => cache.delete(key));
  cache.set(key, pending);
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
  return pending;
}

/** Test-only reset. */
export function __clearPublicPackages(): void {
  cache.clear();
}
