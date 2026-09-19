/**
 * @module features/questions/answer-rules/answer-rules-block
 *
 * The «Проверка ответа» block of the question drawer (PRD-57 §6.1), shown instead of the
 * option list for a typed answer. Layout follows the approved wireframe
 * `docs/wireframes/approved/prd57-answer-rule.html` (state `k-list`) one element at a
 * time; the editing rules live in {@link module:features/questions/answer-rules/answer-rules-model}.
 *
 * It lives in its own file rather than inside `question-editor-drawer`: that file is
 * already past 1200 lines, and the rule set is the one part of a typed answer that grows
 * with every stage of the track (the probe in Э6, the expression panel in Э7).
 *
 * Not here yet, on purpose: the answer probe (Э6) and the regular-expression mode
 * (Э7, which cannot ship before its runtime budget). The mode switch IS drawn, disabled,
 * with the reason spelled out — hiding it would tell the author expressions do not exist.
 */
import { Accordion, AccordionItem, Button, Input, SegmentedControl, Select, Switch, Tag } from "@skillum/ui-kit";
import { Plus, Trash2 } from "lucide-react";

import type { AnswerRuleSet, NumericRule, TextRule } from "@shared/answer-check";
import {
  addRule,
  createDraft,
  removeRule,
  setAutoCheck,
  setJoin,
  setUnit,
  switchKind,
  toCorrectJson,
  updateRule,
  type AnswerRulesDraft,
} from "./answer-rules-model";

export interface AnswerRulesBlockProps {
  /** Current draft; the drawer owns it so a type switch does not reset the editing state. */
  draft: AnswerRulesDraft;
  onChange: (draft: AnswerRulesDraft) => void;
}

/** Summary line of a collapsed rule — «что правило проверяет» (FR-28b). */
function ruleTitle(rule: TextRule | NumericRule): string {
  if (rule.kind === "number") {
    const tolerance = rule.tolerance
      ? ` ±${rule.tolerance.value}${rule.tolerance.unit === "pct" ? " %" : ""}`
      : "";
    return `равно ${rule.value}${tolerance}`;
  }
  return rule.value.trim() === "" ? "Правило не заполнено" : rule.value;
}

/** Subtitle of a collapsed rule — HOW it compares. */
function ruleSubtitle(rule: TextRule | NumericRule): string {
  if (rule.kind === "number") return "Число с допуском";
  return rule.match === "regex" ? "Регулярное выражение" : "Обычное сравнение";
}

