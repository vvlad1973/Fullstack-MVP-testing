/**
 * @module shared/report/paginate-dom
 *
 * Измерительная половина постраничной раскладки отчёта: она смотрит на ОТРИСОВАННУЮ
 * страницу и превращает её в листы A4. Правило разрыва в ней не живёт — оно в чистом
 * {@link module:shared/report/paginate}, который считает по числам и проверяется без
 * браузера.
 *
 * ЗАЧЕМ ОТДЕЛЬНЫМ МОДУЛЕМ. Листы нужны ДВУМ местам, и они обязаны совпадать: конвейер
 * экспорта режет по ним PDF, а предпросмотр в редакторе показывает автору то, что уйдёт в
 * файл. Пока раскладка жила внутри экспорта, предпросмотр рисовал документ одной лентой —
 * автор согласовывал не тот документ, который получит слушатель.
 *
 * Браузерный модуль (нужен живой DOM), как `shared/template/dnd`.
 */

import { paginateBlocks, sliceBySafeLines, splitIndex, type ReportBlockBox } from "./paginate";

/** Upper bound of split passes: a guard against a layout that never settles. */
const MAX_SPLIT_PASSES = 400;

/** Elements whose children are text runs, not blocks: a paragraph is not split inside. */
function isTextBlock(el: Element, doc: Document): boolean {
  const view = doc.defaultView;
  if (!view) return true;
  const children = [...el.children];
  if (!children.length) return true;
  // A container whose element children are all inline (`<b>`, `<a>`, `<br>`) is a run of
  // text: its «children» are words, and splitting between them would cut a line.
  return children.every((child) => view.getComputedStyle(child).display.startsWith("inline"));
}

/** A computed length in pixels; `0` for anything unparsable. */
function px(value: string | undefined): number {
  return Number.parseFloat(value || "0") || 0;
}

/**
 * Bottom edge of an element WITH its bottom margin, in the root's own pixels.
 *
 * The margin counts: inside a padded card the last child's margin is not collapsed, it
 * stays between the text and the card's own padding — and so it takes room on the sheet.
 */
function bottomOf(el: Element, rootTop: number, scale: number, doc: Document): number {
  const margin = px(doc.defaultView?.getComputedStyle(el).marginBottom);
  return (el.getBoundingClientRect().bottom - rootTop) / scale + margin;
}

/** Room a container keeps below its last child: bottom padding and border. */
function bottomInset(el: Element, doc: Document): number {
  const style = doc.defaultView?.getComputedStyle(el);
  return px(style?.paddingBottom) + px(style?.borderBottomWidth);
}

/**
 * Split `container` so that its first part ends above `limit`.
 *
 * The container is cut between its children: the leading children that end above the limit
 * stay, the rest move into a shallow copy of the container inserted right after it. A copy,
 * not a new element: it keeps the template's classes and attributes, so each part is an
 * ordinary card with its own padding and corners. When the first child alone crosses the
 * limit and is itself a container of blocks (a list, a wrapper around the author's text),
 * the cut goes one level down and the wrapper chain is copied with it.
 *
 * @returns `true` when the container was split.
 */
function splitAt(container: Element, limit: number, rootTop: number, scale: number, doc: Document): boolean {
  if (isTextBlock(container, doc)) return false;
  const children = [...container.children];
  // The part keeps the container's own bottom padding and border, so its children have to
  // end that much higher: otherwise the part closes past the sheet edge and is cut anyway.
  const childLimit = limit - bottomInset(container, doc);
  let k = splitIndex(
    children.map((child) => ({
      bottom: bottomOf(child, rootTop, scale, doc),
      heading: /^H[1-6]$/.test(child.tagName),
    })),
    childLimit,
  );
  if (k >= children.length) return false;
  // The child on the edge may itself be a container of blocks: then it is split as well, and
  // its first part stays on this sheet — the sheet is filled instead of left half empty.
  const edge = children[k];
  if (!/^H[1-6]$/.test(edge.tagName) && splitAt(edge, childLimit, rootTop, scale, doc)) k += 1;
  if (k === 0) return false;
  const tail = container.cloneNode(false) as Element;
  for (const child of [...container.children].slice(k)) tail.appendChild(child);
  container.after(tail);
  return true;
}

