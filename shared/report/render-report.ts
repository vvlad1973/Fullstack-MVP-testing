/**
 * @module shared/report/render-report
 *
 * Сборка ДОКУМЕНТА отчёта в DOM (PRD-51 §5.2).
 *
 * Оболочка даёт корневой узел, блоки становятся его ПРЯМЫМИ детьми. Прямыми — потому что
 * постраничная раскладка меряет и режет именно детей корня
 * ({@link module:shared/report/paginate-dom}), и промежуточный контейнер превратил бы
 * документ в один неделимый переросток, который дальше дорезается растром.
 *
 * Размещение делает ЭТА функция, а не шаблон: у шаблона нет узла, в который блоки бы
 * попали, поэтому завернуть их он не может. Правило держится устройством, а не проверкой —
 * сторожить ошибку, которую невозможно совершить, незачем.
 *
 * Браузерный модуль: требует DOM. Правило документа считает `report-document.ts`, здесь
 * только отрисовка.
 */
import { renderScreenInto } from "../template/render-screen";
import { PROTECTION_STYLE_ATTR } from "../template/protection/apply";
import type { ResolvedReportBlock } from "./report-document";
import { applyReportBlockOutcome } from "./report-outcome";

/**
 * Исход прогона из публичного контекста отчёта (`report.outcome`).
 *
 * @returns `passed` / `failed`, либо пустая строка, когда вердикт не вынесен или контекст
 *   поля не несёт (предпросмотр старого вида, сторонний вызов).
 */
function outcomeOf(context: unknown): string {
  const report = (context as { report?: { outcome?: unknown } } | null)?.report;
  return typeof report?.outcome === "string" ? report.outcome : "";
}

/** Контекст блока: общий контекст документа плюс собственное содержимое блока. */
function withBlock(
  context: unknown,
  own: { values: Record<string, unknown>; settings: Record<string, unknown> },
): unknown {
  const base = context && typeof context === "object" ? (context as Record<string, unknown>) : {};
  return { ...base, block: { values: own.values, settings: own.settings } };
}

/**
 * Блок с уже прочитанной раскладкой: файлы читает ХОСТ (веб — из бандла шаблона, пакет —
 * из своих ресурсов), ядро файловой системы не видит.
 */
export interface ReportBlockToRender extends ResolvedReportBlock {
  /** Разметка раскладки блока; пуста у разрыва листа. */
  layout: string;
}

/** Что нужно, чтобы напечатать документ. */
export interface RenderReportInput {
  /** Разметка оболочки: ОДИН корневой узел `.tb-report`. */
  shell: string;
  /** Публичный контекст отчёта — ОДИН на весь документ, каждый блок читает своё. */
  context: unknown;
  blocks: readonly ReportBlockToRender[];
}

/**
 * Отрисовать документ в контейнер.
 *
 * @param stage Контейнер; после вызова его единственный ребёнок — корень документа.
 * @param input Оболочка, контекст и блоки в порядке печати.
 * @throws Если оболочка не дала корневого узла: печатать блоки некуда, и молча выдать
 *   пустой контейнер значило бы отдать слушателю пустой PDF.
 */
export function renderReportInto(stage: HTMLElement, input: RenderReportInput): void {
  renderScreenInto(stage, { layout: input.shell, context: input.context });
  const root = stage.firstElementChild as HTMLElement | null;
  if (!root) throw new Error("Оболочка отчёта ничего не отрисовала");

  const doc = stage.ownerDocument;

  for (const block of input.blocks) {
    if (!block.enabled) continue;

    if (block.nature === "page-break") {
      const mark = doc.createElement("div");
      mark.setAttribute("data-page-break", "");
      root.appendChild(mark);
      continue;
    }

    if (!block.layout) continue;

    // Блок рисуется в СВОЙ буфер, а его дети переносятся в корень поштучно: сам буфер в
    // документ не попадает, иначе он и стал бы тем промежуточным контейнером, из-за
    // которого документ перестал бы делиться на листы.
    // Содержимое блока для ИСХОДА этого прогона: общие значения плюс переопределённые для
    // прошедшего или не прошедшего. Исход берётся из контекста — его считает построитель
    // отчёта тем же гейтом, что и вердиктную шапку, и отдельного аргумента у документа нет:
    // второй источник исхода мог бы разойтись с шапкой того же листа.
    const own = applyReportBlockOutcome(
      {
        values: block.values,
        settings: block.settings,
        placeholders: block.placeholders,
        outcome: block.outcome,
      },
      outcomeOf(input.context),
    );
    const buffer = doc.createElement("div");
    renderScreenInto(buffer, {
      layout: block.layout,
      // `block` — собственное содержимое блока, видимое его раскладке: по нему раскладка
      // решает, печатать ли свой заголовок вместо надписи по умолчанию, и читает свойства.
      // Область `[data-placeholder]` пустое значение стирает, поэтому выбор «своё или
      // умолчание» шаблон делает гейтом на `block.values.<ключ>`, а не самой областью.
      context: withBlock(input.context, own),
      content: { template: { placeholders: block.placeholders }, values: own.values },
    });
    // Таблицу защиты от копирования рендерер кладёт в КАЖДЫЙ корень безусловно
    // (PRD-34, `PROTECTION_STYLE_ATTR`). В документе она не нужна ни разу, не то что по
    // разу на блок: перенесённая в корень, она стала бы лишним ребёнком — а по детям
    // корня считает листы постраничная раскладка, и блок, не напечатавший ничего,
    // всё равно занимал бы место.
    buffer.querySelectorAll("[" + PROTECTION_STYLE_ATTR + "]").forEach((n) => n.remove());
    // Переносятся ВСЕ узлы, а не только элементы: `firstElementChild` оставил бы в
    // буфере комментарии и текст между узлами, и документ из блоков молча терял бы
    // комментарии раскладок — те самые, в которых живут обоснования гейтов. Пустые
    // текстовые узлы на раскладку по листам не влияют: она считает ДЕТЕЙ-ЭЛЕМЕНТОВ.
    while (buffer.firstChild) root.appendChild(buffer.firstChild);
  }
}
