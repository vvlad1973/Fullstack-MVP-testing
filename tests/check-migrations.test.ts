/**
 * @module tests/check-migrations
 * @description Стартовая проверка схемы dev-БД (`scripts/db/check-migrations`).
 *
 * Она решает две вещи, и обе — молча идти нельзя: ЧТО ещё не применено (сверка журнала
 * с базой по хешу файла) и МОЖНО ЛИ применить это без человека. Второе важно потому, что
 * dev-БД одна на все рабочие копии: `ADD COLUMN` со значением по умолчанию соседняя сессия
 * не заметит, а `DROP COLUMN` сломает её мгновенно.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { classifyMigration, pendingFromJournal } from "../scripts/db/check-migrations";

describe("разбор миграции", () => {
  it("добавление колонки применимо без человека", () => {
    const r = classifyMigration(`ALTER TABLE "tests" ADD COLUMN "lms_attempt_result" text DEFAULT 'best' NOT NULL;`);
    expect(r.destructive).toBe(false);
    expect(r.reasons).toEqual([]);
  });

  it("создание таблицы применимо без человека", () => {
    expect(classifyMigration(`CREATE TABLE "scales" ("id" uuid PRIMARY KEY);`).destructive).toBe(false);
  });

  it("снятие колонки требует решения человека", () => {
    const r = classifyMigration(`ALTER TABLE "questions" DROP COLUMN "points";`);
    expect(r.destructive).toBe(true);
    expect(r.reasons).toContain("DROP COLUMN");
  });

  it("переименование требует решения человека", () => {
    expect(classifyMigration(`ALTER TABLE "tests" RENAME COLUMN "a" TO "b";`).reasons).toContain("RENAME");
  });

  it("смена типа колонки требует решения человека", () => {
    expect(classifyMigration(`ALTER TABLE "tests" ALTER COLUMN "points" SET DATA TYPE numeric;`).destructive).toBe(true);
  });

  it("в одной миграции видны все опасные операции сразу", () => {
    const r = classifyMigration(`DROP TABLE "topic_courses";\nALTER TABLE "t" DROP COLUMN "x";`);
    expect(r.reasons).toEqual(expect.arrayContaining(["DROP TABLE", "DROP COLUMN"]));
  });
});

/** Каталог `drizzle/` с журналом и файлами — как его пишет drizzle-kit. */
function makeRepo(files: Array<{ tag: string; sql: string }>): string {
  const root = mkdtempSync(path.join(tmpdir(), "mig-"));
  mkdirSync(path.join(root, "drizzle", "meta"), { recursive: true });
  const entries = files.map((f, i) => ({ idx: i, version: "7", when: 1000 + i, tag: f.tag, breakpoints: true }));
  writeFileSync(path.join(root, "drizzle", "meta", "_journal.json"), JSON.stringify({ version: "7", dialect: "postgresql", entries }));
  for (const f of files) writeFileSync(path.join(root, "drizzle", `${f.tag}.sql`), f.sql);
  return root;
}

const hashOf = (sql: string) => createHash("sha256").update(sql).digest("hex");

describe("что осталось применить", () => {
  const added = `ALTER TABLE "tests" ADD COLUMN "a" text;`;
  const dropped = `ALTER TABLE "tests" DROP COLUMN "b";`;

  it("применённое по хешу не попадает в список", () => {
    const root = makeRepo([{ tag: "0001_a", sql: added }, { tag: "0002_b", sql: dropped }]);
    const pending = pendingFromJournal(new Set([hashOf(added)]), root);
    expect(pending.map((p) => p.tag)).toEqual(["0002_b"]);
  });

  it("пустой журнал базы означает «не применено ничего»", () => {
    const root = makeRepo([{ tag: "0001_a", sql: added }]);
    expect(pendingFromJournal(new Set(), root)).toHaveLength(1);
  });

  it("всё применено — список пуст", () => {
    const root = makeRepo([{ tag: "0001_a", sql: added }]);
    expect(pendingFromJournal(new Set([hashOf(added)]), root)).toEqual([]);
  });

  it("опасность определяется по каждой миграции отдельно", () => {
    const root = makeRepo([{ tag: "0001_a", sql: added }, { tag: "0002_b", sql: dropped }]);
    const pending = pendingFromJournal(new Set(), root);
    expect(pending.map((p) => p.destructive)).toEqual([false, true]);
  });

  it("репозиторий без журнала проверку не роняет", () => {
    const root = mkdtempSync(path.join(tmpdir(), "mig-empty-"));
    expect(pendingFromJournal(new Set(), root)).toEqual([]);
  });
});
