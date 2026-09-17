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
 * Тона у полос нет намеренно (FR-21b): высокая доля градации не «хорошо» и не «плохо» —
 * эталона, относительно которого это оценивать, у опросника не существует.
 */

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
  type: "scale" | "allocation";
  /** Варианты задания: и у шкалы, и у распределения они лежат в `dataJson.options`. */
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
 * Разброс ответов задания.
 *
 * @returns доли по вариантам либо `null`, когда разбрасывать нечего: заданию не из чего
 *   строить варианты или на него никто не ответил. Пустой разброс и разброс из нулей —
 *   разные вещи, и `null` говорит именно «считать не из чего».
 */
export function answerSpread(input: AnswerSpreadInput): AnswerSpread | null {
  const { type, options, answers } = input;
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
