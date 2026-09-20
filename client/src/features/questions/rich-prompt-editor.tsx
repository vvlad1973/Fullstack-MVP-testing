/**
 * @module features/questions/rich-prompt-editor
 *
 * Визуальный ввод текста задания — режим «Форматированный» (PRD-57 §4.3, FR-09b).
 *
 * `contenteditable` + `execCommand`, тем же приёмом, каким в продукте уже сделан редактор
 * обратной связи: внешней библиотеки RTE здесь нет и не заводится. Панель — жирный, курсив,
 * список, ссылка; кнопки вставки механик стоят снаружи, общие с остальными режимами.
 *
 * Механики живут в поле АТОМАРНЫМИ узлами ({@link module:shared/text/rich-atoms}): курсор
 * внутрь не попадает, форматирование их не рвёт, удаление уносит узел целиком. Это гарантия
 * по построению — ровно то, чего требует FR-09b.
 *
 * Разметка поля НЕ перепривязывается на каждый набранный символ: `innerHTML` ставится один
 * раз при открытии и при внешней замене текста (переключение режима, вставка кнопкой), а
 * дальше поле живёт само и сообщает наружу результат. Перепривязка на каждый ввод уводила
 * бы курсор в начало строки — тем же способом, которым это уже было починено в редакторе
 * обратной связи.
 */
import { useEffect, useRef } from "react";
import { Bold, Italic, Link as LinkIcon, List } from "lucide-react";
import { Cluster, IconButton, Label, Stack } from "@skillum/ui-kit";
import { toAtoms, fromAtoms } from "@shared/text/rich-atoms";

export interface RichPromptEditorProps {
  label: string;
  /** Текст задания разметкой — таким, каким он хранится. */
  value: string;
  /** Новый текст разметкой; атомы уже развёрнуты. */
  onChange: (next: string) => void;
  /** Внешний ключ перепривязки: меняется, когда текст заменили не набором. */
  syncKey?: string | number;
  "data-testid"?: string;
}

/**
 * Поле визуального ввода.
 *
 * @param props Подпись, текст, обработчик и ключ перепривязки.
 */
export function RichPromptEditor(props: RichPromptEditorProps) {
  const areaRef = useRef<HTMLDivElement | null>(null);

  // Разметка ставится ОДИН раз на открытие и на внешнюю замену текста: иначе каждый
  // набранный символ перерисовывал бы поле и уводил курсор в начало.
  useEffect(() => {
    const area = areaRef.current;
    if (!area) return;
    area.innerHTML = toAtoms(props.value ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.syncKey]);

  const emit = () => {
    const area = areaRef.current;
    if (area) props.onChange(fromAtoms(area.innerHTML));
  };

  /** Выполнить команду форматирования над выделением. */
  const run = (command: string, value?: string) => {
    areaRef.current?.focus();
    // `execCommand` объявлен устаревшим, но остаётся единственным способом форматировать
    // `contenteditable` без внешней библиотеки — тот же выбор, что у редактора обратной связи.
    document.execCommand(command, false, value);
    emit();
  };

  const addLink = () => {
    const url = window.prompt("Адрес ссылки");
    if (!url) return;
    run("createLink", url);
  };

  return (
    <Stack gap={2}>
      <Label>{props.label}</Label>
      <Cluster gap={1} wrap data-testid="rich-prompt-toolbar">
        <IconButton
          aria-label="Жирный"
          variant="ghost"
          size="s"
          icon={<Bold size={16} aria-hidden="true" />}
          onClick={() => run("bold")}
          data-testid="rich-bold"
        />
        <IconButton
          aria-label="Курсив"
          variant="ghost"
          size="s"
          icon={<Italic size={16} aria-hidden="true" />}
          onClick={() => run("italic")}
          data-testid="rich-italic"
        />
        <IconButton
          aria-label="Список"
          variant="ghost"
          size="s"
          icon={<List size={16} aria-hidden="true" />}
          onClick={() => run("insertUnorderedList")}
          data-testid="rich-list"
        />
        <IconButton
          aria-label="Ссылка"
          variant="ghost"
          size="s"
          icon={<LinkIcon size={16} aria-hidden="true" />}
          onClick={addLink}
          data-testid="rich-link"
        />
      </Cluster>
      <div
        ref={areaRef}
        className="tb-rich-area"
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={props.label}
        onInput={emit}
        onBlur={emit}
        data-testid={props["data-testid"] ?? "input-question-prompt-rich"}
      />
    </Stack>
  );
}