/** Does the block open with an element that alone is taller than a sheet. */
function leadsWithOversize(block: Element, scale: number, usable: number): boolean {
  let el: Element | null = block.firstElementChild;
  while (el) {
    const height = el.getBoundingClientRect().height / scale;
    if (height > usable) {
      // A wrapper taller than a sheet only because of its own children is not an oversize
      // element: look inside it.
      if (!el.firstElementChild || el.children.length > 1) return true;
      el = el.firstElementChild;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Print a block taller than a sheet in parts made of whole paragraphs.
 *
 * Without this step such a block is shown through windows cut by the sheet height: lines
 * break mid-paragraph, the card loses its corners, and a heading may close a sheet alone.
 * Here every block that runs past the bottom of its sheet is split between its children
 * ({@link splitAt}), and the plan is recomputed until nothing is left to split. A block that
 * cannot be split — one element taller than a sheet, a picture, a long table row — stays
 * whole and is cut by height downstream, as before.
 *
 * Mutates `rendered`; works on the live, laid-out document because only the browser knows
 * where each paragraph ends.
 */
function splitOversizeBlocks(rendered: HTMLElement, doc: Document, scale: number, usable: number): void {
  if (!(usable > 0)) return;
  for (let pass = 0; pass < MAX_SPLIT_PASSES; pass += 1) {
    const children = [...rendered.children];
    const boxes = measureBlocks(rendered, scale);
    const breakBefore = new Set(children.flatMap((child, i) => (child.matches(PAGE_BREAK_SELECTOR) ? [i] : [])));
    const plan = paginateBlocks(boxes, usable, breakBefore);
    const rootTop = rendered.getBoundingClientRect().top;
    let changed = false;
    for (const page of plan) {
      const limit = page.offset + usable;
      const crossing = page.blocks.find((i) => boxes[i].bottom > limit);
      if (crossing === undefined) continue;
      const block = children[crossing];
      if (splitAt(block, limit, rootTop, scale, doc)) {
        changed = true;
      } else if (
        boxes[crossing].top > page.offset + 1 &&
        boxes[crossing].bottom - boxes[crossing].top > usable &&
        !leadsWithOversize(block, scale, usable)
      ) {
        // Nothing of the block fits whole on this sheet (its first paragraph runs past the
        // edge, or it opens with a heading): start it on the next sheet, where it can be
        // split from the top. A block already at the top of its sheet stays — moving it
        // would only add an empty sheet. A block that opens with an element taller than a
        // sheet stays too: that element is cut by height wherever it starts, and moving it
        // would only waste the rest of this sheet.
        const mark = doc.createElement("div");
        mark.setAttribute("data-page-break", "");
        block.before(mark);
        changed = true;
      }
      if (changed) break;
    }
    if (!changed) return;
  }
}

/**
 * Узел ПРИНУДИТЕЛЬНОГО РАЗРЫВА страницы в макете отчёта.
 *
 * Контракт рендерера, как `data-path` и `data-action`, а не имя класса: имена классов
 * принадлежат шаблону, и внешний шаблон, назвавший метку иначе, потерял бы разрыв молча.
 * Метка ставится на любой глубине — между карточками, внутри карточки, в теле `{{#each}}`.
 */
export const PAGE_BREAK_SELECTOR = "[data-page-break]";

/**
 * Класс-модификатор корня отчёта на страницах ПОСЛЕ титульной.
 *
 * Контракт рендерера: ставит его продукт, а что он значит, решает шаблон. Титульная несёт
 * подложку, остальные — то, что шаблон объявил под этим классом: свой фон листа и свои
 * цвета текста (на светлом листе белый текст читаться перестаёт). Шаблон без правил под
 * классом печатает продолжение так же, как титульную без картинки.
 *
 * Правила под классом обязаны менять только ЦВЕТ и фон: раскладка листов считается без
 * класса, и сменившаяся геометрия разошлась бы с уже нарезанными страницами.
 */
export const CONTINUED_SHEET_CLASS = "tb-report--continued";

/** Ширина страницы отчёта в CSS-пикселях (A4 при 72 dpi). */
export const PAGE_WIDTH_PX = 595;
/** Высота страницы отчёта в CSS-пикселях. */
export const PAGE_HEIGHT_PX = 842;

/**
 * Начиная с какой высоты вложенный элемент считается БЛОКОМ, а не строкой текста.
 * Строка отчёта — 12–20 px с интерлиньяжем; всё, что заметно выше, — контейнер, и его
 * нижняя граница годится в предпочтительное место разреза.
 */
const MIN_BLOCK_HEIGHT_PX = 40;

/**
 * Один лист документа.
 *
 * `root` — элемент, который печатается; `top`/`height` — видимая часть его СОДЕРЖИМОГО,
 * отсчитанная от первого пикселя содержимого (верхнее поле страницы в эти координаты не
 * входит: его держит окно листа). Смещение ненулевое только у листов, продолжающих
 * карточку-переросток: она выше страницы, и её единственный элемент показывается
 * несколькими листами по очереди.
 */
export interface ReportSheet {
  root: HTMLElement;
  top: number;
  height: number;
}

/**
 * Полезная высота листа: A4 минус собственные поля страницы отчёта.
 *
 * Поля читаются с ОТРИСОВАННОГО корня, а не берутся числом: они принадлежат CSS шаблона, и
 * внешний шаблон вправе задать свои. Среда без раскладки (jsdom) отдаёт пустые значения —
 * тогда полем считается ноль, и это ровно то, чего от неё ждут: делить документ ей нечем.
 */
function usablePageHeight(rendered: Element, doc: Document): number {
  const { top, bottom } = pagePadding(rendered, doc);
  return PAGE_HEIGHT_PX - top - bottom;
}

/**
 * Вертикальные поля страницы отчёта, как их объявил ШАБЛОН.
 *
 * Они держат две вещи сразу: полезную высоту листа и положение окна, в котором лист
 * показывает свой кусок содержимого. Пока поле знала только раскладка, продолжение
 * карточки печаталось от самого края бумаги — сверху и снизу поля не было вовсе.
 */
function pagePadding(rendered: Element, doc: Document): { top: number; bottom: number } {
  const style = doc.defaultView?.getComputedStyle(rendered);
  const pad = (value: string | undefined) => Number.parseFloat(value || "0") || 0;
  return { top: pad(style?.paddingTop), bottom: pad(style?.paddingBottom) };
}

/**
 * Во сколько раз страница ПОКАЗАНА мельче, чем свёрстана.
 *
 * Предпросмотр в редакторе уменьшает документ (`zoom` на сцене), и `getBoundingClientRect`
 * отдаёт уже уменьшенные числа, тогда как высота листа задана в собственных пикселях
 * страницы. Без поправки документ «умещался» куда не следовало: план клал на лист больше,
 * чем на нём помещается, и лист потом дорезался растром — вместо разрыва между карточками.
 *
 * Масштаб берётся из ОТНОШЕНИЯ измерений, а не из известной ширины: `offsetHeight` зум не
 * трогает, `getBoundingClientRect` трогает, и их частное верно при любой ширине страницы —
 * в том числе у внешнего шаблона, который свёрстан не под 595 px.
 */
function renderScale(rendered: HTMLElement): number {
  const rect = rendered.getBoundingClientRect();
  if (!(rect.height > 0) || !(rendered.offsetHeight > 0)) return 1;
  return rect.height / rendered.offsetHeight;
}

/**
 * Границы блоков верхнего уровня относительно верха страницы — вход раскладки.
 *
 * Блок — прямой ребёнок корня: строка шапки или карточка отчёта. Более мелкое дробление
 * (абзац, строка таблицы) намеренно не рассматривается: разрыв внутри карточки — то, ради
 * чего постраничная выдача и делалась.
 *
 * Меряется `offsetTop`/`offsetHeight`: они в собственных пикселях страницы, и масштаб
 * показа на них не влияет. Корень отчёта позиционирован (`position: relative`), поэтому
 * `offsetTop` прямого ребёнка отсчитывается от него же.
 */
function measureBlocks(rendered: HTMLElement, scale: number): ReportBlockBox[] {
  const rootTop = rendered.getBoundingClientRect().top;
  return [...rendered.children].map((child) => {
    const el = child as HTMLElement;
    if (el.offsetHeight > 0 && el.offsetParent) {
      return { top: el.offsetTop, bottom: el.offsetTop + el.offsetHeight };
    }
    // Запасной путь для среды без раскладки (jsdom) и для непозиционированного корня.
    const rect = el.getBoundingClientRect();
    return { top: (rect.top - rootTop) / scale, bottom: (rect.bottom - rootTop) / scale };
  });
}

/**
 * Границы КРУПНЫХ вложенных блоков — карточки показателя, строки шкалы, абзаца
 * рекомендаций. Разрез по ним оставляет блок целым, поэтому у края листа они выигрывают
 * у строки (см. {@link module:shared/report/paginate} `SliceOptions.blockLines`).
 *
 * Крупным считается элемент не глубже третьего уровня и выше одной строки: глубже лежат
 * уже сами строки и подписи, а их низы и так собирает {@link safeCutLines}. Отбор идёт по
 * ГЕОМЕТРИИ, а не по классам: имена классов принадлежат шаблону, и внешний шаблон,
 * назвавший карточку иначе, потерял бы это правило молча.
 */
/**
 *Высота содержимого листа — низ последнего блока плюс нижнее поле.
 *
 * Берётся по ДЕТЯМ, а не с самого элемента: корень отчёта объявляет `min-height` в целый
 * лист, чтобы короткая страница всё равно несла фон, и его `offsetHeight` о содержимом
 * ничего не говорит.
 */
function contentHeight(root: HTMLElement, scale: number): number {
  const rootTop = root.getBoundingClientRect().top;
  let bottom = 0;
  for (const child of [...root.children]) {
    const el = child as HTMLElement;
    const value =
      el.offsetHeight > 0 && el.offsetParent
        ? el.offsetTop + el.offsetHeight
        : (el.getBoundingClientRect().bottom - rootTop) / scale;
    if (value > bottom) bottom = value;
  }
  return bottom;
}

/**
 * Ординаты ПРИНУДИТЕЛЬНЫХ разрывов — там, где верстальщик шаблона приказал начать лист.
 *
 * Берётся ВЕРХНЯЯ граница метки, а не нижняя: узел объявлен пустым, но если шаблон нечаянно
 * даст ему высоту, разрез по верху всё равно не оставит на бумаге его следа.
 */
function forcedCutLines(root: Element, scale: number): number[] {
  const rootTop = root.getBoundingClientRect().top;
  return [...root.querySelectorAll(PAGE_BREAK_SELECTOR)].map(
    (el) => (el.getBoundingClientRect().top - rootTop) / scale,
  );
}

function blockCutLines(root: HTMLElement, scale: number, minHeight: number): number[] {
  const rootTop = root.getBoundingClientRect().top;
  const lines: number[] = [];
  const walk = (el: Element, depth: number) => {
    for (const child of [...el.children]) {
      const rect = child.getBoundingClientRect();
      const height = rect.height / scale;
      if (height >= minHeight) lines.push((rect.bottom - rootTop) / scale);
      if (depth < 3) walk(child, depth + 1);
    }
  };
  walk(root, 1);
  return lines;
}

/**
 * Ординаты, по которым лист можно разрезать, не рассекая строку текста.
 *
 * Собирается ДВУМЯ источниками. Первый — низ каждой визуальной строки: где браузер перенёс
 * текст, знает только он, и `Range.getClientRects()` отдаёт по прямоугольнику на строку —
 * единственный доступный способ это узнать. Второй — низ каждого вложенного элемента: между
 * абзацем и заголовком резать можно, а строки внутри пустого элемента нет.
 *
 * Среда без раскладки вернёт пустой список — тогда {@link sliceBySafeLines} режет по высоте
 * листа, то есть ровно так, как резал бы без этой функции.
 */
function safeCutLines(root: Element, doc: Document, scale: number): number[] {
  const rootTop = root.getBoundingClientRect().top;
  const lines: number[] = [];
  root.querySelectorAll("*").forEach((el) => {
    lines.push((el.getBoundingClientRect().bottom - rootTop) / scale);
  });
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */);
  const range = doc.createRange();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!String(node.nodeValue ?? "").trim()) continue;
    range.selectNodeContents(node);
    const rects = range.getClientRects?.();
    if (!rects) continue;
    for (let i = 0; i < rects.length; i += 1) lines.push((rects[i].bottom - rootTop) / scale);
  }
  return lines;
}

