import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPackages, parseCliArgs, run, validateDelay } from "../../scripts/deps/check-allowed.mjs";
import { PACE } from "../../scripts/deps/pace.mjs";

/**
 * These tests cover only what can be checked without talking to repository.rt.ru: argument
 * parsing, lockfile loading and the zero-package path through `run()`. Anything that would
 * actually call `findArtifacts` needs a human SSO login and is out of scope here (see the spec,
 * section 10, and the CLI's own module doc).
 */

const tempDirs: string[] = [];

/** Writes `content` to package-lock.json inside a fresh directory under the OS temp dir. */
function tempLock(content: string) {
  const dir = mkdtempSync(join(tmpdir(), "deps-check-test-"));
  tempDirs.push(dir);
  const file = join(dir, "package-lock.json");
  writeFileSync(file, content, "utf8");
  return { dir, file };
}

afterEach(() => {
  while (tempDirs.length) {
    rmSync(tempDirs.pop() as string, { recursive: true, force: true });
  }
});

describe("validateDelay", () => {
  it("принимает значение по умолчанию", () => {
    expect(validateDelay(String(PACE.baseDelayMs))).toEqual({ ok: true, value: PACE.baseDelayMs });
  });

  it("разрешает замедлить темп выше минимума", () => {
    expect(validateDelay(String(PACE.baseDelayMs + 1000))).toEqual({ ok: true, value: PACE.baseDelayMs + 1000 });
  });

  it("отказывает на нечисловом значении вместо тихого NaN", () => {
    const result = validateDelay("abc");
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/--delay/);
  });

  it("отказывает ниже минимального темпа, а не молча ускоряет прогон", () => {
    const result = validateDelay("10");
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toContain(String(PACE.baseDelayMs));
  });
});

describe("parseCliArgs", () => {
  it("подставляет значения по умолчанию", () => {
    const values = parseCliArgs([]);
    expect(values.lock).toBe("package-lock.json");
    expect(values.prod).toBe(false);
    expect(values["strict-dev"]).toBe(false);
    expect(values.delay).toBe(String(PACE.baseDelayMs));
  });

  it("читает --prod и --strict-dev", () => {
    const values = parseCliArgs(["--prod", "--strict-dev"]);
    expect(values.prod).toBe(true);
    expect(values["strict-dev"]).toBe(true);
  });
});

describe("loadPackages", () => {
  it("даёт понятную ошибку на отсутствующем файле вместо сырого стека", () => {
    const result = loadPackages(join(tmpdir(), "deps-check-does-not-exist.json"));
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/Не удалось прочитать/);
  });

  it("даёт понятную ошибку на битом JSON", () => {
    const { file } = tempLock("{ не json");
    const result = loadPackages(file);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/Не удалось прочитать/);
  });

  it("lockfileVersion не 3 читается как понятный текст, не как стек", () => {
    const { file } = tempLock(JSON.stringify({ lockfileVersion: 2, packages: { "": {} } }));
    const result = loadPackages(file);
    expect(result.ok).toBe(false);
    expect((result as { message: string }).message).toMatch(/версии 3/);
    expect((result as { message: string }).message).not.toMatch(/\s+at\s+\S+:\d+:\d+/);
  });

  it("разбирает валидный lock-файл", () => {
    const { file } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/left-pad": { version: "1.3.0" } },
      }),
    );
    const result = loadPackages(file);
    expect(result.ok).toBe(true);
    expect((result as { packages: Array<{ name: string }> }).packages.map((p) => p.name)).toEqual(["left-pad"]);
  });
});

describe("run — пути без обращения к сети", () => {
  it("--delay ниже минимума останавливает прогон раньше чтения lock-файла", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--delay", "1", "--lock", join(tmpdir(), "deps-check-unused.json")]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/--delay/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  it("отсутствующий lock-файл даёт код 2 и понятное сообщение", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--lock", join(tmpdir(), "deps-check-still-missing.json")]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/Не удалось прочитать/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  it("неизвестный флаг даёт понятную русскую ошибку и код 2, а не голый TypeError", async () => {
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--bogus-flag"]);
      expect(code).toBe(2);
      expect(stderr.mock.calls.map((c) => String(c[0])).join("")).toMatch(/Неверные аргументы/);
    } finally {
      stderr.mockRestore();
      stdout.mockRestore();
    }
  });

  it("--prod на графе из одних dev-пакетов не проверяет ничего и не ходит в сеть", async () => {
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/only-dev": { version: "1.0.0", dev: true } },
      }),
    );
    const out = join(dir, "report");
    const cache = join(dir, "cache");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--lock", file, "--prod", "--out", out, "--cache", cache]);
      expect(code).toBe(0);
    } finally {
      stdout.mockRestore();
    }
    const report = readFileSync(join(out, "report.md"), "utf8");
    expect(report).toContain("Все проверенные пакеты разрешены.");
    const json = JSON.parse(readFileSync(join(out, "report.json"), "utf8"));
    expect(json.total).toBe(0);
    expect(json.incomplete).toBeUndefined();
  });

  it("создаёт --out и --cache сами, даже когда ни один каталог ещё не существует", async () => {
    const { file, dir } = tempLock(
      JSON.stringify({
        lockfileVersion: 3,
        packages: { "": {}, "node_modules/only-dev": { version: "1.0.0", dev: true } },
      }),
    );
    const out = join(dir, "nested", "does", "not", "exist", "yet");
    const cache = join(dir, "another", "missing", "path");
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      const code = await run(["--lock", file, "--prod", "--out", out, "--cache", cache]);
      expect(code).toBe(0);
    } finally {
      stdout.mockRestore();
    }
    expect(readFileSync(join(out, "report.md"), "utf8")).toContain("Все проверенные пакеты разрешены.");
  });
});
