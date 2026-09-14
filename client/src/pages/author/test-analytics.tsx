/**
 * @module pages/author/test-analytics
 * @description Per-test analytics dashboard: summary KPIs, score-distribution and
 * trend charts, per-topic / per-question / per-level statistics, an attempts table
 * and a full attempt-details modal. Rendered entirely with the Skillum design
 * system — layout via Stack/Cluster/Grid/Box, typography via Text, data via the DS
 * Table/Card/Tabs/ProgressBar/Tag primitives (no raw utility classes). recharts
 * charts use `--ou-*` tokens for colours.
 */
import { useState } from "react";
import { QuestionMetrics } from "@/features/analytics/question-metrics";
import { PassTrend } from "@/features/analytics/test/pass-trend";
import { ScoreDistribution } from "@/features/analytics/test/score-distribution";
import { QuestionTable } from "@/features/analytics/test/question-table";
import { TopicBreakdown } from "@/features/analytics/test/topic-breakdown";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import {
    Box,
    Button,
    Card,
    CardBody,
    CardHeader,
    Cluster,
    EmptyState,
    Grid,
    IconButton,
    ModalDialog,
    ProgressBar,
    Stack,
    Table,
    Tabs,
    Tag,
    Text,
    type ProgressTone,
    type TableColumn,
    type Tone,
} from "@skillum/ui-kit";
import { LoadingState } from "@/components/loading-state";
import { LmsImportForm } from "@/features/analytics/lms-import/lms-import-form";
import {
    ArrowLeft,
    Users,
    Target,
    Clock,
    TrendingUp,
    CheckCircle,
    XCircle,
    BarChart3,
    FileText,
    HelpCircle,
    Layers,
    FileSpreadsheet,
    Gauge,
    Upload,
} from "lucide-react";
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    BarChart,
    Bar,
} from "recharts";

// Types
interface TestAnalytics {
    testId: string;
    testTitle: string;
    testMode: "standard" | "adaptive";
    /** Does the test declare an overall pass threshold at all (PRD-29 §6.7)? */
    hasPassThreshold: boolean;
    summary: {
        totalAttempts: number;
        completedAttempts: number;
        /** Of the completed runs, how many had points to grade / a verdict to pronounce. */
        gradedAttempts: number;
        judgedAttempts: number;
        uniqueUsers: number;
        /**
         * `null` = «неприменимо», not «ноль»: a measurement questionnaire grades nothing,
         * so it has no average result and no pass rate (PRD-29 §6.7). Rendering a zero
         * here is what used to headline «Средний балл 0.0%» beside «Прохождение 100.0%».
         */
        avgPercent: number | null;
        avgDuration: number | null;
        passRate: number | null;
        avgScore: number | null;
        maxScore: number;
    };
    /** PRD-56 FR-14a: у каждой доли своя единица счёта — прохождения против ответов. */
    topicStats: Array<{
        topicId: string;
        topicName: string;
        passedShare: number | null;
        correctShare: number | null;
        thresholdPercent: number | null;
        inSample: number;
        subtopics: Array<{
            name: string;
            passedShare: number | null;
            correctShare: number | null;
            thresholdPercent: number | null;
            inSample: number;
        }>;
    }>;
    /** PRD-55 (FR-31): попытки за окно наблюдения, считая брошенные, — знаменатель доли выдачи. */
    exposureAttempts?: number;
    /** PRD-56 FR-13a: проходной балл в процентах; `null` — тест не оценивает или порог в баллах. */
    thresholdPercent: number | null;
    questionStats: Array<{
        questionId: string;
        questionPrompt: string;
        questionType: string;
        topicId: string;
        topicName: string;
        difficulty: number;
        totalAnswers: number;
        correctAnswers: number;
        /** `null` — оценивать было нечего: у измерительного вопроса эталона нет. */
        correctPercent: number | null;
        /** Сколько ответов оценивалось: знаменатель доли верных. */
        gradedAnswers: number;
        /** PRD-56 FR-15: доля пропусков; `null` — состав выдачи по попытке неизвестен. */
        skipShare: number | null;
        deliveredWeb?: number;
        skippedWeb?: number;
        /** PRD-56 FR-16: признаки, по которым задание попало в вид «требуют ревизии». */
        reviewFlags: Array<{ kind: string; reason: string }>;
        /** PRD-56 FR-17a: задание исключено из выдачи этого теста. */
        excludedFromDelivery?: boolean;
        // PRD-55 (FR-31/FR-31a/FR-32). Необязательные: ответ старой сборки сервера этих полей
        // не несёт, и карточка тогда показывает прочерки вместо выдуманных нулей.
        exposureCount?: number;
        exposurePercent: number | null;
        globalExposureCount?: number;
        otherTestsCount?: number;
        latencyMedianMs: number | null;
        latencySampleSize: number;
    }>;
    levelStats?: Array<{
        levelIndex: number;
        levelName: string;
        topicId: string;
        topicName: string;
        achievedCount: number;
        attemptedCount: number;
        passedCount: number;
        failedCount: number;
        avgCorrectPercent: number;
    }>;
    /** PRD-56 FR-13a: корзины одной ширины с цветом от проходного балла. */
    scoreDistribution: Array<{
        label: string;
        from: number;
        to: number;
        count: number;
        share: number;
        tone: "error" | "warning" | "success" | "neutral";
        holdsThreshold: boolean;
    }>;
    /** PRD-56 FR-13: динамика сдаваемости по месяцам. */
    passTrend: Array<{
        key: string;
        label: string;
        attempts: number;
        judged: number;
        passRate: number | null;
    }>;
}