/**
 * Фон страниц документа: подложка ТИТУЛЬНОЙ и фон всех остальных.
 *
 * Картинка-подложка — обложка, а не обои: повторённая на каждом листе, она спорит с текстом
 * и печатает семь одинаковых разворотов вместо одного. Поэтому изображение остаётся первой
 * странице, а прочие получают фон, который шаблон объявил под {@link CONTINUED_SHEET_CLASS}.
 * Не объявил — им достаётся фон корня без картинки: тот самый градиент, который печатается,
 * когда автор подложку не задал вовсе.
 *
 * Фон продолжения читается ЗАМЕРОМ, а не собирается из строки: изображение приходит
 * инлайновым `background-image` из макета и перебивает фон CSS целиком, поэтому в
 * вычисленном значении его уже нет. На время замера инлайн снимается, а класс продолжения
 * ставится; потом оба возвращаются как были.
 *
 * Экспортирована ради тестов: многолистовую раскладку jsdom не строит, а правило фона
 * проверяется и без неё.
 *
 * @param rendered Корень отрисованной страницы отчёта (`.tb-report`).
 * @param doc Документ, в котором она живёт.
 * @returns Фон титульной (`cover`) и фон листов продолжения (`rest`) — вычисленные
 *   значения свойства `background`.
 */
