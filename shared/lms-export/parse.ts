/**
 * @module shared/lms-export/parse
 * @description Разбор листа выгрузки отчёта LMS (PRD-54 раздел 3).
 *
 * Вход — лист как массив строк, значения уже приведены к строкам. Модуль не знает ни про exceljs,
 * ни про базу: так он проверяется без файла и одинаково работает на сервере и в браузере.
 *
 * Форма листа: девять служебных колонок, дальше по ЧЕТЫРЕ подколонки на каждое взаимодействие.
 * Идентификатор взаимодействия стоит в первой строке над первой подколонкой блока, во второй
 * строке идут подписи «Тип», «Продолжительность (сек.)», «Результат», «Полученный ответ».
 */

/** Ширина блока одного взаимодействия. */
const BLOCK = 4;
/** Число служебных колонок перед первым блоком. */
const SERVICE = 9;
/** Подписи подколонок блока — по ним лист и опознаётся. */
const SUBHEADERS = ["Тип", "Продолжительность (сек.)", "Результат", "Полученный ответ"];

export interface LmsExportRow {
  participantName: string;
  participantCode: string;
  org: string;
  courseActivatedAt: string;
  moduleActivatedAt: string;
  passed: boolean | null;
  points: number | null;
  /** `q_<uuid>` без префикса -> строка «Полученный ответ». */
  answers: Record<string, string>;
  /** `q_<uuid>` без префикса -> `correct` | `incorrect` | `neutral`. */
  results: Record<string, string>;
  /** Ключ шкалы -> числовое значение. */
  scales: Record<string, number>;
  /** Ключ шкалы -> подпись уровня. */
  scaleLevels: Record<string, string>;
  /** Имя показателя -> значение строкой: показатель бывает и числом, и кодом. */
  variables: Record<string, string>;
}

export interface LmsExportBook {
  questionIds: string[];
  scaleKeys: string[];
  variableNames: string[];
  /** Идентификаторы блоков, которые импорт не разбирает (например, `topic_*`). */
  unknownColumns: string[];
  rows: LmsExportRow[];
}

function cell(row: string[] | undefined, i: number): string {
  return String(row?.[i] ?? "").trim();
}

/**
 * Похож ли лист на выгрузку отчёта LMS.
 *
 * Опознание идёт по ДВУМ признакам сразу: четвёрка подписей во второй строке и хотя бы один блок с
 * нашим префиксом в первой. Одного мало — четвёрка встречается в чужих отчётах, префикс сам по себе
 * может оказаться в произвольной книге.
 */
export function looksLikeLmsExport(sheet: string[][]): boolean {
  const [head = [], sub = []] = sheet;
  if (head.length < SERVICE + BLOCK) return false;
  const firstBlock = SUBHEADERS.every((label, i) => cell(sub, SERVICE + i) === label);
  if (!firstBlock) return false;
  for (let i = SERVICE; i < head.length; i += BLOCK) {
    const id = cell(head, i);
    if (id.startsWith("q_") || id.startsWith("scale_") || id.startsWith("var_")) return true;
  }
  return false;
}

/**
 * Разобрать лист.
 *
 * @param sheet лист как массив строк; первые две строки — шапка, дальше данные
 * @returns состав колонок и разобранные строки
 */
export function parseLmsExport(sheet: string[][]): LmsExportBook {
  const head = sheet[0] ?? [];
  const blocks: Array<{ at: number; id: string }> = [];
  for (let i = SERVICE; i < head.length; i += BLOCK) {
    const id = cell(head, i);
    if (id) blocks.push({ at: i, id });
  }

  const questionIds: string[] = [];
  const scaleKeys: string[] = [];
  const variableNames: string[] = [];
  const unknownColumns: string[] = [];

  for (const b of blocks) {
    if (b.id.startsWith("q_")) questionIds.push(b.id.slice(2));
    else if (b.id.startsWith("scale_")) {
      const key = b.id.slice(6);
      if (!key.endsWith("_level")) scaleKeys.push(key);
    } else if (b.id.startsWith("var_")) variableNames.push(b.id.slice(4));
    else unknownColumns.push(b.id);
  }

  const rows: LmsExportRow[] = [];
  for (let r = 2; r < sheet.length; r += 1) {
    const raw = sheet[r];
    if (!raw || raw.every((v) => String(v ?? "").trim() === "")) continue;

    const row: LmsExportRow = {
      participantName: cell(raw, 0),
      participantCode: cell(raw, 1),
      org: cell(raw, 2),
      courseActivatedAt: cell(raw, 5),
      moduleActivatedAt: cell(raw, 6),
      passed: cell(raw, 7) === "" ? null : cell(raw, 7) === "Пройден",
      points: cell(raw, 8) === "" ? null : Number(cell(raw, 8)),
      answers: {},
      results: {},
      scales: {},
      scaleLevels: {},
      variables: {},
    };

    for (const b of blocks) {
      const result = cell(raw, b.at + 2);
      const value = cell(raw, b.at + 3);
      if (b.id.startsWith("q_")) {
        row.answers[b.id.slice(2)] = value;
        row.results[b.id.slice(2)] = result;
      } else if (b.id.startsWith("scale_")) {
        const key = b.id.slice(6);
        if (key.endsWith("_level")) row.scaleLevels[key.slice(0, -"_level".length)] = value;
        else if (value !== "") row.scales[key] = Number(value);
      } else if (b.id.startsWith("var_")) {
        row.variables[b.id.slice(4)] = value;
      }
    }

    rows.push(row);
  }

  return { questionIds, scaleKeys, variableNames, unknownColumns, rows };
}