interface AttemptListItem {
    attemptId: string;
    userId: string;
    username: string;
    startedAt: string | null;
    finishedAt: string | null;
    duration: number | null;
    overallPercent: number;
    earnedPoints: number;
    possiblePoints: number;
    passed: boolean;
    completed: boolean;
    /**
     * PRD-29 §6.7. `scored` — were there points to speak of; `verdictPronounced` — was
     * «Сдан / Не сдан» pronounced at all. A questionnaire run answers false to both, and
     * `passed` then carries the stored default that nobody decided.
     *
     * Optional, and ABSENT means «unknown», which shows rather than hides (the flags
     * only ever silence — see `hasPronouncedVerdict`). So a response from a server that
     * predates them renders exactly as it always did instead of blanking every row.
     */
    scored?: boolean;
    verdictPronounced?: boolean;
    achievedLevels?: Array<{
        topicName: string;
        levelName: string | null;
    }>;
}

interface AttemptDetail {
    attemptId: string;
    userId: string;
    username: string;
    testId: string;
    testTitle: string;
    testMode: string;
    startedAt: string | null;
    finishedAt: string | null;
    duration: number | null;
    overallPercent: number;
    earnedPoints: number;
    possiblePoints: number;
    passed: boolean;
    /** PRD-29 §6.7 — see {@link AttemptListItem}. Absent = unknown = show. */
    scored?: boolean;
    verdictPronounced?: boolean;
    /** How much of what was delivered the learner answered. */
    questionCount?: number;
    answeredCount?: number;
    /** PRD-5/PRD-2: what the test measures, and what to call it. */
    measures?: {
        scales: Array<{ key: string; label: string; hasLevels: boolean }>;
        indicators: Array<{ name: string; label: string }>;
    };
    /** The run's scale values, as stored at finish (keyed by scale key). */
    scaleResults?: Record<string, { raw: number; label?: string; level?: string } | undefined>;
    /** The run's indicators, already resolved to «значение + что оно значит». */
    indicatorViews?: Array<{
        name: string;
        label: string;
        value: string | number | boolean | null;
        interpretation: string | null;
    }>;
    answers: Array<{
        questionId: string;
        questionPrompt: string;
        questionType: string;
        topicId: string;
        topicName: string;
        userAnswer: unknown;
        correctAnswer: unknown;
        /**
         * The RUNTIME encoding of the same answers — option indices, not labels.
         * Only these carry the ordinal («4) Скорее важно»), and for a scale question
         * the graduation index IS the answer.
         */
        userAnswerRaw?: unknown;
        correctAnswerRaw?: unknown;
        isCorrect: boolean;
        /** 0..1 — a graded answer may be PARTIALLY right (PRD-10). */
        ratio?: number;
        /** PRD-26/PRD-44: never checked — no tick, no points, only its contribution. */
        measurementOnly?: boolean;
        /** PRD-5: how this answer moved each scale. */
        contribs?: Array<{ scaleKey: string; delta: number }>;
        earnedPoints: number;
        possiblePoints: number;
        difficulty: number;
        levelName?: string;
        levelIndex?: number;
    }>;
    topicResults: Array<{
        topicId: string;
        topicName: string;
        correct?: number;
        total?: number;
        percent?: number;
        achievedLevelName?: string;
    }>;
    trajectory?: Array<{
        action: string;
        topicName?: string;
        levelName?: string;
        message?: string;
    }>;
    achievedLevels?: Array<{
        topicId: string;
        topicName: string;
        levelIndex: number | null;
        levelName: string | null;
    }>;
}

