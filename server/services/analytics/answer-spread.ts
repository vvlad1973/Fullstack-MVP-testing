/**
 * @module server/services/analytics/answer-spread
 * @description PRD-56 FR-22: разброс ответов измерительного задания.
 *
 * У опросника эталона нет (PRD-26 FR-08, PRD-44 FR-09), поэтому «доля верных» для него — не
 * слабое число, а ложное: «0 % верных» утверждает, что люди ошиблись, тогда как ошибиться там
 * не во что. Сказать о таком задании можно одно — ЧТО выбирали, и этим разбросом доля верных
 * на вкладке «Вопросы» и заменяется.
 *
 * Разброс считается по-разному у двух типов, потому что «ответ» у них разный по существу:
 *
 *   - ШКАЛА: участник выбирает ОДНУ градацию, и доля градации — доля выбравших её людей.
 *     Сумма долей равна ста процентам, потому что каждый ответ попадает ровно в одну.
 *   - РАСПРЕДЕЛЕНИЕ БАЛЛОВ: участник делит бюджет между утверждениями, и «доля утверждения» —
 *     доля ОТДАННЫХ ЕМУ баллов от всех розданных. Считать здесь людей нельзя: человек отдал
 *     баллы нескольким утверждениям сразу, и сумма «долей выбравших» превысила бы сотню.
 *
 *   - КОРОТКИЙ ОТВЕТ (PRD-57 FR-28x): участник ПИШЕТ, поэтому вариантов не существует
 *     заранее — их образуют сами ответы. Здесь разброс не заменяет долю верных, а дополняет
 *     её: эталон у задания есть, и автору важно видеть, какие написания правила НЕ ловят.
 *
 * Тона у полос нет намеренно (FR-21b): высокая доля градации не «хорошо» и не «плохо» —
 * эталона, относительно которого это оценивать, у опросника не существует.
 */
import { normalizeForCompare } from "@shared/answer-check";

/** Доля одного варианта в разбросе. */
export interface SpreadOption {
  /** Подпись варианта: градация шкалы либо утверждение распределения. */
  label: string;
  /** Доля в процентах: у шкалы — доля людей, у распределения — доля розданных баллов. */
  share: number;
}

/** Разброс ответов одного задания. */
export interface AnswerSpread {
  options: SpreadOption[];
  /** Сколько ответов легло в основу: знаменатель, без которого доли не читаются (FR-27). */
  answered: number;
}

export interface AnswerSpreadInput {
  type: "scale" | "allocation" | "short";
  /**
   * Варианты задания: и у шкалы, и у распределения они лежат в `dataJson.options`.
   * У короткого ответа список ПУСТ — варианты образуют сами ответы.
   */
  options: readonly string[];
  /** Сырые ответы участников: индекс градации либо баллы по утверждениям. */
  answers: readonly unknown[];
}

/** Баллы распределения: ключ — индекс утверждения строкой, значение — сколько отдано. */
function allocationOf(answer: unknown): Record<string, number> | null {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
  return answer as Record<string, number>;
}

/**
 * Свёртка написанных ответов по частоте.
 *
 * Ключом служит ФОРМА СРАВНЕНИЯ ответа (`normalizeForCompare`), а подписью строки — самое
 * частое исходное написание в группе. Иначе «Ростехнадзор» и «ростехнадзор» разошлись бы по
 * двум строкам, и автор не увидел бы, что это один ответ — ровно того, ради чего таблица и
 * заводится: понять, почему у задания низкая доля верных.
 *
 * Строки идут по убыванию доли: сверху то, что пишут чаще всего.
 */
function textSpread(answers: readonly unknown[]): AnswerSpread | null {
  const groups = new Map<string, { total: number; spellings: Map<string, number> }>();
  let counted = 0;

  for (const answer of answers) {
    if (typeof answer !== "string") continue;
    const key = normalizeForCompare(answer);
    // Пустой ответ знаменателя не меняет: «не ответил» — не написание.
    if (key === "") continue;
    const group = groups.get(key) ?? { total: 0, spellings: new Map<string, number>() };
    group.total += 1;
    group.spellings.set(answer, (group.spellings.get(answer) ?? 0) + 1);
    groups.set(key, group);
    counted += 1;
  }

  if (counted === 0) return null;

  const options = [...groups.values()]
    .map((group) => {
      let label = "";
      let best = -1;
      for (const [spelling, times] of group.spellings) {
        if (times > best) {
          best = times;
          label = spelling;
        }
      }
      return { label, share: Math.round((group.total / counted) * 1000) / 10 };
    })
    .sort((a, b) => b.share - a.share);

  return { options, answered: counted };
}

/**
 * Разброс ответов задания.
 *
 * @returns доли по вариантам либо `null`, когда разбрасывать нечего: заданию не из чего
 *   строить варианты или на него никто не ответил. Пустой разброс и разброс из нулей —
 *   разные вещи, и `null` говорит именно «считать не из чего».
 */
export function answerSpread(input: AnswerSpreadInput): AnswerSpread | null {
  const { type, options, answers } = input;
  // Короткий ответ проверяется ПЕРВЫМ: вариантов у него нет по устройству, и общая
  // проверка «нет вариантов — считать не из чего» отбросила бы его целиком.
  if (type === "short") return textSpread(answers);
  if (options.length === 0 || answers.length === 0) return null;

  const weight = new Array<number>(options.length).fill(0);
  let counted = 0;

  for (const answer of answers) {
    if (type === "scale") {
      // Индекс приходит числом от веба и строкой из выгрузки LMS — оба вида читаются.
      const index = typeof answer === "number" ? answer : Number(answer);
      if (!Number.isInteger(index) || index < 0 || index >= options.length) continue;
      weight[index] += 1;
      counted += 1;
      continue;
    }

    const points = allocationOf(answer);
    if (points === null) continue;
    let given = 0;
    for (let index = 0; index < options.length; index += 1) {
      const value = Number(points[String(index)] ?? 0);
      if (!Number.isFinite(value) || value <= 0) continue;
      weight[index] += value;
      given += value;
    }
    // Ответ, в котором не роздано ничего, знаменателя не меняет: иначе он разбавил бы доли
    // так, будто человек ответил, ничего не выбрав.
    if (given > 0) counted += 1;
  }

  if (counted === 0) return null;

  const total = weight.reduce((sum, value) => sum + value, 0);
  if (total === 0) return null;

  return {
    options: options.map((label, index) => ({
      label,
      share: (weight[index] / total) * 100,
    })),
    answered: counted,
  };
}
