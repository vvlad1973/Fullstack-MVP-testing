/**
 * @module features/tests/editor/sections/__tests__/profile-template.test
 * @description PRD-53 acceptance for the «Профиль по группе шкал» template in the
 * «Показатели» tab: the group form, the matrix generator, the form-level diagnostics
 * and the «scales outside the profile» block.
 *
 * The card renders its form only when expanded, so every case opens it first.
 * Источник разметки — docs/wireframes/approved/prd53-profile-indicator.html.
 */

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { ResultVariablesSection } from "../result-variables-section";
import { emptyEditorModel } from "../../test-editor.mappers";
import type {
  OutcomeModel,
  ResultVariableModel,
  ScaleModel,
  TestEditorModel,
} from "../../test-editor.types";

const GROUP = 'topGroup(["cel","vdo","kom","pro"], 5).code';

function scale(key: string, label: string, sortOrder: number): ScaleModel {
  return {
    clientKey: `s-${key}`,
    key,
    label,
    type: "number",
    aggregation: "sum",
    normalization: "none",
    direction: "positive",
    bands: [],
    domainMin: null,
    domainMax: null,
    displayMax: null,
    valence: "none",
    learnerVisibility: "hidden",
    scormTarget: "none",
    sortOrder,
  };
}

function variable(over: Partial<ResultVariableModel> = {}): ResultVariableModel {
  return {
    clientKey: "v1",
    name: "lead_style",
    label: "Описание ваших результатов",
    type: "string",
    formula: GROUP,
    learnerVisibility: "hidden",
    scormTarget: "both",
    controlsStatus: "none",
    bands: [],
    outcomes: [],
    domainMin: null,
    domainMax: null,
    valence: "none",
    sortOrder: 0,
    ...over,
  };
}

function outcome(code: string, label = code): OutcomeModel {
  return { code, label, text: "", tone: "" };
}

function model(over: Partial<ResultVariableModel> = {}, keys = ["cel", "vdo", "kom", "pro"]): TestEditorModel {
  return {
    ...emptyEditorModel({ folderId: null }),
    scales: keys.map((k, i) => scale(k, k.toUpperCase(), i)),
    resultVariables: [variable(over)],
  };
}

function Harness({ initial, seen }: { initial: TestEditorModel; seen: TestEditorModel[] }) {
  const [m, setM] = useState(initial);
  seen[0] = m;
  return (
    <ResultVariablesSection
      model={m}
      updateModel={(updater) =>
        setM((prev) => {
          const next = updater(prev);
          seen[0] = next;
          return next;
        })
      }
    />
  );
}

function renderExpanded(initial: TestEditorModel): TestEditorModel[] {
  const seen: TestEditorModel[] = [];
  render(<Harness initial={initial} seen={seen} />);
  fireEvent.click(screen.getByLabelText("Развернуть показатель"));
  return seen;
}

const outcomesOf = (seen: TestEditorModel[]) => seen[0].resultVariables[0].outcomes;

describe("генератор матрицы наборов (PRD-53 §5.2)", () => {
  it("«Собрать наборы» заводит пятнадцать исходов для четырёх шкал", () => {
    const seen = renderExpanded(model());
    fireEvent.click(screen.getByTestId("metrics-profile-build-0"));
    expect(outcomesOf(seen)).toHaveLength(15);
    expect(outcomesOf(seen)[0]).toMatchObject({ code: "cel", label: "Сфокусированный: CEL" });
  });

  // Правило PRD-53 §5.2: генератор ДОБАВЛЯЕТ недостающее и не трогает заполненное.
  it("повторное нажатие ничего не затирает и не удваивает", () => {
    const seen = renderExpanded(model({ outcomes: [{ ...outcome("cel", "Мой текст"), text: "Толкование" }] }));
    fireEvent.click(screen.getByTestId("metrics-profile-build-0"));
    fireEvent.click(screen.getByTestId("metrics-profile-build-0"));
    const rows = outcomesOf(seen);
    expect(rows).toHaveLength(15);
    expect(rows[0]).toMatchObject({ code: "cel", label: "Мой текст", text: "Толкование" });
  });

  // Сопоставление по НАБОРУ: иначе генератор завёл бы дубль cel+pro, который никогда
  // не сработает — в списке первым стоял бы авторский pro+cel.
  it("исход, набранный в другом порядке, считается заведённым", () => {
    const seen = renderExpanded(model({ outcomes: [outcome("pro+cel")] }));
    fireEvent.click(screen.getByTestId("metrics-profile-build-0"));
    expect(outcomesOf(seen).filter((o) => o.code === "cel+pro")).toHaveLength(0);
  });

  it("«Заготовки по размеру набора» заводят четыре исхода count:N", () => {
    const seen = renderExpanded(model());
    fireEvent.click(screen.getByTestId("metrics-profile-build-counts-0"));
    expect(outcomesOf(seen).map((o) => o.code)).toEqual(["count:1", "count:2", "count:3", "count:4"]);
  });
});