export function AnswerRulesBlock({ draft, onChange }: AnswerRulesBlockProps) {
  const rules = (draft.answerKind === "number" ? draft.number : draft.text) as Array<TextRule | NumericRule>;
  const saved: AnswerRuleSet = toCorrectJson(draft);

  return (
    <div className="tb-rules" data-testid="answer-rules-block">
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Проверка ответа</span>
        <Switch
          size="m"
          checked={draft.autoCheck}
          onChange={(e) => onChange(setAutoCheck(draft, e.target.checked))}
          label="Проверять ответ автоматически"
          description="Без правил задание собирает короткий текст и не приносит баллов"
          data-testid="answer-rules-autocheck"
        />
      </div>

      {draft.autoCheck ? (
        <>
          <div className="ou-formfield">
            <span className="ou-formfield__lbl">Ответ участника — это</span>
            <SegmentedControl<"text" | "number">
              size="s"
              value={draft.answerKind}
              aria-label="Что проверяем"
              items={[
                { value: "text", label: "Текст" },
                { value: "number", label: "Число" },
              ]}
              onChange={(value) => onChange(switchKind(draft, value))}
            />
            <span className="ou-formfield__desc">
              {draft.answerKind === "number"
                ? "Участник вводит число, поэтому правила сравнивают величины."
                : "Участник вводит текст, поэтому правила сравнивают слова."}
            </span>
          </div>

          <div className="ou-formfield">
            <span className="ou-formfield__lbl">Ответ засчитывается, если выполнено</span>
            <SegmentedControl<"any" | "all">
              size="s"
              value={draft.join}
              aria-label="Как объединять правила"
              items={[
                { value: "any", label: "Любое правило" },
                { value: "all", label: "Все правила" },
              ]}
              onChange={(value) => onChange(setJoin(draft, value))}
            />
          </div>

          {draft.answerKind === "number" ? (
            <div className="ou-formfield">
              <span className="ou-formfield__lbl">Единица измерения</span>
              <Input
                size="m"
                value={draft.unit}
                onChange={(e) => onChange(setUnit(draft, e.target.value))}
                data-testid="answer-rules-unit"
              />
              <span className="ou-formfield__desc">
                Подпись у поля ответа. Участник вводит только число, единицу не печатает.
              </span>
            </div>
          ) : null}

          <div className="ou-formfield">
            <span className="ou-formfield__lbl">Правила</span>
            {rules.length === 0 ? (
              <span className="ou-formfield__desc">
                Правил пока нет. Пока их нет, задание собирает ответы и не приносит баллов.
              </span>
            ) : (
              <Accordion variant="bordered" type="multiple">
                {rules.map((rule, index) => (
                  <AccordionItem
                    key={index}
                    value={`rule-${index}`}
                    title={ruleTitle(rule)}
                    subtitle={ruleSubtitle(rule)}
                  >
                    {rule.kind === "text" ? (
                      <TextRuleFields
                        rule={rule}
                        onPatch={(patch) => onChange(updateRule(draft, index, patch))}
                      />
                    ) : (
                      <NumberRuleFields
                        rule={rule}
                        onPatch={(patch) => onChange(updateRule(draft, index, patch))}
                      />
                    )}
                    <Button
                      variant="ghost"
                      size="s"
                      leadingIcon={<Trash2 width={14} height={14} aria-hidden="true" />}
                      onClick={() => onChange(removeRule(draft, index))}
                      data-testid={`answer-rules-remove-${index}`}
                    >
                      Удалить правило
                    </Button>
                  </AccordionItem>
                ))}
              </Accordion>
            )}
            <Button
              variant="ghost"
              size="s"
              leadingIcon={<Plus width={14} height={14} aria-hidden="true" />}
              onClick={() => onChange(addRule(draft))}
              data-testid="answer-rules-add"
            >
              Добавить правило
            </Button>
          </div>

          {saved.rules.length > 1 ? (
            <Tag tone="neutral" size="s">
              {draft.join === "all" ? "Выполнены должны быть все правила" : "Достаточно одного правила"}
            </Tag>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** Fields of ONE textual rule (wireframe: «Как сравнивать» + «Ответ»). */
function TextRuleFields({ rule, onPatch }: { rule: TextRule; onPatch: (patch: Partial<TextRule>) => void }) {
  return (
    <>
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Как сравнивать</span>
        <SegmentedControl<"wildcard" | "regex">
          size="s"
          value={rule.match}
          aria-label="Как сравнивать"
          items={[
            { value: "wildcard", label: "Обычный" },
            // Э7: режим появляется вместе с бюджетом времени, без которого выражение
            // участника способно занять проверку надолго (FR-28q). Кнопка показана
            // запертой: спрятать её значит сказать автору, что выражений не будет вовсе.
            { value: "regex", label: "Регулярное выражение", disabled: true },
          ]}
          onChange={(value) => onPatch({ match: value })}
        />
        <span className="ou-formfield__desc">
          Регулярные выражения появятся позже. Сейчас доступно обычное сравнение.
        </span>
      </div>
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Ответ</span>
        <Input
          size="m"
          value={rule.value}
          onChange={(e) => onPatch({ value: e.target.value })}
          data-testid="answer-rules-text-value"
        />
        <span className="ou-formfield__desc">
          Звёздочка заменяет любое продолжение, знак вопроса — один любой символ.
          Регистр, лишние пробелы, «ё» и вид кавычек значения не имеют.
        </span>
      </div>
    </>
  );
}

/** Fields of ONE numeric rule (wireframe: «Условие» + «Допуск»). */
function NumberRuleFields({ rule, onPatch }: { rule: NumericRule; onPatch: (patch: Partial<NumericRule>) => void }) {
  const tolerance = rule.tolerance ?? { unit: "abs" as const, value: 0 };
  return (
    <>
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Условие</span>
        <div className="ou-formgroup ou-formgroup--two">
          <Select
            size="m"
            value="eq"
            aria-label="Как сравнивать"
            // Прочие операторы — Э5. Один пункт показан, чтобы поле не выглядело
            // сломанным, и подписан, чтобы автор не искал остальные.
            options={[{ value: "eq", label: "равно" }]}
            onChange={() => {}}
            disabled
          />
          <Input
            size="m"
            value={String(rule.value)}
            onChange={(e) => onPatch({ value: Number(e.target.value.replace(",", ".")) })}
            data-testid="answer-rules-number-value"
          />
        </div>
        <span className="ou-formfield__desc">
          Можно вводить отрицательные значения и десятичные дроби: -25, 0,75.
        </span>
      </div>
      <div className="ou-formfield">
        <span className="ou-formfield__lbl">Допуск</span>
        <div className="ou-formgroup ou-formgroup--two">
          <Input
            size="m"
            value={String(tolerance.value)}
            onChange={(e) =>
              onPatch({ tolerance: { ...tolerance, value: Number(e.target.value.replace(",", ".")) } })
            }
            data-testid="answer-rules-tolerance-value"
          />
          <Select<"abs" | "pct">
            size="m"
            value={tolerance.unit}
            aria-label="Мера допуска"
            options={[
              { value: "abs", label: "в единицах" },
              { value: "pct", label: "в процентах" },
            ]}
            onChange={(unit) => onPatch({ tolerance: { ...tolerance, unit } })}
          />
        </div>
      </div>
    </>
  );
}

export { createDraft, toCorrectJson };
export type { AnswerRulesDraft };
