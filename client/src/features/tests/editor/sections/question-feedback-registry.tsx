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
import { useMemo, useState } from "react";
import type * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Banner, Button, Card, CardBody, CardHeader, Tag } from "@universityrt/ui-kit";
import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { t } from "@/lib/i18n";
import type { Question } from "@shared/schema";
import type { TestEditorModel } from "../test-editor.types";

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
  const [openTopics, setOpenTopics] = useState<Set<string>>(new Set());

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

  const toggle = (topicId: string) =>
    setOpenTopics((prev) => {
      const next = new Set(prev);
      if (next.has(topicId)) next.delete(topicId);
      else next.add(topicId);
      return next;
    });

  return (
    <Card variant="outlined" size="sm" data-testid="question-feedback-registry">
      <CardHeader
        title="По вопросам"
        subtitle="Только чтение: обратная связь принадлежит вопросу и правится в его редакторе — тот же вопрос стоит и в других тестах."
        trail={
          <>
            <Button
              variant="ghost"
              size="s"
              onClick={() => setOpenTopics(new Set(model.sections.map((s) => s.topicId)))}
              data-testid="question-feedback-expand-all"
            >
              Развернуть все
            </Button>
            <Button
              variant="ghost"
              size="s"
              onClick={() => setOpenTopics(new Set())}
              data-testid="question-feedback-collapse-all"
            >
              Свернуть все
            </Button>
          </>
        }
      />
      <CardBody>
        {model.sections.map((section) => {
          const list = byTopic.get(section.topicId) ?? [];
          const withText = list.filter(hasFeedback).length;
          const open = openTopics.has(section.topicId);
          return (
            <div className="tb-qfeedback__topic" key={section.topicId}>
              <button
                type="button"
                className="tb-qfeedback__trigger"
                aria-expanded={open ? "true" : "false"}
                onClick={() => toggle(section.topicId)}
                data-testid={`question-feedback-topic-${section.topicId}`}
              >
                {open ? (
                  <ChevronDown size={16} aria-hidden="true" />
                ) : (
                  <ChevronRight size={16} aria-hidden="true" />
                )}
                <span className="tb-qfeedback__name">{section.topicName}</span>
                <span className="tb-qfeedback__count">
                  {`вопросов ${list.length} · с обратной связью ${withText}`}
                </span>
              </button>
              {open && (
                <div className="tb-qfeedback__body">
                  {list.length === 0 ? (
                    <div className="tb-card-desc">В теме нет вопросов.</div>
                  ) : (
                    list.map((q) => (
                      <div className="tb-qfeedback__row" key={q.id}>
                        <div className="tb-qfeedback__q">
                          <div className="tb-qfeedback__q-text">{q.prompt || "Без формулировки"}</div>
                          {/* Э5.8: режим называется ровно так же, как в карточке вопроса —
                              из одного словаря, чтобы реестр не завёл своих синонимов. */}
                          <Tag size="s" variant="soft">
                            {q.feedbackMode === "conditional"
                              ? t.questions.feedbackModeConditional
                              : t.questions.feedbackModeGeneral}
                          </Tag>
                        </div>
                        <div className="tb-qfeedback__texts">
                          {q.feedbackMode === "conditional" ? (
                            <>
                              <FeedbackLine label="Верно" text={q.feedbackCorrect} />
                              <FeedbackLine label="Неверно" text={q.feedbackIncorrect} />
                            </>
                          ) : (
                            <FeedbackLine label="Текст" text={q.feedback} />
                          )}
                        </div>
                        {onOpenQuestion && (
                          <Button
                            variant="ghost"
                            size="s"
                            leadingIcon={<Pencil size={14} aria-hidden="true" />}
                            onClick={() => onOpenQuestion(q.id)}
                            data-testid={`question-feedback-open-${q.id}`}
                          >
                            Открыть вопрос
                          </Button>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardBody>
    </Card>
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