/**
 * A percent metric that may not apply at all (PRD-29 §6.7): a measurement test grades
 * nothing, so its average result and pass rate are `null` — «неприменимо», not «ноль».
 * The dash is the same answer `formatDuration` has always given for a missing duration.
 */
function formatPercent(percent: number | null): string {
    return percent === null ? "—" : `${percent.toFixed(1)}%`;
}

function formatDuration(seconds: number | null): string {
    if (seconds === null) return "—";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleString("ru-RU", {
        day: "numeric",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

/** Map a 0–100 correctness percent to a semantic tone. */
function percentTone(percent: number): "success" | "warning" | "error" {
    return percent >= 70 ? "success" : percent >= 50 ? "warning" : "error";
}

/** Map a 0–100 correctness percent to a ProgressBar tone. */
function percentProgressTone(percent: number): ProgressTone {
    return percent >= 70 ? "success" : percent >= 50 ? "warning" : "error";
}

const chartTooltipStyle = { backgroundColor: "var(--ou-bg-elevated)", border: "1px solid var(--ou-border-soft)" };

/**
 * Маркеры многострочного ответа. `Stack` гасит списочные маркеры вместе с остальным
 * сбросом, а у распределения и сопоставления строки переносятся: без маркера соседние
 * утверждения сливаются в один абзац и ответ перестаёт читаться.
 */
const listStyle: React.CSSProperties = { listStyle: "disc", paddingInlineStart: "var(--ou-space-4)" };

/** Печатное значение показателя: код и число печатаются как есть, пустое — прочерком. */
function formatIndicatorValue(value: string | number | boolean | null): string {
    if (value === null || value === undefined || value === "") return "—";
    if (typeof value === "boolean") return value ? "Да" : "Нет";
    return String(value);
}

/**
 * Ответ ученика в печатном виде.
 *
 * The server hands over BOTH forms: the labels a person reads and the raw option
 * indices. Only the raw form carries the ordinal, and for a scale question the
 * graduation index IS the answer — «4) Скорее важно» says which end of the scale was
 * chosen, «Скорее важно» alone does not.
 *
 * @param value Formatted answer (label, list of labels, pairs, or statement/points).
 * @param raw The same answer in runtime encoding, when the type has one.
 */
function renderAnswerValue(value: unknown, raw?: unknown): React.ReactNode {
    if (value === null || value === undefined || value === "") {
        return <Text variant="body-s" tone="muted">(нет ответа)</Text>;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return <Text variant="body-s" tone="muted">(ничего не выбрано)</Text>;
        }

        // PRD-44: распределение — «утверждение — балл» по КАЖДОМУ утверждению, включая
        // нулевые: ноль отличает «рассмотрел и не дал веса» от «не дошёл».
        if (typeof value[0] === "object" && value[0] !== null && "statement" in (value[0] as object)) {
            const items = value as Array<{ statement: string; points: number }>;
            return (
                <Stack as="ul" gap={0} style={listStyle}>
                    {items.map((item, i) => (
                        <Text as="li" key={i} variant="body-s">
                            {item.statement} — {item.points > 0
                                ? <Text as="span" weight="bold">{item.points}</Text>
                                : <Text as="span" tone="muted">0</Text>}
                        </Text>
                    ))}
                </Stack>
            );
        }

        // Сопоставление: пары «слева → справа».
        if (typeof value[0] === "object" && value[0] !== null && "left" in (value[0] as object)) {
            const pairs = value as Array<{ left: string; right: string }>;
            return (
                <Stack as="ul" gap={0} style={listStyle}>
                    {pairs.map((pair, i) => (
                        <Text as="li" key={i} variant="body-s">{pair.left} → {pair.right}</Text>
                    ))}
                </Stack>
            );
        }

        const labels = value.map((v) => String(v));
        const indices = Array.isArray(raw) && raw.length === labels.length && raw.every((n) => typeof n === "number")
            ? (raw as number[])
            : null;
        return (
            <Text variant="body-s">
                {labels.map((label, i) => (indices ? `${indices[i] + 1}) ${label}` : label)).join(", ")}
            </Text>
        );
    }

    if (typeof value === "object") {
        return <Text variant="body-s">{JSON.stringify(value)}</Text>;
    }

    return (
        <Text variant="body-s">
            {typeof raw === "number" ? `${raw + 1}) ${String(value)}` : String(value)}
        </Text>
    );
}

/** Эталон в печатном виде: тот же рендер, но порядковые номера берутся из ключа. */
function renderReferenceValue(value: unknown, raw?: unknown): React.ReactNode {
    const key = (raw ?? {}) as { correctIndex?: unknown; correctIndices?: unknown; correctOrder?: unknown };
    if (typeof key.correctIndex === "number") return renderAnswerValue(value, key.correctIndex);
    if (Array.isArray(key.correctIndices)) return renderAnswerValue(value, key.correctIndices);
    if (Array.isArray(key.correctOrder)) return renderAnswerValue(value, key.correctOrder);
    return renderAnswerValue(value);
}

/** Строка «подпись — значение» под текстом вопроса (Ответ / Эталон / Вклад). */
function AnswerRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <Cluster gap={2} align="start" wrap={false}>
            <Box style={{ minWidth: "4.5rem" }}>
                <Text variant="body-xs" tone="muted">{label}</Text>
            </Box>
            <Box grow>{children}</Box>
        </Cluster>
    );
}