describe("диагностика формы (PRD-53 §5.3.2)", () => {
  it("непокрытые наборы перечислены, с «и ещё N» после пятого", () => {
    renderExpanded(model({ outcomes: [outcome("cel")] }));
    const banner = screen.getByTestId("metrics-profile-uncovered-0");
    expect(banner).toHaveTextContent("Не для всех наборов есть текст");
    expect(banner).toHaveTextContent("и ещё 9");
  });

  // Подавление на пустом перечне: автор ещё не начал заполнять.
  it("на пустом перечне исходов предупреждения нет", () => {
    renderExpanded(model());
    expect(screen.queryByTestId("metrics-profile-uncovered-0")).toBeNull();
  });

  it("заготовки по размеру набора закрывают все наборы", () => {
    renderExpanded(model({ outcomes: ["count:1", "count:2", "count:3", "count:4"].map((c) => outcome(c)) }));
    expect(screen.queryByTestId("metrics-profile-uncovered-0")).toBeNull();
  });

  it("при пяти шкалах подсказывает число наборов", () => {
    const keys = ["cel", "vdo", "kom", "pro", "cli"];
    renderExpanded(model({ formula: 'topGroup(["cel","vdo","kom","pro","cli"], 5).code' }, keys));
    expect(screen.getByTestId("metrics-profile-many-0")).toHaveTextContent("31");
  });
});

describe("блок «шкалы вне профиля» (PRD-53 §4.4)", () => {
  it("тумблер пишет ключи группы из формулы", () => {
    const seen = renderExpanded(model());
    fireEvent.click(screen.getByTestId("metrics-rest-show-0"));
    expect(seen[0].resultVariables[0].restScales).toEqual({
      show: true,
      label: "",
      keys: ["cel", "vdo", "kom", "pro"],
    });
  });

  it("заголовок блока виден только при включённом тумблере", () => {
    renderExpanded(model());
    expect(screen.queryByTestId("metrics-rest-label-0")).toBeNull();
    fireEvent.click(screen.getByTestId("metrics-rest-show-0"));
    expect(screen.getByTestId("metrics-rest-label-0")).toBeInTheDocument();
  });

  it("у показателя без профиля блока нет", () => {
    renderExpanded(model({ formula: '"growing"' }));
    expect(screen.queryByTestId("metrics-rest-show-0")).toBeNull();
  });
});

describe("форма шаблона (PRD-53 §5.1)", () => {
  it("показатель-профиль открывается на своём шаблоне, а не на «Пороге»", () => {
    renderExpanded(model());
    expect(screen.getByTestId("metrics-profile-group")).toBeInTheDocument();
    expect(screen.getByTestId("metrics-profile-threshold")).toHaveValue("5");
  });

  it("шкалы группы отмечены тумблерами, лишние выключены", () => {
    renderExpanded(model({ formula: 'topGroup(["cel","vdo"], 0).code' }));
    expect(screen.getByTestId("metrics-profile-scale-cel")).toBeChecked();
    expect(screen.getByTestId("metrics-profile-scale-pro")).not.toBeChecked();
  });

  // FR-33: иначе автор видит ошибку про ключ и не может его снять.
  it("удалённая из теста шкала группы остаётся видимой строкой", () => {
    renderExpanded(model({ formula: 'topGroup(["cel","vdo","eng"], 5).code' }));
    expect(screen.getByTestId("metrics-profile-missing-eng")).toBeInTheDocument();
  });

  it("снятие шкал до одной даёт ошибку у поля", () => {
    renderExpanded(model({ formula: 'topGroup(["cel","vdo"], 5).code' }));
    fireEvent.click(screen.getByTestId("metrics-profile-scale-vdo"));
    expect(screen.getByTestId("metrics-profile-group-error")).toHaveTextContent("хотя бы две шкалы");
  });

  it("отрицательный порог помечается ошибкой у поля", () => {
    renderExpanded(model());
    fireEvent.change(screen.getByTestId("metrics-profile-threshold"), { target: { value: "-1" } });
    expect(screen.getByText("Порог верхней зоны — неотрицательное число")).toBeInTheDocument();
  });

  it("правка группы переписывает формулу в авторском порядке шкал", () => {
    const seen = renderExpanded(model({ formula: 'topGroup(["vdo"], 5).code' }));
    fireEvent.click(screen.getByTestId("metrics-profile-scale-cel"));
    expect(seen[0].resultVariables[0].formula).toBe('topGroup(["cel","vdo"], 5).code');
  });
});
