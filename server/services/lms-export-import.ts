/**
 * @module server/services/lms-export-import
 * @description Импорт выгрузки отчёта LMS в общие с телеметрией таблицы (PRD-54).
 *
 * Модуль делится надвое намеренно. {@link buildImportPlan} — чистая функция без базы и
 * ввода-вывода, поэтому три режима обезличивания проверяются тестом без подготовки хранилища.
 * {@link runImport} добавляет к плану только запись и связывание.
 *
 * Числа берутся ИЗ ФАЙЛА и не пересчитываются (PRD-54 решение 2): пакет мог быть собран под более
 * ранней версией теста, и пересчёт дал бы не то, что видел участник.
 */
import { createHash, randomUUID } from "node:crypto";
import { participantKey } from "../utils/crypto";
import { decodeLearnerResponse } from "@shared/lms-export/response-codec";
import type { LmsExportBook } from "@shared/lms-export/parse";
import type { IStorage } from "../storage";

/** Режимы одной загрузки. Обезличивание и связывание независимы — см. раздел 8.5 спеки. */
export interface ImportOptions {
  anonymize: boolean;
  sourceAnonymized: boolean;
  linkUsers: boolean;
}

/** Одна строка выгрузки, приведённая к тому, что пишется в базу. */
export interface PlannedRow {
  participantKey: string;
  /** Идентификатор для сверки с `users.external_key`. В базу НЕ пишется. */
  lookupKey: string;
  lmsUserName: string | null;
  lmsUserOrg: string | null;
  startedAt: Date;
  finishedAt: Date;
  resultPassed: boolean | null;
  totalPoints: number | null;
  scalesJson: Record<string, number>;
  variablesJson: Record<string, string>;
  answers: Array<{ questionId: string; raw: string; result: string }>;
}

export interface ImportPlan {
  rows: PlannedRow[];
  warnings: string[];
}

/**
 * Превратить разобранную книгу в план записи (PRD-54 разделы 4 и 8).
 *
 * @param book разобранная книга
 * @param opts режимы загрузки
 * @returns строки к записи и предупреждения для протокола
 */
export function buildImportPlan(book: LmsExportBook, opts: ImportOptions): ImportPlan {
  const warnings: string[] = [];

  if (opts.anonymize && opts.linkUsers) {
    warnings.push(
      "Обезличивание и связывание включены одновременно: ФИО не сохраняется, но прохождение указывает на конкретного пользователя.",
    );
  }
  if (book.unknownColumns.length > 0) {
    warnings.push(`Не разобраны колонки: ${book.unknownColumns.join(", ")}.`);
  }

  const rows: PlannedRow[] = [];
  for (const r of book.rows) {
    if (!r.moduleActivatedAt) {
      // Имя в предупреждении раскрывается только тогда, когда мы его и так сохраняем: иначе
      // протокол импорта стал бы обходным путём к тем самым данным, которые обезличивание убирает.
      const who = opts.anonymize ? "скрыто" : r.participantName;
      warnings.push(`Строка участника «${who}» без даты активации модуля пропущена.`);
      continue;
    }
    const at = new Date(r.moduleActivatedAt);
    // Предобезличенный файл уже несёт псевдоним — повторное хеширование разорвало бы связь с
    // идентификаторами того инструмента, которым файл готовили (PRD-54 раздел 4, режим 3).
    const key = opts.sourceAnonymized
      ? r.participantName
      : participantKey(r.participantName, r.participantCode, r.org);

    rows.push({
      participantKey: key,
      lookupKey: r.participantCode || r.participantName,
      lmsUserName: opts.anonymize ? null : r.participantName,
      lmsUserOrg: opts.anonymize ? null : r.org,
      // Дата активации модуля идёт и в начало, и в конец: других дат о самом прохождении файл не
      // даёт, а без `finishedAt` строка выпала бы из аналитики, которая отбирает завершённые
      // попытки. Цена — неизвестная длительность, и разбор попытки подписывает источник явно.
      startedAt: at,
      finishedAt: at,
      resultPassed: r.passed,
      totalPoints: r.points,
      scalesJson: r.scales,
      variablesJson: r.variables,
      answers: Object.keys(r.answers).map((questionId) => ({
        questionId,
        raw: r.answers[questionId],
        result: r.results[questionId] || "neutral",
      })),
    });
  }

  return { rows, warnings };
}

/** Что известно о загрузке помимо самой книги. */
export interface ImportContext {
  testId: string;
  groupId: string | null;
  fileName: string;
  fileBuffer: Buffer;
  userId: string;
  dryRun?: boolean;
}

export interface ImportResult {
  batchId: string | null;
  rowsTotal: number;
  rowsCreated: number;
  rowsUpdated: number;
  rowsSkipped: number;
  rowsLinked: number;
  warnings: string[];
}

