/**
 * @module features/tests/editor/sections/question-feedback-registry
 * @description Э2.4: реестр «По вопросам» подраздела «Во время теста».
 *
 * Обратная связь ВОПРОСА принадлежит вопросу, а не тесту: её правит редактор вопроса, и
 * один и тот же вопрос стоит в нескольких тестах. Поэтому реестр — ТОЛЬКО ЧТЕНИЕ: он
 * отвечает на вопрос «что уже написано у вопросов этого теста» и уводит правку туда, где
 * она хранится. Без него автор не мог узнать этого нигде: приходилось открывать вопросы по
 * одному в другом разделе продукта.
 *
 * Дерево свёрнуто до тем: у теста бывает десяток тем по десятку вопросов, и раскрытый
 * список сразу — это простыня, в которой ничего не найти.
 */
import { useMemo } from "react";
import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Accordion, AccordionItem, Banner, Button, FormSection } from "@universityrt/ui-kit";
import { ArrowRight } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Question } from "@shared/schema";
import type { TestEditorModel } from "../test-editor.types";
import { FoldAllButtons, useSectionFold } from "./section-fold";

/**
 * Строка вопроса в том виде, в каком её отдаёт `/api/questions`.
 *
 * Поля ВЫБИРАЮТСЯ из схемы, а не переписываются здесь руками: собственный список имён
 * однажды уже разошёлся с маршрутом — реестр читал `text`, которого в ответе нет, и каждая
 * строка печатала «Без формулировки». Компилятор промолчал (поле было необязательным), и
 * компонентный тест тоже: у него была своя фикстура, названная так же неверно. `Pick`
 * ставит расхождение на учёт компилятора.
 */
type QuestionRow = Pick<
  Question,
  "id" | "topicId" | "prompt" | "feedbackMode" | "feedback" | "feedbackCorrect" | "feedbackIncorrect"
>;

export type QuestionFeedbackRegistryProps = {
  model: TestEditorModel;
  /**
   * Открыть редактор вопроса. Необязателен: реестр собирают и там, где ящика вопроса нет
   * (компонентные тесты), — тогда строка просто не предлагает перехода.
   */
  onOpenQuestion?: (questionId: string) => void;
};

/** Есть ли у вопроса написанная обратная связь — в том режиме, который у него выбран. */
function hasFeedback(q: QuestionRow): boolean {
  if (q.feedbackMode === "conditional") {
    return Boolean((q.feedbackCorrect ?? "").trim() || (q.feedbackIncorrect ?? "").trim());
  }
  return Boolean((q.feedback ?? "").trim());
}

/**
 * Реестр обратной связи вопросов теста: тема -> её вопросы -> что у них написано.
 */
export function QuestionFeedbackRegistry({
  model,
  onOpenQuestion,
}: QuestionFeedbackRegistryProps): React.JSX.Element {
  const { data: questions = [] } = useQuery<QuestionRow[]>({ queryKey: ["/api/questions"] });
  const byTopic = useMemo(() => {
    const map = new Map<string, QuestionRow[]>();
    for (const q of questions) {
      if (!q || typeof q.topicId !== "string") continue;
      const list = map.get(q.topicId);
      if (list) list.push(q);
      else map.set(q.topicId, [q]);
    }
    return map;
  }, [questions]);
  const sectionIds = useMemo(() => model.sections.map((s) => s.topicId), [model.sections]);
  // Свёртка — общая с остальными реестрами редактора: один хук, одна пара кнопок, одна
  // разметка `tb-fold-actions`. Своя копия здесь однажды уже разошлась с эскизом по иконкам.
  const fold = useSectionFold(sectionIds, true);
  const openIds = sectionIds.filter((id) => fold.isOpen(id));

  if (model.sections.length === 0) {
    return (
      <Banner
        tone="info"
        title="Сначала добавьте темы"
        description="Реестр показывает вопросы тем этого теста. Добавьте темы во вкладке «Состав и сценарий»."
        data-testid="question-feedback-no-topics"
      />
    );
  }

  return (
    <FormSection
      stacked
      title="Обратная связь вопросов"
      meta={<FoldAllButtons fold={fold} testIdPrefix="question-feedback" />}
      data-testid="question-feedback-registry"
    >
      <Accordion
        variant="separated"
        type="multiple"
        value={openIds}
        onChange={(next) => {
          // Аккордеон отдаёт НОВЫЙ список раскрытых, а свёртка хранит свёрнутые: сводим их
          // через `toggle` по расхождению, чтобы у состояния остался один владелец — хук.
          const opened = new Set(Array.isArray(next) ? next : [next]);
          for (const id of sectionIds) {
            if (opened.has(id) !== fold.isOpen(id)) fold.toggle(id);
          }
        }}
      >
        {model.sections.map((section, index) => {
          const list = byTopic.get(section.topicId) ?? [];
          const withText = list.filter(hasFeedback).length;
          return (
            <AccordionItem
              key={section.topicId}
              value={section.topicId}
              // Номер темы — её место в выдаче: эскиз подписывает темы «1. О компании».
              title={`${index + 1}. ${section.topicName}`}
              subtitle={`${list.length} вопросов · у ${withText} задана обратная связь`}
              data-testid={`question-feedback-topic-${section.topicId}`}
            >
              {list.length === 0 ? (
                <div className="tb-card-desc">В теме нет вопросов.</div>
              ) : (
                <table className="tb-table tb-table--mb" aria-label={`Обратная связь вопросов темы «${section.topicName}»`}>
                  <thead>
                    <tr>
                      <th>Вопрос</th>
                      <th>Режим</th>
                      <th>Текст</th>
                      <th aria-label="Действия" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((q) => (
                      <tr key={q.id}>
                        <td>{q.prompt || "Без формулировки"}</td>
                        {/* Э5.8: режим называется ровно так же, как в карточке вопроса —
                            из одного словаря, чтобы реестр не завёл своих синонимов. */}
                        <td>
                          {q.feedbackMode === "conditional"
                            ? t.questions.feedbackModeConditional
                            : t.questions.feedbackModeGeneral}
                        </td>
                        <td>
                          {q.feedbackMode === "conditional" ? (
                            <>
                              <FeedbackLine label="Верно" text={q.feedbackCorrect} />
                              <FeedbackLine label="Неверно" text={q.feedbackIncorrect} />
                            </>
                          ) : (
                            <FeedbackLine label="Текст" text={q.feedback} />
                          )}
                        </td>
                        <td>
                          {onOpenQuestion && (
                            <Button
                              variant="ghost"
                              size="s"
                              trailingIcon={<ArrowRight width={14} height={14} aria-hidden="true" />}
                              onClick={() => onOpenQuestion(q.id)}
                              data-testid={`question-feedback-open-${q.id}`}
                            >
                              К вопросу
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </AccordionItem>
          );
        })}
      </Accordion>
    </FormSection>
  );
}

/** Одна строка текста: подпись и написанное, либо честное «не задано». */
function FeedbackLine(props: { label: string; text?: string | null }): React.JSX.Element {
  const text = (props.text ?? "").trim();
  return (
    <div className="tb-qfeedback__line">
      <span className="tb-qfeedback__line-lbl">{props.label}</span>
      <span className={text ? "tb-qfeedback__line-text" : "tb-qfeedback__line-text is-empty"}>
        {text || "не задано"}
      </span>
    </div>
  );
}
