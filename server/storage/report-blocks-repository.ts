/**
 * @module server/storage/report-blocks-repository
 * @description Слой данных ДОКУМЕНТА ОТЧЁТА (PRD-51 §4): упорядоченный список блоков
 * одного теста, по ветви на режим.
 *
 * Замена документа — ОДНА транзакция «удалить и вставить». Порядок и состав блоков
 * осмысленны только целиком: частично записанный документ означал бы отчёт, которого
 * автор не собирал, и восстановить его было бы неоткуда. По той же причине здесь нет
 * точечных методов «добавить блок» / «переставить блок» — редактор правит документ
 * черновиком и сохраняет его разом, одной кнопкой на весь ящик.
 *
 * Выставляется через фасад `IStorage`, маршрутами напрямую не импортируется.
 */
import { and, asc, eq } from "drizzle-orm";
import { db } from "../db";
import { reportBlocks, type ReportBlockRow, type InsertReportBlockRow } from "@shared/schema";

/** Режим теста, которому принадлежит документ. */
export type ReportDocumentMode = "standard" | "adaptive";

/**
 * Поля строки, которые задаёт вызывающий: `testId` и `mode` приходят аргументами, а
 * идентификатор и отметки времени — база.
 */
export type ReportBlockInput = Omit<
  InsertReportBlockRow,
  "id" | "testId" | "mode" | "createdAt" | "updatedAt"
>;

/** Репозиторий таблицы `report_blocks`. */
export class ReportBlocksRepository {
  /**
   * Документ теста для режима, в порядке печати.
   *
   * @returns Строки по возрастанию `sortOrder`. ПУСТОЙ массив — документ не собран, и
   *   печатается документ по умолчанию шаблона (`reportDocument`), а не пустой отчёт.
   */
  async listReportBlocks(testId: string, mode: ReportDocumentMode): Promise<ReportBlockRow[]> {
    return db
      .select()
      .from(reportBlocks)
      .where(and(eq(reportBlocks.testId, testId), eq(reportBlocks.mode, mode)))
      .orderBy(asc(reportBlocks.sortOrder));
  }

  /**
   * Заменить документ режима целиком.
   *
   * Пустой список СТИРАЕТ документ и возвращает тест к умолчанию шаблона — это
   * осмысленное действие автора («сбросить документ»), а не вырожденный случай.
   * Ветвь другого режима не затрагивается: у теста, сменившего режим, обе ветви
   * сохраняются, как и в `report_settings_json`.
   */
  async replaceReportBlocks(
    testId: string,
    mode: ReportDocumentMode,
    blocks: readonly ReportBlockInput[],
  ): Promise<void> {
    await db.transaction(async (tx) => {
      await tx
        .delete(reportBlocks)
        .where(and(eq(reportBlocks.testId, testId), eq(reportBlocks.mode, mode)));
      if (!blocks.length) return;
      await tx.insert(reportBlocks).values(blocks.map((b) => ({ ...b, testId, mode })));
    });
  }
}
