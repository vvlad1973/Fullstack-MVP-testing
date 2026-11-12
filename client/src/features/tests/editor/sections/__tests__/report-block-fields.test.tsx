// @vitest-environment jsdom
/**
 * @module features/tests/editor/sections/__tests__/report-block-fields
 *
 * PRD-51, задача 5 плана Э3 — ПОЛЯ РАСКРЫТОЙ СТРОКИ страницы документа (FR-17, FR-05).
 *
 * Проверяется, что состав формы диктует ВАРИАНТ, правка уходит в значения именно этой
 * строки, а вариант без полей объясняется словами, а не пустой формой.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import { ReportBlockFields } from "../report-block-fields";
import type { DraftBlock } from "../../use-report-document";

const block: DraftBlock = {
  block: "page",
  templateKey: "v.page.text",
  enabled: true,
  values: { title: "О тесте" },
  settings: {},
};

const placeholders = [
  { key: "title", type: "text", label: "Заголовок", required: true },
  { key: "body", type: "textarea", label: "Текст" },
];

afterEach(cleanup);

describe("поля блока-страницы", () => {
  it("показывает поля варианта с их значениями", () => {
    render(
      <ReportBlockFields
        index={3}
        block={block}
        placeholders={placeholders as never}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByDisplayValue("О тесте")).toBeInTheDocument();
    expect(screen.getByTestId("report-document-field-3-body")).toBeInTheDocument();
  });

  it("правка уходит в значения ЭТОЙ строки, не задевая остальных полей", () => {
    const onChange = vi.fn();
    render(
      <ReportBlockFields index={0} block={block} placeholders={placeholders as never} onChange={onChange} />,
    );
    fireEvent.change(screen.getByDisplayValue("О тесте"), { target: { value: "Как читать отчёт" } });
    const next = onChange.mock.calls[0][0] as DraftBlock;
    expect(next.values.title).toBe("Как читать отчёт");
    expect(next.templateKey).toBe("v.page.text");
  });

  it("вариант без полей объясняется словами, а не пустой формой", () => {
    render(<ReportBlockFields index={1} block={block} placeholders={[]} onChange={vi.fn()} />);
    expect(screen.getByTestId("report-document-edit-empty-1")).toBeInTheDocument();
    expect(screen.queryByTestId("report-document-edit-fields-1")).toBeNull();
  });

  it("опубликованный тест поля не правит", () => {
    render(
      <ReportBlockFields
        index={0}
        block={block}
        placeholders={placeholders as never}
        onChange={vi.fn()}
        readOnly
      />,
    );
    expect(screen.getByTestId("report-document-edit-fields-0")).toBeDisabled();
  });
});

describe("содержимое блока по исходу", () => {
  const rec: DraftBlock = {
    block: "recommendations",
    templateKey: null,
    enabled: true,
    values: { title: "Рекомендации", lead: "<p>Общее слово</p>" },
    settings: {},
    outcome: null,
  };
  const fields = [
    { key: "title", type: "text", label: "Заголовок блока" },
    { key: "lead", type: "html", label: "Подводка" },
  ];

  it("s-common: переключатель выключен, показаны только общие поля", () => {
    render(<ReportBlockFields index={4} block={rec} placeholders={fields as never} onChange={vi.fn()} />);
    expect(screen.getByTestId("report-block-outcome-switch-4")).not.toBeChecked();
    expect(screen.queryByTestId("report-block-outcome-group-4-passed")).toBeNull();
    expect(screen.getByTestId("report-document-field-4-lead")).toHaveTextContent("Общее слово");
  });

  it("включение показывает три группы и само ничего не записывает", () => {
    const onChange = vi.fn();
    render(<ReportBlockFields index={4} block={rec} placeholders={fields as never} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("report-block-outcome-switch-4"));
    expect(screen.getByTestId("report-block-outcome-group-4-any")).toBeInTheDocument();
    expect(screen.getByTestId("report-block-outcome-group-4-passed")).toBeInTheDocument();
    expect(screen.getByTestId("report-block-outcome-group-4-failed")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("короткое поле исхода показывает общее подсказкой и пишет в свою ветвь", () => {
    const onChange = vi.fn();
    render(<ReportBlockFields index={4} block={rec} placeholders={fields as never} onChange={onChange} />);
    fireEvent.click(screen.getByTestId("report-block-outcome-switch-4"));
    const input = screen.getByTestId("report-field-4-failed-title") as HTMLInputElement;
    expect(input.placeholder).toBe("Рекомендации");
    fireEvent.change(input, { target: { value: "Над чем поработать" } });
    const next = onChange.mock.calls[0][0] as DraftBlock;
    expect(next.outcome).toEqual({ failed: { values: { title: "Над чем поработать" } } });
    expect(next.values.title).toBe("Рекомендации");
  });

  it("сброс снимает значение исхода", () => {
    const onChange = vi.fn();
    render(
      <ReportBlockFields
        index={4}
        block={{ ...rec, outcome: { failed: { values: { title: "Над чем поработать" } } } }}
        placeholders={fields as never}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByTestId("report-field-4-failed-title-reset"));
    expect((onChange.mock.calls[0][0] as DraftBlock).outcome).toEqual({});
  });

  it("под длинным текстом исхода — подпись о дописывании", () => {
    render(
      <ReportBlockFields
        index={4}
        block={{ ...rec, outcome: { passed: { values: { lead: "<p>Так держать</p>" } } } }}
        placeholders={fields as never}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Печатается после текста «При любом исходе».")).toHaveLength(2);
    expect(screen.getByTestId("report-document-field-4-passed-lead")).toHaveTextContent("Так держать");
  });

  it("s-outcome-off: выключение с заданными значениями спрашивает и пишет пустой объект", () => {
    const onChange = vi.fn();
    render(
      <ReportBlockFields
        index={4}
        block={{ ...rec, outcome: { failed: { values: { title: "Над чем поработать" } } } }}
        placeholders={fields as never}
        onChange={onChange}
        blockTitle="Рекомендации"
      />,
    );
    fireEvent.click(screen.getByTestId("report-block-outcome-switch-4"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("Убрать содержимое по исходу?")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("report-block-outcome-off-confirm-4"));
    expect((onChange.mock.calls[0][0] as DraftBlock).outcome).toEqual({});
  });

  it("умолчания шаблона действуют, пока автор не распорядился", () => {
    render(
      <ReportBlockFields
        index={4}
        block={rec}
        placeholders={fields as never}
        outcomeDefaults={{ failed: { values: { title: "Над чем поработать" } } }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("report-block-outcome-switch-4")).toBeChecked();
    expect((screen.getByTestId("report-field-4-failed-title") as HTMLInputElement).value).toBe("Над чем поработать");
  });

  it("s-no-verdict: переключатель недоступен и объясняет почему", () => {
    render(
      <ReportBlockFields index={4} block={rec} placeholders={fields as never} onChange={vi.fn()} verdictPossible={false} />,
    );
    expect(screen.getByTestId("report-block-outcome-switch-4")).toBeDisabled();
    expect(screen.getByText(/У теста нет порога прохождения/)).toBeInTheDocument();
    expect(screen.queryByTestId("report-block-outcome-group-4-passed")).toBeNull();
  });
});