export function pageBackgrounds(rendered: HTMLElement, doc: Document): { cover: string; rest: string } {
  const view = doc.defaultView;
  const cover = view?.getComputedStyle(rendered).background ?? "";
  const inline = rendered.style.backgroundImage;
  const hadClass = rendered.classList.contains(CONTINUED_SHEET_CLASS);
  rendered.style.backgroundImage = "";
  rendered.classList.add(CONTINUED_SHEET_CLASS);
  const rest = view?.getComputedStyle(rendered).background ?? "";
  rendered.style.backgroundImage = inline;
  if (!hadClass) rendered.classList.remove(CONTINUED_SHEET_CLASS);
  return { cover, rest };
}

/**
 * Готовые СТРАНИЦЫ документа: элементы ровно в лист A4, из которых и снимается PDF.
 *
 * Почему страница — отдельный элемент, а не кусок общего снимка. Резать растр значит
 * тащить сквозь границу листа всё, что на ней оказалось: фон продолжался с середины
 * градиента, будто страницу оторвали от рулона, а неполный лист приходилось дотягивать
 * добором, который размазывал нижнюю строку пикселей — вместе с буквами. Отдельная
 * страница обрезает содержимое сама (`overflow: hidden`), фон рисует СВОЙ, с собственного
 * верха, и снимается целиком — резать и дотягивать нечего.
 *
 * Фон переносится на страницу, а у внутренней копии гасится: иначе градиент копии,
 * растянутый по её полной высоте, лёг бы поверх и вернул ту же поехавшую подложку.
 * Картинку-подложку получает ТОЛЬКО первая страница, остальные — фон шаблона
 * ({@link pageBackgrounds}), а их копия корня — класс {@link CONTINUED_SHEET_CLASS}, чтобы
 * шаблон перекрасил текст под свой лист продолжения.
 *
 * @param rendered Корень отрисованной страницы отчёта (`.tb-report`).
 * @param doc Документ, в котором она живёт.
 * @param mount Куда положить служебные клоны, чтобы они получили раскладку и стили.
 * @returns Страницы в порядке документа; каждая — ровно лист A4.
 */