/**
 * Выполнить импорт: партия, прохождения, ответы (PRD-54 разделы 8.3 — 8.5).
 *
 * При `dryRun` не создаётся НИЧЕГО, но счётчики считаются теми же ветками кода, что и при настоящей
 * записи, — иначе план обещал бы одно, а импорт делал другое.
 *
 * @param book разобранная книга
 * @param opts режимы загрузки
 * @param ctx тест, группа, файл и автор загрузки
 * @param storage слой доступа к данным
 * @returns счётчики и предупреждения протокола
 */
export async function runImport(
  book: LmsExportBook,
  opts: ImportOptions,
  ctx: ImportContext,
  storage: IStorage,
): Promise<ImportResult> {
  const plan = buildImportPlan(book, opts);
  const warnings = [...plan.warnings];
  const dryRun = ctx.dryRun === true;

  const questions = await storage.getQuestionsByIds(book.questionIds);
  const questionById = new Map(questions.map((q) => [q.id, q]));

  const foreign = book.questionIds.filter((id) => !questionById.has(id));
  if (foreign.length > 0) {
    warnings.push(`Вопросы не из этого теста (${foreign.length}): пакет собран под другой версией.`);
  }

  let batchId: string | null = null;
  if (!dryRun) {
    const batch = await storage.createLmsImportBatch({
      id: randomUUID(),
      testId: ctx.testId,
      groupId: ctx.groupId,
      fileName: ctx.fileName,
      // Хеш СОДЕРЖИМОГО, а не имени: тот же файл под другим именем — тот же файл.
      fileHash: createHash("sha256").update(ctx.fileBuffer).digest("hex"),
      anonymized: opts.anonymize,
      sourceAnonymized: opts.sourceAnonymized,
      linkUsers: opts.linkUsers,
      importedBy: ctx.userId,
    });
    batchId = batch.id;
  }

  let rowsCreated = 0;
  let rowsUpdated = 0;
  let rowsLinked = 0;

  for (const row of plan.rows) {
    // Связь ищется по ИСХОДНОМУ идентификатору, но в базу он не попадает: остаются
    // `participant_key` и `user_id` (PRD-54 раздел 8.5).
    let userId: string | null = null;
    if (opts.linkUsers) {
      const user = await storage.getUserByExternalKey(row.lookupKey);
      if (user) {
        userId = user.id;
        rowsLinked += 1;
      }
    }

    if (dryRun) {
      rowsCreated += 1;
      continue;
    }

    const { id, created } = await storage.upsertImportedAttempt({
      testId: ctx.testId,
      participantKey: row.participantKey,
      origin: "import",
      batchId,
      groupId: ctx.groupId,
      userId,
      lmsUserName: row.lmsUserName,
      lmsUserOrg: row.lmsUserOrg,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      lastActivityAt: row.finishedAt,
      resultPassed: row.resultPassed,
      totalPoints: row.totalPoints,
      totalQuestions: row.answers.length,
      scalesJson: row.scalesJson,
      variablesJson: row.variablesJson,
    });
    if (created) rowsCreated += 1;
    else rowsUpdated += 1;

    await storage.replaceImportedAnswers(
      id,
      row.answers.flatMap((a) => {
        const q = questionById.get(a.questionId);
        // Вопроса нет в базе — записать ответ не во что: `scorm_answers` требует тип и текст
        // вопроса. Такая строка уже названа в предупреждении о чужих вопросах.
        if (!q) return [];
        return [{
          id: randomUUID(),
          attemptId: id,
          questionId: a.questionId,
          questionPrompt: q.prompt,
          questionType: q.type,
          topicId: q.topicId,
          userAnswerJson: decodeLearnerResponse(q.type, a.raw),
          // Три состояния вместо булева: измерительный ответ не может быть неверным
          // (PRD-54 раздел 5.3). Всё, что не «верно» и не «неверно», — `neutral`.
          result: a.result === "correct" || a.result === "incorrect" ? a.result : "neutral",
          isCorrect: a.result === "correct" ? true : a.result === "incorrect" ? false : null,
          points: null,
          maxPoints: null,
          correctAnswerJson: null,
          answeredAt: row.finishedAt,
        }];
      }),
    );
  }

  const result: ImportResult = {
    batchId,
    rowsTotal: book.rows.length,
    rowsCreated,
    rowsUpdated,
    rowsSkipped: book.rows.length - plan.rows.length,
    rowsLinked,
    warnings,
  };

  if (!dryRun && batchId) {
    await storage.updateLmsImportBatch(batchId, {
      rowsTotal: result.rowsTotal,
      rowsCreated: result.rowsCreated,
      rowsUpdated: result.rowsUpdated,
      rowsSkipped: result.rowsSkipped,
      rowsLinked: result.rowsLinked,
      warnings: result.warnings,
    });
  }
  return result;
}
