/**
 * @module client/features/analytics/question-metrics
 * @description PRD-55 (FR-31, FR-31a, FR-32): правый блок карточки задания в аналитике теста —
 * доля верных ответов, экспозиция и медиана времени, одна под другой подписями.
 *
 * Величины стоят рядом, потому что читаются парой: «трудное и заезженное» и «трудное, но свежее»
 * требуют разных действий, а быстрый ответ на трудное задание указывает на утечку ключа.
 *
 * Вынесено из `pages/author/test-analytics.tsx` отдельным компонентом, чтобы поведение пустых
 * значений можно было проверить тестом, не поднимая страницу целиком: именно оно тут и есть
 * содержательная часть — «данных нет» и «ноль» обязаны выглядеть по-разному.
 */
import { Cluster, Stack, Text } from "@skillum/ui-kit";

/** Тон величины: тот же, что у существующей доли верных ответов. */
type Tone = "success" | "warning" | "error" | "muted";

export interface QuestionMetricsProps {
  /** Доля верных ответов, 0..100. */
  correctPercent: number;
  /** Тон доли верных — решает вызывающий, правило у него уже есть. */
  correctTone: Tone;
  /** Верных ответов из общего числа. */
  correctAnswers: number;
  totalAnswers: number;
  /** Доля попыток теста, в которых задание выдавалось; `null` = счётчик пуст. */
  exposurePercent: number | null;
  /** Сколько раз задание выдавалось в этом тесте. */
  exposureCount: number;
  /** Показы задания во ВСЕХ тестах — показывается только вместе с тегом «ещё в N тестах». */
  globalExposureCount: number;
  /** В скольких других тестах задание выдавалось. */
  otherTestsCount: number;
  /** Медиана времени на задание, мс; `null` = не измерялось ни разу. */
  latencyMedianMs: number | null;
  /** Объём выборки времени — СВОЙ, меньше числа ответов: веб времени не измеряет. */
  latencySampleSize: number;
  /** Число попыток теста за окно — знаменатель доли выдачи. */
  attemptsInWindow: number;
}

/** Доля выработки банка, с которой экспозиция перестаёт быть спокойной величиной. */
const EXPOSURE_WARN_PERCENT = 70;

/** «1:24» из миллисекунд. Секунды всегда двузначные, иначе колонка прыгает. */
export function formatDuration(ms: number): string {
    const totalSeconds = Math.round(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** Одна величина: число сверху, подписи под ним. */
function Metric({ value, tone, captions }: { value: string; tone: Tone; captions: string[] }) {
    return (
        <Stack gap={1} align="end">
            <Text variant="heading-s" weight="bold" tone={tone}>{value}</Text>
            {captions.map((c) => (
                <Text key={c} variant="body-xs" tone="muted">{c}</Text>
            ))}
        </Stack>
    );
}

export function QuestionMetrics(props: QuestionMetricsProps) {
    const {
        correctPercent, correctTone, correctAnswers, totalAnswers,
        exposurePercent, exposureCount, globalExposureCount, otherTestsCount,
        latencyMedianMs, latencySampleSize, attemptsInWindow,
    } = props;

    // Прочерк, а не ноль: «счётчик пуст» и «не выдавалось ни разу» — разные утверждения, и ноль
    // на экране склеил бы их в одно.
    const exposureKnown = exposurePercent !== null;
    const exposureTone: Tone =
        exposureKnown && exposurePercent >= EXPOSURE_WARN_PERCENT ? "warning" : "muted";

    return (
        <Cluster gap={6} align="start">
            <Metric
                value={`${correctPercent.toFixed(0)}%`}
                tone={correctTone}
                captions={[`${correctAnswers}/${totalAnswers} верно`]}
            />
            <Metric
                value={exposureKnown ? `${exposurePercent.toFixed(0)}%` : "—"}
                tone={exposureTone}
                captions={
                    exposureKnown
                        ? [
                            `выдано ${exposureCount} из ${attemptsInWindow}`,
                            // Число показов по всем тестам показывается только там, где оно
                            // объясняет расхождение: именно его, а не долю, берёт вес выдачи.
                            ...(otherTestsCount > 0 ? [`всего ${globalExposureCount} показов`] : []),
                        ]
                        : ["показы не учтены"]
                }
            />
            <Metric
                value={latencyMedianMs !== null ? formatDuration(latencyMedianMs) : "—"}
                tone="muted"
                captions={
                    latencyMedianMs !== null
                        ? ["медиана времени", `по ${latencySampleSize} ответам`]
                        : ["время не измерялось"]
                }
            />
        </Cluster>
    );
}
