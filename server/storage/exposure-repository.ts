/**
 * @module server/storage/exposure-repository
 * @description PRD-55: доступ к материализованному счётчику выдач `question_exposure`.
 *
 * Пишет ИНКРЕМЕНТОМ в корзину месяца (FR-07), читает сумму за окно (FR-04). Взвешивание берёт
 * сумму по всем тестам, поэтому чтение группирует только по заданию — разбивка по тесту в
 * таблице нужна отчёту автору, а не отбору (FR-06).
 *
 * Таблица — агрегат, а не журнал: она восстановима пересчётом из состава веб-попыток и строк
 * телеметрии (FR-11), поэтому потеря строк теряет точность весов, но не факты.
 *
 * Выставляется через фасад `IStorage`; маршруты этот модуль не импортируют.
 */
import { and, gte, inArray, sql } from "drizzle-orm";
import { db } from "../db";
import { questionExposure } from "@shared/schema";

/**
 * Первое число месяца этой даты — ключ корзины.
 *
 * Дата собирается из ЛОКАЛЬНЫХ компонент: колонка объявлена `date` (без часового пояса), и
 * весь проект хранит наивные метки. Через UTC полночь первого числа уехала бы в предыдущий
 * месяц на любом восточном смещении.
 */
function bucketOf(at: Date): string {
  const y = at.getFullYear();
  const m = String(at.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}-01`;
}

export class ExposureRepository {
  /**
   * Плюс одна выдача каждому заданию в корзине месяца (FR-03: одна попытка — одна единица,
   * сколько бы раз участник к заданию ни возвращался).
   */
  async recordDeliveries(questionIds: string[], testId: string, at: Date): Promise<void> {
    if (questionIds.length === 0) return;
    const bucketMonth = bucketOf(at);
    // Один вопрос может прийти в списке дважды (две темы, один банк) — для счётчика это
    // по-прежнему ОДНА выдача, и дедупликация обязана случиться ДО вставки: `onConflictDoUpdate`
    // внутри одной команды второй раз не срабатывает, и Postgres отверг бы такую пачку целиком.
    const unique = Array.from(new Set(questionIds));
    const rows = unique.map((questionId) => ({
      questionId,
      testId,
      bucketMonth,
      deliveredCount: 1,
    }));
    await db.insert(questionExposure).values(rows).onConflictDoUpdate({
      target: [questionExposure.questionId, questionExposure.testId, questionExposure.bucketMonth],
      set: { deliveredCount: sql`${questionExposure.deliveredCount} + 1` },
    });
  }

  /**
   * Сумма выдач по каждому заданию начиная с корзины `since` (включительно).
   *
   * Задание без выдач в карту НЕ попадает: «нет ключа» и «ноль» для веса значат одно и то же
   * (`computeWeights` трактует отсутствие как ноль), а пустой строки в результате запроса и не
   * появится.
   */
  async getDeliveryCounts(questionIds: string[], since: Date): Promise<Map<string, number>> {
    const out = new Map<string, number>();
    if (questionIds.length === 0) return out;
    const rows = await db
      .select({
        questionId: questionExposure.questionId,
        total: sql<number>`sum(${questionExposure.deliveredCount})::int`,
      })
      .from(questionExposure)
      .where(and(
        inArray(questionExposure.questionId, questionIds),
        gte(questionExposure.bucketMonth, bucketOf(since)),
      ))
      .groupBy(questionExposure.questionId);
    for (const r of rows) out.set(r.questionId, Number(r.total));
    return out;
  }
}
