/**
 * @module features/tests/editor/sections/level-feedback-card
 * @description Э2.5: карточка «По уровням» вкладки «Обратная связь и итоги» — тексты
 * адаптивных уровней и текст темы, у которой не подтверждён ни один уровень.
 *
 * Раньше они правились ВНУТРИ лестницы уровней, между порогом и числом вопросов: автор,
 * искавший «где написать, что сказать слушателю», находил их последними, а сама лестница
 * из структуры превращалась в смесь структуры с содержанием. Теперь лестница отвечает
 * только за структуру, а тексты живут там же, где все прочие тексты теста.
 *
 * Список строится ПО СТРУКТУРЕ лестницы: тема -> её уровни в порядке возрастания. Своего
 * хранения у карточки нет — она правит те же поля (`adaptive.topics[].failureFeedback`,
 * `levels[].feedback`, `levels[].links`), что правила лестница.
 */
import type * as React from "react";
import { Banner, Card, CardBody, CardHeader, FormSection } from "@universityrt/ui-kit";
import type {
  AdaptiveLevelConfig,
  AdaptiveLinkConfig,
  TestEditorModel,
} from "../test-editor.types";
import { FeedbackEditTrigger } from "./basic-settings-section";

export type LevelFeedbackCardProps = {
  model: TestEditorModel;
  updateModel: (updater: (m: TestEditorModel) => TestEditorModel) => void;
};

/**
 * Карточка «По уровням»: показывается только адаптивному тесту — у стандартного лестницы
 * нет, и пустая карточка сообщала бы о настройке, которой у него не бывает.
 */
export function LevelFeedbackCard({
  model,
  updateModel,
}: LevelFeedbackCardProps): React.JSX.Element | null {
  if (model.mode !== "adaptive") return null;

  const enabled = model.sections
    .map((section) => model.adaptive.topics.find((t) => t.topicId === section.topicId))
    .filter((topic): topic is NonNullable<typeof topic> => Boolean(topic?.enabled));

  const patchTopic = (
    topicId: string,
    patch: (topic: (typeof enabled)[number]) => (typeof enabled)[number],
  ) =>
    updateModel((m) => ({
      ...m,
      adaptive: {
        ...m.adaptive,
        topics: m.adaptive.topics.map((t) => (t.topicId === topicId ? patch(t) : t)),
      },
    }));

  const patchLevel = (topicId: string, levelIndex: number, patch: Partial<AdaptiveLevelConfig>) =>
    patchTopic(topicId, (topic) => ({
      ...topic,
      levels: topic.levels.map((l) => (l.levelIndex === levelIndex ? { ...l, ...patch } : l)),
    }));

  return (
    <Card variant="outlined" size="sm" data-testid="level-feedback-card">
      <CardHeader
        title="По уровням"
        subtitle="Текст уровня участник читает, подтвердив этот уровень; текст темы — когда не подтверждён ни один."
      />
      <CardBody>
        {enabled.length === 0 ? (
          <Banner
            tone="info"
            title="Ни одна тема не включена в адаптивный режим"
            description="Включите темы и задайте им уровни во вкладке «Состав и сценарий», подраздел «Адаптивные уровни» — после этого здесь появятся их тексты."
            data-testid="level-feedback-no-topics"
          />
        ) : (
          enabled.map((topic) => (
            <FormSection key={topic.topicId} title={topic.topicName} stacked>
              <div className="ou-formfield">
                <FeedbackEditTrigger
                  label="Обратная связь при не пройденном уровне"
                  buttonAriaLabel={`Редактировать обратную связь темы ${topic.topicName}`}
                  modalTitle={`Обратная связь по теме «${topic.topicName}»`}
                  modalDescription="Показывается обучающемуся, если он не прошёл ни один уровень темы."
                  text={topic.failureFeedback ?? ""}
                  links={[]}
                  hideAssets
                  onSave={({ text }) =>
                    patchTopic(topic.topicId, (t) => ({
                      ...t,
                      failureFeedback: text === "" ? null : text,
                    }))
                  }
                  testId={`adaptive-topic-failure-${topic.topicId}`}
                />
              </div>
              {topic.levels.map((level) => (
                <div className="ou-formfield" key={level.levelIndex}>
                  <FeedbackEditTrigger
                    label={`Уровень «${level.levelName}»`}
                    buttonAriaLabel={`Редактировать обратную связь уровня ${level.levelName}`}
                    modalTitle={`Обратная связь уровня «${level.levelName}»`}
                    modalDescription="Показывается обучающемуся при достижении этого уровня сложности."
                    text={level.feedback ?? ""}
                    links={level.links}
                    hideAssets
                    onSave={({ text, links }: { text: string; links: AdaptiveLinkConfig[] }) =>
                      patchLevel(topic.topicId, level.levelIndex, {
                        feedback: text === "" ? null : text,
                        links,
                      })
                    }
                    testId={`adaptive-level-${topic.topicId}-${level.levelIndex}-feedback`}
                  />
                </div>
              ))}
            </FormSection>
          ))
        )}
      </CardBody>
    </Card>
  );
}
