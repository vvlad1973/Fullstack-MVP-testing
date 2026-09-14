/**
 * @module server/services/__tests__/lms-export-import
 * @description PRD-54 разделы 4 и 8: план импорта, три режима обезличивания, связывание и запись.
 */
import { describe, it, expect } from "vitest";
import { buildImportPlan, runImport } from "../lms-export-import";

/** Разобранная книга из одной строки — форма ровно та, что отдаёт `parseLmsExport`. */
const book = {
  questionIds: ["q1"],
  scaleKeys: ["cel"],
  variableNames: ["lead_margin"],
  unknownColumns: [],
  rows: [{
    participantName: "Иванов Иван",
    participantCode: "",
    org: "ПАО",
    courseActivatedAt: "",
    moduleActivatedAt: "2026-09-09T13:39:00.000Z",
    passed: true,
    points: 0,
    answers: { q1: "0[.]7,1[.]0" },
    results: { q1: "neutral" },
    scales: { cel: 29 },
    scaleLevels: {},
    variables: { lead_margin: "6" },
  }],
};

const OFF = { anonymize: false, sourceAnonymized: false, linkUsers: false };
const ON = { anonymize: true, sourceAnonymized: false, linkUsers: false };

describe("buildImportPlan", () => {
  it("обезличивает: ФИО в план не попадает, псевдоним есть", () => {
    const plan = buildImportPlan(book as never, ON);
    expect(plan.rows[0].participantKey).toMatch(/^[0-9a-f]{64}$/);
    expect(plan.rows[0].lmsUserName).toBeNull();
    expect(plan.rows[0].lmsUserOrg).toBeNull();
  });

  it("без обезличивания псевдоним считается ТОТ ЖЕ, но ФИО сохраняется", () => {
    // Ключ не зависит от режима намеренно: иначе переключение параметра порвало бы связь с уже
    // загруженными строками того же человека.
    const on = buildImportPlan(book as never, ON);
    const off = buildImportPlan(book as never, OFF);
    expect(off.rows[0].participantKey).toBe(on.rows[0].participantKey);
    expect(off.rows[0].lmsUserName).toBe("Иванов Иван");
    expect(off.rows[0].lmsUserOrg).toBe("ПАО");
  });

  it("предобезличенный файл не хешируется повторно", () => {
    const plan = buildImportPlan(book as never, { ...ON, sourceAnonymized: true });
    expect(plan.rows[0].participantKey).toBe("Иванов Иван");
  });

  it("предупреждает о сочетании обезличивания и связывания", () => {
    const plan = buildImportPlan(book as never, { ...ON, linkUsers: true });
    expect(plan.warnings).toContain(
      "Обезличивание и связывание включены одновременно: ФИО не сохраняется, но прохождение указывает на конкретного пользователя.",
    );
  });

  it("дата активации модуля идёт и в начало, и в конец попытки", () => {
    // Даты завершения файл не даёт вовсе; без `finishedAt` строка выпала бы из аналитики,
    // которая отбирает только завершённые попытки.
    const plan = buildImportPlan(book as never, ON);
    expect(plan.rows[0].startedAt.toISOString()).toBe("2026-09-09T13:39:00.000Z");
    expect(plan.rows[0].finishedAt.toISOString()).toBe("2026-09-09T13:39:00.000Z");
  });

  it("строка без даты активации модуля пропускается с предупреждением", () => {
    const noDate = { ...book, rows: [{ ...book.rows[0], moduleActivatedAt: "" }] };
    const plan = buildImportPlan(noDate as never, ON);
    expect(plan.rows).toHaveLength(0);
    expect(plan.warnings.some((w) => w.includes("без даты активации модуля"))).toBe(true);
  });

  it("в предупреждении о пропуске ФИО не раскрывается, когда обезличивание включено", () => {
    const noDate = { ...book, rows: [{ ...book.rows[0], moduleActivatedAt: "" }] };
    expect(buildImportPlan(noDate as never, ON).warnings.join()).not.toContain("Иванов");
    expect(buildImportPlan(noDate as never, OFF).warnings.join()).toContain("Иванов");
  });

  it("неопознанные колонки попадают в протокол", () => {
    const withUnknown = { ...book, unknownColumns: ["topic_abc_level"] };
    expect(buildImportPlan(withUnknown as never, ON).warnings.join()).toContain("topic_abc_level");
  });

  it("ключ для сверки берётся из «Кода», а при пустом — из «Пользователя»", () => {
    expect(buildImportPlan(book as never, ON).rows[0].lookupKey).toBe("Иванов Иван");
    const withCode = { ...book, rows: [{ ...book.rows[0], participantCode: "AB-12" }] };
    expect(buildImportPlan(withCode as never, ON).rows[0].lookupKey).toBe("AB-12");
  });

  it("шкалы, показатели и ответы переносятся как есть", () => {
    const row = buildImportPlan(book as never, ON).rows[0];
    expect(row.scalesJson).toEqual({ cel: 29 });
    expect(row.variablesJson).toEqual({ lead_margin: "6" });
    // `latencyMs: null` — выгрузка этого пакета времени на задании не несла.
    expect(row.answers).toEqual([
      { questionId: "q1", raw: "0[.]7,1[.]0", result: "neutral", latencyMs: null },
    ]);
  });
});

