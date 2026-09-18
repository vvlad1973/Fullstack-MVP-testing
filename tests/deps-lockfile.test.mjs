import { describe, expect, it } from "vitest";
import { parseLockfile, resolveDependencyKey, splitScope } from "../scripts/deps/lockfile.mjs";

describe("splitScope", () => {
  it("отделяет область от имени", () => {
    expect(splitScope("@electric-sql/pglite")).toEqual({ scope: "@electric-sql", name: "pglite" });
  });

  it("оставляет область пустой у обычного пакета", () => {
    expect(splitScope("express")).toEqual({ scope: "", name: "express" });
  });
});

describe("resolveDependencyKey", () => {
  const packages = {
    "": {},
    "node_modules/a": { version: "1.0.0" },
    "node_modules/a/node_modules/b": { version: "2.0.0" },
    "node_modules/b": { version: "3.0.0" },
  };

  it("предпочитает вложенную копию", () => {
    expect(resolveDependencyKey(packages, "node_modules/a", "b")).toBe("node_modules/a/node_modules/b");
  });

  it("поднимается к верхнему уровню, когда вложенной копии нет", () => {
    expect(resolveDependencyKey(packages, "node_modules/a/node_modules/b", "a")).toBe("node_modules/a");
  });

  it("возвращает null для неизвестного имени", () => {
    expect(resolveDependencyKey(packages, "node_modules/a", "zzz")).toBeNull();
  });
});

describe("parseLockfile", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "root", dependencies: { express: "^5.0.0" }, devDependencies: { vitest: "^4.0.0" } },
      "node_modules/express": { version: "5.2.1", resolved: "https://x/express-5.2.1.tgz", dependencies: { "@scope/dep": "^1.0.0" } },
      "node_modules/@scope/dep": { version: "1.1.0", resolved: "https://x/dep-1.1.0.tgz" },
      "node_modules/vitest": { version: "4.0.1", resolved: "https://x/vitest-4.0.1.tgz", dev: true },
      "node_modules/linked": { link: true, resolved: "vendor/linked" },
    },
  };

  it("возвращает по записи на пакет, минуя корень и ссылки", () => {
    const pkgs = parseLockfile(lock);
    expect(pkgs.map((p) => p.id).sort()).toEqual(["@scope/dep@1.1.0", "express@5.2.1", "vitest@4.0.1"]);
  });

  it("помечает dev-пакеты", () => {
    const pkgs = parseLockfile(lock);
    expect(pkgs.find((p) => p.name === "vitest")?.dev).toBe(true);
    expect(pkgs.find((p) => p.name === "express")?.dev).toBe(false);
  });

  it("разбирает область отдельно от имени", () => {
    const dep = parseLockfile(lock).find((p) => p.name === "dep");
    expect(dep).toMatchObject({ scope: "@scope", name: "dep", version: "1.1.0" });
  });

  it("запоминает, кто тянет пакет", () => {
    const pkgs = parseLockfile(lock, { rootName: "проект" });
    expect(pkgs.find((p) => p.name === "express")?.requiredBy).toEqual(["проект"]);
    expect(pkgs.find((p) => p.name === "dep")?.requiredBy).toEqual(["express@5.2.1"]);
  });
});
