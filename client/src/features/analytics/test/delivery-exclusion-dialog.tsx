/**
 * @module features/analytics/test/delivery-exclusion-dialog
 * @description PRD-56 FR-17a, FR-17b: окно подтверждения «Исключить вопрос из выдачи?».
 *
 * Одно окно на две таблицы — «Вопросы» и «Качество вопросов». Исключают вопрос из обеих, и два
 * окна с разными словами и разной проверкой последствий разошлись бы при первой же правке.
 *
 * Окно называет последствия числами, и спрашивает их у сервера при открытии: считать остаток
 * пула на клиенте значило бы завести вторую копию правил выдачи. Невыполнимая выдача ЗАПРЕЩАЕТ
 * действие, а не сопровождает его предупреждением: тест, который нельзя собрать, ломается у
 * участника на старте попытки.
 */
import { useEffect, useState } from "react";

import { Button, ModalDialog, Stack, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

/** Почему выдачу собрать нельзя — находка проверки выполнимости. */
interface DeliveryIssue {
  kind: string;
  tag?: string;
  requested?: number;
  available?: number;
  required?: number;
}

/** Последствия исключения — то, что отдаёт `GET .../delivery-impact` (FR-17b). */
interface DeliveryImpact {
  topicName: string;
  remaining: number;
  drawCount: number;
  allowed: boolean;
  findings?: Array<{ topicName: string; issues: DeliveryIssue[] }>;
}

/** Вопрос, который собираются исключить. */
export interface ExclusionTarget {
  questionId: string;
  /** Текст вопроса — описание окна: автор должен видеть, ЧТО он исключает. */
  prompt: string;
}

export interface DeliveryExclusionDialogProps {
  /** Вопрос, для которого открыто окно; `null` — окно закрыто. */
  target: ExclusionTarget | null;
  /** Тест, у которого спрашиваются последствия исключения. */
  testId?: string;
  onClose: () => void;
  /** Исключение подтверждено. */
  onConfirm: (questionId: string) => void;
}

/**
 * Причина отказа словами.
 *
 * «Выдачу собрать нельзя» без причины оставляет автора гадать, что чинить: не хватает вопросов
 * вообще или проседает квота одного тега — это разные починки.
 */
function issueText(issue: DeliveryIssue): string {
  if (issue.kind === "quota_shortfall") {
    return `Подтема «${issue.tag}»: нужно ${issue.requested}, останется ${issue.available}`;
  }
  if (issue.kind === "pool_shortfall") {
    return `Вопросов в теме: нужно ${issue.required}, останется ${issue.available}`;
  }
  return "Выдача этого раздела перестанет собираться";
}

/**
 * Окно подтверждения исключения вопроса из выдачи.
 *
 * @param props вопрос, тест и обработчики
 * @returns модальное окно дизайн-системы
 */
export function DeliveryExclusionDialog({ target, testId, onClose, onConfirm }: DeliveryExclusionDialogProps) {
  const [impact, setImpact] = useState<DeliveryImpact | null>(null);

  // Последствия спрашиваются у сервера при открытии окна: считать остаток пула на клиенте
  // значило бы завести вторую копию правил выдачи, которая однажды разойдётся с первой.
  useEffect(() => {
    if (!target) {
      setImpact(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(
          `/api/analytics/tests/${testId}/questions/${target.questionId}/delivery-impact`,
          { credentials: "include" },
        );
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as DeliveryImpact;
        if (alive) setImpact(data);
      } catch {
        // Вслепую окно подтверждения не спрашивает: без последствий кнопка остаётся
        // выключенной, а читателю сказано, что считаем.
        if (alive) setImpact(null);
      }
    })();
    return () => { alive = false; };
  }, [target, testId]);

  return (
    <ModalDialog
      open={target !== null}
      onClose={onClose}
      size="s"
      title="Исключить вопрос из выдачи?"
      description={target?.prompt}
      footer={
        <>
          <Button variant="ghost" size="m" onClick={onClose}>Отмена</Button>
          <Button
            variant="primary"
            size="m"
            disabled={!impact?.allowed}
            onClick={() => {
              if (target) onConfirm(target.questionId);
              onClose();
            }}
          >
            Исключить
          </Button>
        </>
      }
    >
      <Stack gap={3}>
        {impact === null ? (
          <Text tone="muted">Считаем, сколько вопросов останется в теме…</Text>
        ) : (
          <>
            <Text>
              В теме «{impact.topicName}» останется {impact.remaining} {pluralize(impact.remaining, "вопрос", "вопроса", "вопросов")}, а выдавать
              нужно {impact.drawCount}.
            </Text>
            {!impact.allowed && (
              <Stack gap={1}>
                <Text tone="error">Выдачу собрать будет нельзя:</Text>
                {(impact.findings ?? []).flatMap(finding => finding.issues).map((issue, index) => (
                  <Text key={index} variant="body-s" tone="error">{issueText(issue)}</Text>
                ))}
                <Text variant="body-s" tone="muted">
                  Уменьшите число выдаваемых вопросов или добавьте новые в тему.
                </Text>
              </Stack>
            )}
          </>
        )}
        <Text variant="body-s" tone="muted">
          Опубликованная версия не меняется: пока тест не опубликован заново, и веб, и
          выгруженный пакет SCORM продолжают выдавать этот вопрос по снимку.
        </Text>
      </Stack>
    </ModalDialog>
  );
}
