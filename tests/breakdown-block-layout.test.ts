/**
 * @module tests/breakdown-block-layout
 * @description PRD-50 FR-28/FR-30/FR-33, задача 9: экран итогов и страница отчёта ОБОИХ
 * штатных шаблонов печатают сводный блок разреза по области теста.
 *
 * Требования, ради которых написан тест:
 *   - ключ, живущий в двух разделах, виден ОДНОЙ сводной строкой: строки внутри блока не
 *     группируются по разделам, иначе блок повторял бы карточки тем;
 *   - тест без включённого блока печатает ровно то же, что печатал до этапа — ни одного
 *     нового узла.
 *
 * Макеты читаются с диска: контракт — отгруженные файлы, а не копия в фикстуре.
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { compileTemplate } from "../shared/template/dsl";

const TEMPLATES: Record<string, string> = {
  default: path.join(process.cwd(), "server/scorm/templates/default/layouts"),
  certification: path.join(process.cwd(), "templates/certification/layouts"),
};

const LABELS = {
  results: { heading: "Ваш результат", topics: "Результаты по темам", breakdown: "Разрез результата" },
  facts: { questions: "вопросов", correct: "верно", points: "баллов" },
  topic: { correct: "Правильно", points: "Баллов" },
  recommendations: { courses: "Курсы", events: "Мероприятия", assets: "Материалы" },
};

/** Ключ «ПДн» выдан в двух разделах — в блоке он ОДНА строка на весь тест. */
const ROWS = [
  { key: "ПДн", items: 4, answered: 4, earned: 3, possible: 4, percent: 75, percentUnits: 75,
    percentPoints: 75, barPercent: 75, showValue: true, valueLabel: "75 %", passed: true,
    passClass: "is-pass", statusLabel: "Пройдено" },
  { key: "Антикоррупция", items: 2, answered: 1, earned: 0, possible: 2, percent: 0, percentUnits: 0,
    percentPoints: 0, barPercent: 0, showValue: true, valueLabel: "0 %", passed: false,
    passClass: "is-fail", statusLabel: "Не пройдено" },
];

const topic = (topicName: string) => ({
  topicName, correct: 4, total: 5, percent: 80, passClass: "is-pass", statusLabel: "Пройдено",
  countsLabel: "4 из 5 (80%)", pointsFixedLabel: "4.0/5.0", verdictLabel: "Пройден", barPercent: 80,
  recommendedCourses: [], recommendedEvents: [], hasRecommendations: false,
});

const WITH_BLOCK = { topicResults: [topic("Право")], breakdown: ROWS };
const WITHOUT_BLOCK = { topicResults: [topic("Право")] };

const resultsContext = (result: Record<string, unknown>, withBlockSubblock: boolean) => ({
  course: { title: "Тест" },
  design: {},
  labels: LABELS,
  result: {
    passClass: "is-pass", statusLabel: "Пройден", scorePercent: 80,
    totalQuestions: 10, correct: 8, earnedPoints: 8,
    blocks: [
      { key: "topics", heading: "Результаты по темам", isTopics: true },
      ...(withBlockSubblock ? [{ key: "breakdown", heading: "Разрез результата", isBreakdown: true }] : []),
    ],
    ...result,
  },
});

const reportContext = (result: Record<string, unknown>) => ({
  design: {},
  labels: LABELS,
  report: {
    kind: "standard", hasTopics: true, gridColumns: 2, verdictHeadline: "Тест пройден",
    correctLabel: "8/10", earnedPointsLabel: "8.0", ringDasharray: 276, ringDashoffset: 55,
  },
  result: { passed: true, scorePercent: 80, ...result },
});

/** How many times a name shows up in the rendered screen. */
const times = (html: string, needle: string): number => html.split(needle).length - 1;

for (const [templateId, dir] of Object.entries(TEMPLATES)) {
  describe(`${templateId}: экран итогов печатает сводный блок разреза`, () => {
    const render = compileTemplate(fs.readFileSync(path.join(dir, "results.html"), "utf-8"));

    it("печатает заголовок блока и по одной строке на ключ", () => {
      const html = render(resultsContext(WITH_BLOCK, true));
      expect(html).toContain("Разрез результата");
      expect(times(html, 'class="tb-breakdown"')).toBe(1);
      expect(times(html, 'data-item="ПДн"')).toBe(1);
      expect(times(html, 'data-item="Антикоррупция"')).toBe(1);
      expect(html).toContain("width: 75%;");
    });

    it("строка несёт вердикт ключа и число выбранной базы", () => {
      const html = render(resultsContext(WITH_BLOCK, true));
      expect(html).toContain('class="tb-breakdown__row is-pass"');
      expect(html).toContain('class="tb-breakdown__row is-fail"');
      expect(html).toContain("75 %");
    });

    it("блок выключен — ни узла, ни заголовка", () => {
      const html = render(resultsContext(WITHOUT_BLOCK, false));
      expect(html).not.toContain('class="tb-breakdown"');
      expect(html).not.toContain("Разрез результата");
    });

    it("шаблон печатает блок ТОЛЬКО по флагу подблока (FR-30)", () => {
      // Данные в контексте есть, но состав подблоков их не объявил — так выглядит экран
      // шаблона, который ключа `breakdown` не знает.
      const html = render(resultsContext(WITH_BLOCK, false));
      expect(html).not.toContain('class="tb-breakdown"');
    });
  });

  describe(`${templateId}: страница отчёта печатает сводный блок разреза`, () => {
    const render = compileTemplate(fs.readFileSync(path.join(dir, "report.html"), "utf-8"));

    it("печатает свою карточку с заголовком и строками", () => {
      const html = render(reportContext(WITH_BLOCK));
      expect(html).toContain("Разрез результата");
      expect(times(html, "tb-report__breakdown--block")).toBe(1);
      expect(times(html, 'data-item="ПДн"')).toBe(1);
    });

    it("блок выключен — карточки нет", () => {
      const html = render(reportContext(WITHOUT_BLOCK));
      expect(html).not.toContain("tb-report__breakdown--block");
      expect(html).not.toContain("Разрез результата");
    });
  });
}
