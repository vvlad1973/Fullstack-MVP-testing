/**
 * @module features/tests/editor/sections/report-block-palette
 * @description ПАЛИТРА ДОБАВЛЕНИЯ БЛОКА в документ отчёта (PRD-51 §7.3, FR-16).
 *
 * Эскиз: `docs/wireframes/prd51-report-document.html`, состояние `s-add-palette`. Список
 * опций — та же разметка `variant-list`, что у выбора варианта страницы в «Структуре»:
 * автор уже выбирал так раскладку, и второй способ выбора ему тут не нужен.
 *
 * Три группы, и каждая отвечает на свой вопрос:
 *
 * - «Страницы» — варианты вида `page`, объявленные АКТИВНЫМ шаблоном. Их состав дело
 *   шаблона, а не продукта: продукт не знает, умеет ли этот шаблон три колонки.
 * - «Служебное» — разрыв листа. Раскладки у него нет: это инструкция документу.
 * - «Удалённые из документа» — системные блоки, которых сейчас в списке нет. Единственный
 *   путь вернуть выключенный автором раздел: удалять системный блок нельзя, но собрать
 *   документ заново, начав с пустого, автор вправе.
 *
 * Группа без единого элемента не рисуется. Пустой заголовок «Удалённые из документа»
 * сообщал бы, что что-то удалено, когда удалено ничего.
 */
import { useMemo, useState } from "react";
import { Button, ModalDialog } from "@universityrt/ui-kit";
import { Search } from "lucide-react";
import {
  REPORT_PAGE_BLOCK,
  REPORT_PAGE_BREAK_BLOCK,
  REPORT_SYSTEM_BLOCKS,
} from "@shared/report/report-blocks";
import type { DraftBlock } from "../use-report-document";
import type { ReportBlockVariantOption } from "./report-document-list";

/** Одна опция палитры: строка списка плюс всё, из чего собирается будущий блок. */
interface PaletteOption {
  /** Ключ строки; он же хвост `data-testid`. */
  id: string;
  group: string;
  label: string;
  description: string;
  block: string;
  templateKey: string | null;
}

/** Группы в порядке эскиза: сперва то, что автор добавляет чаще всего. */
const GROUP_PAGES = "Страницы";
const GROUP_SERVICE = "Служебное";
const GROUP_REMOVED = "Удалённые из документа";

export interface ReportBlockPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Выбранный блок. Позицию вставки знает вызывающий — палитра о ней не спрашивает. */
  onPick: (block: DraftBlock) => void;
  /** Варианты блоков активного шаблона; палитре нужны только вида `page`. */
  variants: ReportBlockVariantOption[];
  /** Ключи блоков, которые уже стоят в документе. */
  documentBlocks: string[];
}

export function ReportBlockPalette(props: ReportBlockPaletteProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const options = useMemo<PaletteOption[]>(() => {
    const present = new Set(props.documentBlocks);
    const pages = props.variants
      .filter((v) => v.block === REPORT_PAGE_BLOCK)
      .map((v) => ({
        id: v.key,
        group: GROUP_PAGES,
        label: v.label ?? v.key,
        // Описание берётся у САМОГО варианта: одна строка на все страницы не говорила,
        // чем они отличаются, а выбирают их именно по этому.
        description: v.description ?? "Авторская страница документа.",
        block: REPORT_PAGE_BLOCK,
        templateKey: v.key,
      }));
    const service: PaletteOption[] = [
      {
        id: REPORT_PAGE_BREAK_BLOCK,
        group: GROUP_SERVICE,
        label: "Разрыв листа",
        description: "Следующий блок печатается с новой страницы",
        block: REPORT_PAGE_BREAK_BLOCK,
        templateKey: null,
      },
    ];
    // Страница и разрыв повторяются сколько угодно, системный блок — нет: два «Результата
    // по темам» в одном документе означали бы, что одни и те же данные напечатаны дважды.
    const removed = REPORT_SYSTEM_BLOCKS.filter((b) => !present.has(b.key)).map((b) => ({
      id: b.key,
      group: GROUP_REMOVED,
      label: b.label,
      description: "Убран из документа — вернётся на прежнее место",
      block: b.key,
      templateKey: null,
    }));
    return [...pages, ...service, ...removed];
  }, [props.variants, props.documentBlocks]);

  const needle = query.trim().toLowerCase();
  const shown = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;

  const pick = () => {
    const option = shown.find((o) => o.id === selected);
    if (!option) return;
    props.onPick({
      block: option.block,
      templateKey: option.templateKey,
      // Блок, который автор только что выбрал руками, приходит ВКЛЮЧЁННЫМ: он его затем и
      // добавлял. Выключенными приходят только блоки, дописанные шаблоном (§5.1).
      enabled: true,
      values: {},
      settings: {},
    });
    setSelected(null);
    setQuery("");
    props.onClose();
  };

  /** Строки одной группы; пустая группа не рисуется вместе со своим заголовком. */
  const group = (title: string) => {
    const items = shown.filter((o) => o.group === title);
    if (!items.length) return null;
    return (
      <>
        <li className="variant-group" role="presentation">
          {title}
        </li>
        {items.map((o) => (
          <li
            key={o.id}
            className={"variant-list__item" + (selected === o.id ? " is-selected" : "")}
            role="option"
            aria-selected={selected === o.id ? "true" : "false"}
            tabIndex={0}
            onClick={() => setSelected(o.id)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setSelected(o.id);
              }
            }}
            data-testid={`report-palette-option-${o.id}`}
          >
            <div>
              <div className="variant-list__name">{o.label}</div>
              <div className="variant-list__desc">{o.description}</div>
            </div>
          </li>
        ))}
      </>
    );
  };

  return (
    <ModalDialog
      open={props.open}
      onClose={props.onClose}
      size="m"
      title="Добавить блок"
      description="Блок встанет в документ на место, откуда вы его добавляете."
      footer={
        <>
          <Button variant="ghost" size="m" onClick={props.onClose} data-testid="report-palette-cancel">
            Отмена
          </Button>
          <Button
            variant="primary"
            size="m"
            disabled={!selected}
            onClick={pick}
            data-testid="report-palette-add"
          >
            Добавить
          </Button>
        </>
      }
    >
      <div className="variant-search">
        <Search className="variant-search__icon" size={16} aria-hidden="true" />
        <input
          className="variant-search__input"
          type="search"
          placeholder="Поиск блока…"
          aria-label="Поиск блока"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          data-testid="report-palette-search"
        />
      </div>
      {shown.length ? (
        <ul className="variant-list" role="listbox" aria-label="Блоки документа">
          {group(GROUP_PAGES)}
          {group(GROUP_SERVICE)}
          {group(GROUP_REMOVED)}
        </ul>
      ) : (
        <div className="variant-picker__empty" data-testid="report-palette-empty">
          Ничего не нашлось
        </div>
      )}
    </ModalDialog>
  );
}
