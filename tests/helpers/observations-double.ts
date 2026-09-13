/**
 * @module tests/helpers/observations-double
 * @description Тестовый двойник DAL-выборки прохождений (PRD-56 FR-33).
 *
 * Маршрутные тесты задают данные через `getAllAttempts` / `getAllScormAttempts`, а страница
 * теста читает их теперь через `selectObservations`. Двойник берёт ТЕ ЖЕ данные и повторяет
 * контракт выборки: отбор по тесту и источнику, устойчивый порядок, общее число. Настоящая
 * выборка проверяется на реальной базе (`tests/it/analytics-observations.it.test.ts`) — здесь
 * нужен лишь источник строк, иначе каждый маршрутный тест пришлось бы переписывать на pglite.
 */
import type { ObservationQuery, ObservationRows } from "../../server/storage/analytics-repository";

interface Sources {
  getAllAttempts: () => Promise<unknown[]> | unknown[];
  getAllScormAttempts?: () => Promise<unknown[]> | unknown[];
  getScormPackages?: () => Promise<unknown[]> | unknown[];
}

/** Собрать `selectObservations` поверх уже замоканных таблиц. */
export function observationsDouble(storage: Sources) {
  return async (query: ObservationQuery = {}): Promise<ObservationRows> => {
    if (query.impossible) return { web: [], lms: [], order: [], total: 0 };

    const wantsWeb = !query.sources?.length || query.sources.includes("web");
    const wantsLms = !query.sources?.length
      || query.sources.some(s => s === "telemetry" || s === "import");

    const web = wantsWeb
      ? ((await storage.getAllAttempts()) as Array<Record<string, unknown>>).filter(
          row => !query.testIds || query.testIds.includes(row.testId as string),
        )
      : [];
    // PRD-54: у части старых строк телеметрии своего `test_id` нет — тест известен через
    // пакет. Настоящая выборка это учитывает, значит и двойник обязан.
    const packages = storage.getScormPackages
      ? ((await storage.getScormPackages()) as Array<Record<string, unknown>>)
      : [];
    const testOfPackage = new Map(packages.map(p => [p.id as string, p.testId as string]));
    const lms = wantsLms && storage.getAllScormAttempts
      ? ((await storage.getAllScormAttempts()) as Array<Record<string, unknown>>).filter(row => {
          const testId = (row.testId as string) ?? testOfPackage.get(row.packageId as string);
          return !query.testIds || query.testIds.includes(testId);
        })
      : [];

    const order = [
      ...web.map(row => ({ id: row.id as string, source: "web" as const, startedAt: row.startedAt })),
      ...lms.map(row => ({
        id: row.id as string,
        source: (row.origin as "telemetry" | "import") ?? "telemetry",
        startedAt: row.startedAt,
      })),
    ].sort((a, b) => new Date(b.startedAt as string).getTime() - new Date(a.startedAt as string).getTime());

    return {
      web: web as never,
      lms: lms as never,
      order: order.map(({ id, source }) => ({ id, source })),
      total: order.length,
    };
  };
}