export default function TestAnalyticsPage() {
    const [, params] = useRoute("/author/tests/:testId/analytics");
    const testId = params?.testId;

    const [activeTab, setActiveTab] = useState("overview");
    /** PRD-54: окно загрузки выгрузки отчёта LMS. Тест здесь задан страницей. */
    const [lmsImportOpen, setLmsImportOpen] = useState(false);
    const queryClient = useQueryClient();

    const { data: analytics, isLoading: analyticsLoading } = useQuery<TestAnalytics>({
        queryKey: [`/api/analytics/tests/${testId}`],
        enabled: !!testId,
    });

    // Функция экспорта в Excel
    const handleExportExcel = () => {
        window.open(`/api/analytics/tests/${testId}/export/excel`, "_blank");
    };

    if (analyticsLoading) {
        return <LoadingState message="Загрузка аналитики..." />;
    }

    if (!analytics) {
        return (
            <EmptyState
                art={<HelpCircle size={48} color="var(--ou-fg-subtle)" />}
                title="Не удалось загрузить аналитику"
                actions={
                    <Link href="/author/tests">
                        <Button variant="secondary" leadingIcon={<ArrowLeft size={16} />}>
                            Назад к тестам
                        </Button>
                    </Link>
                }
            />
        );
    }

    const { summary, topicStats, questionStats, levelStats, scoreDistribution, passTrend } = analytics;

    /**
     * Проходной балл в процентах — подпись гистограммы и место её вертикали.
     *
     * Приходит числом с сервера. Выводить его из раскраски корзин (как было до приёмки Э4)
     * можно лишь при пороге, кратном их ширине: при 75 % такой вывод давал «порог 70 %» и
     * ставил вертикаль на границу столбиков вместо её настоящего места.
     */
    const thresholdPercent = analytics.thresholdPercent ?? null;

    const overviewPanel = (
        <Stack gap={5}>
            {/*
              PRD-56 FR-13, FR-13a, FR-14: три блока обзора, и каждый отвечает на свой вопрос —
              как результаты легли относительно порога, где тяжёлые темы и что меняется со
              временем. Считает их сервер по ВСЕМ источникам (FR-25), экран только показывает.
            */}
            <ScoreDistribution
                buckets={scoreDistribution}
                completed={summary.completedAttempts}
                thresholdPercent={thresholdPercent}
            />
            <TopicBreakdown topics={topicStats} />
            <PassTrend points={passTrend} />
        </Stack>
    );

    const questionsPanel = (
        /*
          PRD-56 FR-15 - FR-17: одна таблица вместо карточек. Карточки не сравнивались между
          собой — а разбор задания начинается со сравнения: где доля верных ниже, где чаще
          выдаётся, где отвечают подозрительно быстро.
        */
        <QuestionTable
            questions={questionStats}
            testId={testId ?? undefined}
            onDeliveryChange={async (questionId, excluded) => {
                // FR-17a: состояние меняется там же, где видно. Отказ сервера (выдачу собрать
                // нельзя) показывается как есть: он и есть ответ на вопрос «почему нельзя».
                const response = await fetch(
                    `/api/analytics/tests/${testId}/questions/${questionId}/delivery`,
                    {
                        method: "PUT",
                        credentials: "include",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ excluded }),
                    },
                );
                if (!response.ok) {
                    const data = await response.json().catch(() => ({})) as { error?: string };
                    alert(data.error ?? "Не удалось изменить состояние задания");
                    return;
                }
                await queryClient.invalidateQueries({ queryKey: [`/api/analytics/tests/${testId}`] });
            }}
            onOpenRegistry={questionId => {
                // FR-17: переход в реестр к прохождениям, где на задании ошиблись. Условия
                // отбора живут в адресе реестра (FR-03), поэтому это обычная ссылка.
                window.location.href = `/author/analytics?testId=${testId}&outcome=failed&questionId=${questionId}`;
            }}
        />
    );

    const levelsPanel = (
        <Card>
            <CardHeader lead={<Layers size={20} />} title="Статистика по уровням" />
            <CardBody>
                {levelStats && levelStats.length > 0 ? (
                    <Stack gap={4}>
                        {/* Group by topic */}
                        {Array.from(new Set(levelStats.map((l) => l.topicId))).map((topicId) => {
                            const topicLevels = levelStats.filter((l) => l.topicId === topicId);
                            const topicName = topicLevels[0]?.topicName || "Unknown";

                            return (
                                <Box key={topicId} pad={4} surface="muted" radius="l">
                                    <Stack gap={3}>
                                        <Text as="h4" variant="heading-s" weight="medium">{topicName}</Text>
                                        <Grid minItem="sm" gap={3}>
                                            {topicLevels
                                                .sort((a, b) => a.levelIndex - b.levelIndex)
                                                .map((level) => (
                                                    <Box
                                                        key={`${level.topicId}-${level.levelIndex}`}
                                                        pad={3}
                                                        radius="l"
                                                        border
                                                        surface="elevated"
                                                    >
                                                        <Stack gap={2}>
                                                            <Cluster justify="between">
                                                                <Text weight="medium">{level.levelName}</Text>
                                                                <Tag>{level.achievedCount} достигли</Tag>
                                                            </Cluster>
                                                            <Stack gap={1}>
                                                                <Cluster justify="between">
                                                                    <Text variant="body-s" tone="muted">Попыток:</Text>
                                                                    <Text variant="body-s">{level.attemptedCount}</Text>
                                                                </Cluster>
                                                                <Cluster justify="between">
                                                                    <Text variant="body-s" tone="muted">Прошли/Провалили:</Text>
                                                                    <Cluster gap={1} wrap={false}>
                                                                        <Text variant="body-s" tone="success">{level.passedCount}</Text>
                                                                        <Text variant="body-s" tone="muted">/</Text>
                                                                        <Text variant="body-s" tone="error">{level.failedCount}</Text>
                                                                    </Cluster>
                                                                </Cluster>
                                                                <Cluster justify="between">
                                                                    <Text variant="body-s" tone="muted">Средний %:</Text>
                                                                    <Text variant="body-s">{level.avgCorrectPercent.toFixed(1)}%</Text>
                                                                </Cluster>
                                                            </Stack>
                                                        </Stack>
                                                    </Box>
                                                ))}
                                        </Grid>
                                    </Stack>
                                </Box>
                            );
                        })}
                    </Stack>
                ) : (
                    <Box pad={8}><Text align="center" tone="muted">Нет данных по уровням</Text></Box>
                )}
            </CardBody>
        </Card>
    );

    return (
        <Stack gap={6}>
            {/* Header */}
            <Cluster justify="between">
                <Cluster gap={4}>
                    <Link href="/author/tests">
                        <IconButton variant="ghost" aria-label="Назад к тестам" icon={<ArrowLeft size={20} />} />
                    </Link>
                    <Stack gap={1}>
                        <Text as="h1" variant="display-s" weight="semibold">{analytics.testTitle}</Text>
                        <Cluster gap={2}>
                            <Text tone="muted">Аналитика</Text>
                            <Tag tone={analytics.testMode === "adaptive" ? "accent" : "neutral"}>
                                {analytics.testMode === "adaptive" ? "Адаптивный" : "Стандартный"}
                            </Tag>
                        </Cluster>
                    </Stack>
                </Cluster>
                <Cluster gap={2}>
                    {/* PRD-54: третья точка входа. Тест здесь ЗАДАН страницей, поэтому файл
                        чужого теста форма отвергнет — см. `fixedTestId`. */}
                    <Button
                        variant="secondary"
                        leadingIcon={<Upload size={16} />}
                        onClick={() => setLmsImportOpen(true)}
                    >
                        Загрузить выгрузку LMS
                    </Button>
                    <Button onClick={handleExportExcel} variant="secondary" leadingIcon={<FileSpreadsheet size={16} />}>
                        Экспорт Excel
                    </Button>
                    {/*
                      PRD-56 FR-23: список попыток со страницы снят — он есть в реестре
                      прохождений, где умеет фильтровать, догружать порциями и вести в разбор.
                      Два списка на продукт означали бы два ответа на вопрос «кто проходил».
                    */}
                    <Link href={`/author/analytics?testId=${testId}`}>
                        <Button variant="secondary" size="s" leadingIcon={<FileText size={16} />}>
                            Прохождения в реестре
                        </Button>
                    </Link>
                </Cluster>
            </Cluster>

            <ModalDialog
                open={lmsImportOpen}
                onClose={() => setLmsImportOpen(false)}
                title="Загрузка выгрузки LMS"
                description={analytics.testTitle}
            >
                <LmsImportForm
                    fixedTestId={testId}
                    onDone={() => queryClient.invalidateQueries({ queryKey: ["/api/analytics"] })}
                />
            </ModalDialog>

            {/* Summary Cards */}
            <Grid minItem="sm" gap={1}>
                <Card>
                    <CardHeader title="Попытки" trail={<Users size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{summary.completedAttempts}</Text>
                        <Text as="p" variant="body-xs" tone="muted">{summary.uniqueUsers} уникальных пользователей</Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Средний балл" trail={<TrendingUp size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{formatPercent(summary.avgPercent)}</Text>
                        <Text as="p" variant="body-xs" tone="muted">
                            {summary.avgScore === null
                                ? "тест не оценивает ответы"
                                : `${summary.avgScore.toFixed(1)} из ${summary.maxScore} баллов`}
                        </Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Прохождение" trail={<Target size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{formatPercent(summary.passRate)}</Text>
                        <Text as="p" variant="body-xs" tone="muted">
                            {summary.passRate === null ? "вердикт не выносится" : "успешно сдали тест"}
                        </Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Среднее время" trail={<Clock size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{formatDuration(summary.avgDuration)}</Text>
                        <Text as="p" variant="body-xs" tone="muted">на прохождение</Text>
                    </CardBody>
                </Card>

                <Card>
                    <CardHeader title="Всего" trail={<BarChart3 size={16} color="var(--ou-fg-muted)" />} />
                    <CardBody>
                        <Text variant="display-s" weight="bold">{summary.totalAttempts}</Text>
                        <Text as="p" variant="body-xs" tone="muted">{summary.totalAttempts - summary.completedAttempts} незавершённых</Text>
                    </CardBody>
                </Card>
            </Grid>

            {/* Tabs */}
            <Tabs
                value={activeTab}
                onChange={setActiveTab}
                items={[
                    { id: "overview", label: "Обзор", content: overviewPanel },
                    { id: "questions", label: "Вопросы", content: questionsPanel },
                    ...(analytics.testMode === "adaptive"
                        ? [{ id: "levels", label: "Уровни", content: levelsPanel }]
                        : []),
                ]}
            />

        </Stack>
    );
}