export function buildReportPages(rendered: HTMLElement, doc: Document, mount?: HTMLElement): HTMLElement[] {
  const { cover, rest } = pageBackgrounds(rendered, doc);
  const pad = pagePadding(rendered, doc);
  const usable = usablePageHeight(rendered, doc);
  const parent = mount ?? (rendered.parentElement as HTMLElement | null);
  return buildReportSheets(rendered, doc, mount).map((sheet, index) => {
    const background = index === 0 ? cover : rest;
    const page = doc.createElement("div");
    // Класс — для узнаваемости в отладке и в тестах: снимок снимается со СТРАНИЦЫ, а
    // `.tb-report` лежит внутри неё копией.
    page.className = "tb-report-page";
    page.style.cssText =
      `position:relative;width:${PAGE_WIDTH_PX}px;height:${PAGE_HEIGHT_PX}px;overflow:hidden;` +
      (background ? `background:${background};` : "");

    // ОКНО между полями страницы. Содержимое обрезается ИМ, а не листом: поле обязано
    // остаться и сверху, и снизу — на каждой странице, а не только на первой. Высота окна
    // равна полезной высоте, по ней же посчитан кусок, поэтому лишнего лист не покажет и
    // строка не повторится на следующем.
    // Высота окна — высота ЭТОГО куска, а не всей полезной площади: кусок кончается там,
    // где прошёл разрез, и окно ростом в целую страницу показывало бы хвост, который уже
    // отдан следующему листу. Именно так строка выходила дважды — внизу одной страницы и
    // вверху другой. Ниже окна остаётся фон, то есть законное нижнее поле.
    const shown = Math.max(0, Math.min(sheet.height, usable));
    const window = doc.createElement("div");
    window.style.cssText =
      `position:absolute;left:0;right:0;top:${pad.top}px;height:${Math.round(shown)}px;overflow:hidden;`;

    const inner = sheet.root.cloneNode(true) as HTMLElement;
    inner.style.display = "";
    inner.style.background = "none";
    if (index > 0) inner.classList.add(CONTINUED_SHEET_CLASS);
    // Свои вертикальные поля копия отдаёт окну — иначе на первой странице отступ сложился
    // бы дважды. Горизонтальные остаются: их окно не задаёт.
    inner.style.paddingTop = "0";
    inner.style.paddingBottom = "0";
    // Кусок отсчитан от ПЕРВОГО ПИКСЕЛЯ СОДЕРЖИМОГО, и копия начинается им же (своё верхнее
    // поле она отдала окну), поэтому поправка — ровно смещение куска.
    inner.style.marginTop = `-${Math.round(sheet.top)}px`;

    window.appendChild(inner);
    page.appendChild(window);
    parent?.appendChild(page);
    return page;
  });
}

