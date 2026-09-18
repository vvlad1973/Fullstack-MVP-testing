import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { cacheFileName, readCached, writeCached } from "../../scripts/deps/cache.mjs";

const pkg = { name: "pglite", scope: "@electric-sql", version: "0.4.1" };
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "deps-cache-test-"));
});

describe("cacheFileName", () => {
  it("не оставляет в имени файла разделителей пути", () => {
    expect(cacheFileName(pkg)).toBe("@electric-sql!pglite@0.4.1.json");
  });

  it("обходится без области", () => {
    expect(cacheFileName({ name: "zod", scope: "", version: "4.4.3" })).toBe("zod@4.4.3.json");
  });
});

describe("readCached", () => {
  it("возвращает null, когда записи нет", () => {
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 100 })).toBeNull();
  });

  it("возвращает сохранённое, пока не вышел срок", () => {
    writeCached(dir, pkg, [{ npm: { version: "0.4.1" } }], { now: 1000 });
    expect(readCached(dir, pkg, { now: 1500, ttlMs: 1000 })).toEqual([{ npm: { version: "0.4.1" } }]);
  });

  it("возвращает null, когда срок вышел", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    expect(readCached(dir, pkg, { now: 5000, ttlMs: 1000 })).toBeNull();
  });

  it("переживает испорченный файл", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    writeFileSync(join(dir, cacheFileName(pkg)), "{ это не json", "utf8");
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 1000 })).toBeNull();
  });

  it("хранит вместе с ответом время записи", () => {
    writeCached(dir, pkg, [], { now: 1234 });
    expect(JSON.parse(readFileSync(join(dir, cacheFileName(pkg)), "utf8")).savedAt).toBe(1234);
  });

  it("не путает пустой массив с промахом", () => {
    writeCached(dir, pkg, [], { now: 1000 });
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 1000 })).toEqual([]);
  });

  it("на границе срока (now - savedAt === ttlMs) запись ещё не протухла", () => {
    writeCached(dir, pkg, [{ npm: { version: "0.4.1" } }], { now: 1000 });
    expect(readCached(dir, pkg, { now: 2000, ttlMs: 1000 })).toEqual([{ npm: { version: "0.4.1" } }]);
  });

  it("сразу за границей срока (now - savedAt === ttlMs + 1) запись уже протухла", () => {
    writeCached(dir, pkg, [{ npm: { version: "0.4.1" } }], { now: 1000 });
    expect(readCached(dir, pkg, { now: 2001, ttlMs: 1000 })).toBeNull();
  });

  it("возвращает null, когда в файле нет savedAt (валидный JSON, чужая форма)", () => {
    writeFileSync(join(dir, cacheFileName(pkg)), JSON.stringify({ artifacts: [] }), "utf8");
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 1000 })).toBeNull();
  });

  it("возвращает null, когда savedAt есть, а artifacts нет", () => {
    writeFileSync(join(dir, cacheFileName(pkg)), JSON.stringify({ savedAt: 1000 }), "utf8");
    expect(readCached(dir, pkg, { now: 1000, ttlMs: 1000 })).toBeNull();
  });
});

describe("cacheFileName — коллизия исключена", () => {
  it("scope+name и name с прежним разделителем внутри дают РАЗНЫЕ имена", () => {
    const scoped = { name: "b", scope: "@a", version: "1.0.0" };
    const flattened = { name: "a__b", scope: "", version: "1.0.0" };
    expect(cacheFileName(scoped)).not.toBe(cacheFileName(flattened));
  });
});