/**
 * Хранилище-заглушка: пишет ничего, но помнит, что у него просили.
 *
 * @param externalKeys карта «нормализованный ключ -> id пользователя»
 */
function storageStub(externalKeys: Record<string, string> = {}) {
  const batches: unknown[] = [];
  const attempts: unknown[] = [];
  const answers: unknown[][] = [];
  /** Номера версий, о которых спрашивали: партия обязана спрашивать каждую по разу. */
  const snapshotLookups: number[] = [];
  return {
    batches, attempts, answers, snapshotLookups,
    // PRD-56 FR-19a: у теста одна опубликованная версия — третья.
    getSnapshotByVersion: async (_testId: string, version: number) => {
      snapshotLookups.push(version);
      return version === 3 ? { id: "snap-3", testId: "t1", version } : undefined;
    },
    // Раздел с набором форм (PRD-17): по нему вариант и находит свою тему.
    getTestSections: async () => [{
      id: "s1", testId: "t1", topicId: "t1",
      formSetJson: { forms: [
        { id: "form-a", label: "Форма A", questionIds: ["q1"] },
        { id: "form-b", label: "Форма B", questionIds: ["q1"] },
      ] },
    }],
    getUserByExternalKey: async (key: string) => {
      const id = externalKeys[String(key).trim().toLowerCase()];
      return id ? { id } : undefined;
    },
    getQuestionsByIds: async (ids: string[]) =>
      [{ id: "q1", type: "allocation", prompt: "Вопрос", topicId: "t1" }].filter((q) => ids.includes(q.id)),
    createLmsImportBatch: async (b: unknown) => { batches.push(b); return { id: "batch-1" }; },
    updateLmsImportBatch: async () => undefined,
    upsertImportedAttempt: async (a: unknown) => { attempts.push(a); return { id: "a1", created: true }; },
    replaceImportedAnswers: async (_id: string, rows: unknown[]) => { answers.push(rows); },
  };
}

const ctx = {
  testId: "t1", groupId: null, fileName: "f.xlsx",
  fileBuffer: Buffer.from("x"), userId: "me",
};