/**
 * Разложить отрисованную страницу отчёта на листы A4.
 *
 * Документ в один лист возвращается КАК ЕСТЬ, тем же элементом и без клона: так у экспорта
 * сохраняется прежнее окружение (CSS варианта, токены оформления на контейнере) и прежний
 * результат байт в байт. Многолистовой документ клонируется, и каждый лист получает только
 * свои блоки.
 *
 * @param rendered Корень отрисованной страницы (`.tb-report`).
 * @param doc Документ, в котором она живёт.
 * @param mount Куда положить клоны листов, чтобы они получили раскладку и стили. Без него
 *   клоны кладутся рядом с оригиналом.
 * @returns Листы в порядке документа; для однолистового отчёта — ровно один.
 */
export function buildReportSheets(rendered: HTMLElement, doc: Document, mount?: HTMLElement): ReportSheet[] {
  const scale = renderScale(rendered);
  const usable = usablePageHeight(rendered, doc);
  // Верхнее поле страницы: им отличается пространство ИЗМЕРЕНИЙ от пространства КУСКОВ.
  const pad = pagePadding(rendered, doc);
  // Блок выше листа делится по целым абзацам ДО раскладки: дальше он — несколько обычных
  // блоков, и раскладка кладёт их по листам своим правилом. Резать по высоте остаётся
  // только то, что делить не по чему.
  splitOversizeBlocks(rendered, doc, scale, usable);
  // Метки разрыва ВЕРХНЕГО УРОВНЯ решают раскладку страниц, а не разрез внутри листа:
  // индексы совпадают с боксами, потому что и те и другие считаются по одним детям корня.
  const breakBefore = new Set(
    [...rendered.children].flatMap((child, i) => (child.matches(PAGE_BREAK_SELECTOR) ? [i] : [])),
  );
  const planned = paginateBlocks(measureBlocks(rendered, scale), usable, breakBefore);
  // Макет без блоков верхнего уровня (один текст в корне — так выглядят проверочные
  // страницы и вырожденные шаблоны) делить не на что: он остаётся одним листом.
  const plan = planned.length ? planned : [{ blocks: [], offset: 0, height: 0 }];
  if (plan.length === 1) {
    const measuredOnly = contentHeight(rendered, scale);
    const onlyHeight = measuredOnly > 0 ? Math.max(0, measuredOnly - pad.top) : plan[0].height;
    const forcedInside = forcedCutLines(rendered, scale).filter(
      (line) => line - pad.top > 0 && line - pad.top < onlyHeight,
    );
    // Быстрый путь — только пока документ ДЕЙСТВИТЕЛЬНО помещается на лист и делить его
    // никто не приказывал. Один блок выше страницы (длинное толкование показателя без
    // всякой шапки) даёт тот же единственный лист, и отданный «как есть» он обрезался бы
    // окном молча: конец текста не уезжал на второй лист, а пропадал. Такой документ — и
    // документ с принудительным разрывом — уходит общим путём и режется.
    if (onlyHeight <= usable && !forcedInside.length) {
      return [{ root: rendered, top: 0, height: onlyHeight }];
    }
  }

  // Эталон снимается ДО того, как оригинал будет спрятан: клон копирует и инлайн-стили,
  // поэтому лист, склонированный с уже скрытой страницы, ушёл бы в растеризатор невидимым
  // и вернулся пустым холстом.
  const pristine = rendered.cloneNode(true) as HTMLElement;
  const parent = mount ?? (rendered.parentElement as HTMLElement | null);
  rendered.style.display = "none";

  const sheets: ReportSheet[] = [];
  for (const pagePlan of plan) {
    const sheetRoot = pristine.cloneNode(true) as HTMLElement;
    const keep = new Set(pagePlan.blocks);
    [...sheetRoot.children].forEach((child, i) => {
      if (!keep.has(i)) child.remove();
    });
    parent?.appendChild(sheetRoot);
    // Карточка выше листа печатается несколькими листами — единственное место, где разрыв
    // проходит ВНУТРИ блока. Проходит он по нижней границе строки: строка, разрезанная
    // пополам, нечитаема на обеих половинах.
    // Высота СОДЕРЖИМОГО, а не элемента: у корня отчёта `min-height` в целый лист, и
    // `offsetHeight` отдаёт его даже под одной строкой шапки. Лист тогда считался
    // переростком и резался надвое — вторая половина уходила в файл пустой страницей.
    //
    // ВЕРХНЕЕ ПОЛЕ СНИМАЕТСЯ. Меряется всё от верхнего края корня, то есть вместе с полем,
    // а показывает кусок ОКНО, которое стоит уже за полем и несёт одно содержимое. Пока
    // поле оставалось в координатах, окно показывало на его высоту БОЛЬШЕ отмеренного:
    // лишняя полоса приходила из следующего куска, строка на её краю резалась пополам, и
    // она же выходила целиком на следующем листе. Заодно лист «на всю полезную высоту»
    // считался переростком — на высоту поля — и делился надвое без нужды.
    const measured = contentHeight(sheetRoot, scale);
    const height = measured > 0 ? Math.max(0, measured - pad.top) : pagePlan.height;
    // Подсказки о крупных границах считаются от той же высоты строки, что и правило
    // висячей строки: «выше одной строки» — это и есть «не строка, а блок».
    const lines = safeCutLines(sheetRoot, doc, scale).map((line) => line - pad.top);
    const blockLines = blockCutLines(sheetRoot, scale, MIN_BLOCK_HEIGHT_PX).map((line) => line - pad.top);
    // Приказ верстальщика шаблона: здесь лист обязан кончиться, сколько бы места ни осталось.
    const forcedLines = forcedCutLines(sheetRoot, scale).map((line) => line - pad.top);
    // Режется по ПОЛЕЗНОЙ высоте, а не по всему листу: кусок показывается в окне между
    // полями страницы. Кусок ростом в целый лист туда не влезал — страница печатала
    // больше отведённого, обрывала строку на середине, и следующая начинала с неё же.
    for (const slice of sliceBySafeLines(lines, height, usable, { blockLines, forcedLines })) {
      sheets.push({ root: sheetRoot, top: slice.top, height: slice.height });
    }
  }
  return sheets;
}