describe("runImport", () => {
  it("связывает по внешнему ключу, когда флажок включён", async () => {
    const s = storageStub({ "иванов иван": "user-7" });
    const res = await runImport(book as never, { ...ON, linkUsers: true }, ctx, s as never);
    expect(res.rowsLinked).toBe(1);
    expect((s.attempts[0] as { userId: string }).userId).toBe("user-7");
  });

  it("не связывает, когда флажок выключен", async () => {
    const s = storageStub({ "иванов иван": "user-7" });
    const res = await runImport(book as never, ON, ctx, s as never);
    expect(res.rowsLinked).toBe(0);
    expect((s.attempts[0] as { userId: string | null }).userId).toBeNull();
  });

  it("несовпадение ключа — не ошибка", async () => {
    const s = storageStub();
    const res = await runImport(book as never, { ...ON, linkUsers: true }, ctx, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(res.rowsLinked).toBe(0);
  });

  it("сухой прогон считает, но ничего не создаёт", async () => {
    const s = storageStub();
    const res = await runImport(book as never, ON, { ...ctx, dryRun: true }, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(s.batches).toHaveLength(0);
    expect(s.attempts).toHaveLength(0);
  });

  it("ответ раскладывается по типу вопроса, исход берётся из файла", async () => {
    const s = storageStub();
    await runImport(book as never, ON, ctx, s as never);
    expect(s.answers[0]).toHaveLength(1);
    // 0-based у распределения — разбор обязан воспроизводить формат выданных пакетов.
    expect(s.answers[0][0]).toMatchObject({
      questionId: "q1",
      userAnswerJson: { 0: 7, 1: 0 },
      result: "neutral",
      isCorrect: null,
      points: null,
    });
  });

  it("версия формата строки доезжает до разбора ответа", async () => {
    // Та же строка в НОВОМ формате: индексы 1-based, версия сообщена пакетом. Разбор обязан
    // вернуть тот же ответ, что и легаси-строка выше, иначе импорт съедет на единицу.
    const aligned = {
      ...book,
      rows: [{ ...book.rows[0], answers: { q1: "1[.]7,2[.]0" }, responseFormat: 2 }],
    };
    const s = storageStub();
    await runImport(aligned as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ questionId: "q1", userAnswerJson: { 0: 7, 1: 0 } });
  });

  it("время на задании переносится из выгрузки в миллисекундах", async () => {
    // Колонка отчёта даёт целые секунды, в базе время лежит в миллисекундах — как и у живой
    // телеметрии, иначе два источника нельзя было бы сравнивать в одном запросе.
    const timed = {
      ...book,
      rows: [{ ...book.rows[0], latencySeconds: { q1: 47 } }],
    };
    const s = storageStub();
    await runImport(timed as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ latencyMs: 47000 });
  });

  it("без измеренного времени в базу идёт NULL, а не ноль", async () => {
    const s = storageStub();
    await runImport(book as never, ON, ctx, s as never);
    expect(s.answers[0][0]).toMatchObject({ latencyMs: null });
  });

  it("вопрос не из этого теста даёт предупреждение и не роняет импорт", async () => {
    const alien = { ...book, questionIds: ["q1", "zzz"] };
    const s = storageStub();
    const res = await runImport(alien as never, ON, ctx, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(res.warnings.join()).toContain("не из этого теста");
  });

  it("пропущенная строка попадает в rowsSkipped", async () => {
    const noDate = { ...book, rows: [{ ...book.rows[0], moduleActivatedAt: "" }] };
    const res = await runImport(noDate as never, ON, ctx, storageStub() as never);
    expect(res).toMatchObject({ rowsTotal: 1, rowsCreated: 0, rowsSkipped: 1 });
  });
});

describe("runImport — версия публикации и варианты (PRD-56 FR-19a)", () => {
  /** Строка выгрузки, сообщившая версию и выданные варианты. */
  const withMeta = (testVersion: number | null, formIds: string[]) => ({
    ...book,
    rows: [{ ...book.rows[0], testVersion, formIds }],
  });

  it("номер версии превращается в снимок и пишется на прохождение", async () => {
    const s = storageStub();
    await runImport(withMeta(3, []) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ snapshotId: "snap-3" });
  });

  it("версия спрашивается ОДИН раз на партию, а не на строку", async () => {
    // В файле тысячи прохождений и три-четыре версии: запрос на строку превратил бы загрузку
    // в тысячу обращений к базе.
    const s = storageStub();
    const many = { ...book, rows: [0, 1, 2].map((i) => ({
      ...book.rows[0], participantName: `Иванов ${i}`, testVersion: 3, formIds: [],
    })) };
    await runImport(many as never, ON, ctx, s as never);
    expect(s.snapshotLookups).toEqual([3]);
  });

  it("версия, которой у теста нет, оставляет прохождение без версии и предупреждает", async () => {
    const s = storageStub();
    const res = await runImport(withMeta(99, []) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ snapshotId: null });
    expect(res.warnings.join()).toContain("99");
  });

  it("прохождение пакета прошлой сборки идёт без версии и без запроса", async () => {
    const s = storageStub();
    await runImport(book as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ snapshotId: null });
    expect(s.snapshotLookups).toEqual([]);
  });

  it("варианты разворачиваются в карту «тема -> вариант» по разделам теста", async () => {
    // Выгрузка знает только идентификаторы форм; тему им возвращает набор форм раздела —
    // так `forms_json` импорта совпадает по форме с телеметрией и с вебом.
    const s = storageStub();
    await runImport(withMeta(3, ["form-a"]) as never, ON, ctx, s as never);
    expect(s.attempts[0]).toMatchObject({ formsJson: { t1: "form-a" } });
  });

  it("вариант, которого в тесте больше нет, предупреждает, но не роняет загрузку", async () => {
    const s = storageStub();
    const res = await runImport(withMeta(3, ["form-zzz"]) as never, ON, ctx, s as never);
    expect(res.rowsCreated).toBe(1);
    expect(s.attempts[0]).toMatchObject({ formsJson: null });
    expect(res.warnings.join()).toContain("form-zzz");
  });
});
