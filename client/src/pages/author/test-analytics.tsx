import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useRoute, Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
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
    PieChart,
    Pie,
    Cell,
} from "recharts";

// Types
interface TestAnalytics {
    testId: string;
    testTitle: string;
    testMode: "standard" | "adaptive";
    summary: {
        totalAttempts: number;
        completedAttempts: number;
        uniqueUsers: number;
        avgPercent: number;
        avgDuration: number | null;
        passRate: number;
        avgScore: number;
        maxScore: number;
    };
    topicStats: Array<{
        topicId: string;
        topicName: string;
        totalAnswers: number;
        correctAnswers: number;
        avgPercent: number;
        passRate: number | null;
    }>;
    questionStats: Array<{
        questionId: string;
        questionPrompt: string;
        questionType: string;
        topicId: string;
        topicName: string;
        difficulty: number;
        totalAnswers: number;
        correctAnswers: number;
        correctPercent: number;
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
    scoreDistribution: Array<{
        range: string;
        count: number;
    }>;
    dailyTrends: Array<{
        date: string;
        attempts: number;
        avgPercent: number;
        passRate: number;
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
    answers: Array<{
        questionId: string;
        questionPrompt: string;
        questionType: string;
        topicId: string;
        topicName: string;
        userAnswer: unknown;
        correctAnswer: unknown;
        isCorrect: boolean;
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

const COLORS = ["#3b82f6", "#22c55e", "#eab308", "#ef4444", "#8b5cf6", "#ec4899"];

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

// Attempt Detail Modal
function AttemptDetailModal({
    attemptId,
    open,
    onClose,
}: {
    attemptId: string | null;
    open: boolean;
    onClose: () => void;
}) {
    const { data, isLoading } = useQuery<AttemptDetail>({
        queryKey: [`/api/analytics/attempts/${attemptId}`],
        enabled: !!attemptId && open,
    });

    return (
        <Dialog open={open} onOpenChange={onClose}>
            <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>
                        Детализация попытки
                        {data && (
                            <span className="ml-2 text-muted-foreground font-normal">
                                — {data.username}
                            </span>
                        )}
                    </DialogTitle>
                </DialogHeader>

                {isLoading ? (
                    <LoadingState message="Загрузка..." />
                ) : data ? (
                    <div className="space-y-6">
                        {/* Summary */}
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                            <div className="text-center p-3 bg-muted rounded-lg">
                                <div className="text-2xl font-bold">{data.overallPercent.toFixed(1)}%</div>
                                <div className="text-sm text-muted-foreground">Результат</div>
                            </div>
                            <div className="text-center p-3 bg-muted rounded-lg">
                                <div className="text-2xl font-bold">
                                    {data.earnedPoints}/{data.possiblePoints}
                                </div>
                                <div className="text-sm text-muted-foreground">Баллы</div>
                            </div>
                            <div className="text-center p-3 bg-muted rounded-lg">
                                <div className="text-2xl font-bold">{formatDuration(data.duration)}</div>
                                <div className="text-sm text-muted-foreground">Время</div>
                            </div>
                            <div className="text-center p-3 bg-muted rounded-lg">
                                <Badge variant={data.passed ? "default" : "destructive"} className="text-lg px-3 py-1">
                                    {data.passed ? "Пройден" : "Не пройден"}
                                </Badge>
                            </div>
                        </div>

                        {/* Achieved Levels (for adaptive) */}
                        {data.testMode === "adaptive" && data.achievedLevels && (
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base flex items-center gap-2">
                                        <Layers className="h-4 w-4" />
                                        Достигнутые уровни
                                    </CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="flex flex-wrap gap-2">
                                        {data.achievedLevels.map((level, idx) => (
                                            <Badge key={idx} variant={level.levelName ? "default" : "secondary"}>
                                                {level.topicName}: {level.levelName || "Не достигнут"}
                                            </Badge>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Trajectory (for adaptive) */}
                        {data.trajectory && data.trajectory.length > 0 && (
                            <Card>
                                <CardHeader className="pb-2">
                                    <CardTitle className="text-base">Траектория прохождения</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <div className="space-y-2">
                                        {data.trajectory.map((event, idx) => (
                                            <div key={idx} className="flex items-center gap-2 text-sm">
                                                {event.action === "level_up" ? (
                                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                                ) : (
                                                    <XCircle className="h-4 w-4 text-red-500" />
                                                )}
                                                <span>{event.message}</span>
                                            </div>
                                        ))}
                                    </div>
                                </CardContent>
                            </Card>
                        )}

                        {/* Answers */}
                        <Card>
                            <CardHeader className="pb-2">
                                <CardTitle className="text-base">Ответы ({data.answers.length})</CardTitle>
                            </CardHeader>
                            <CardContent>
                                <div className="space-y-3 max-h-[400px] overflow-y-auto">
                                    {data.answers.map((answer, idx) => (
                                        <div
                                            key={answer.questionId}
                                            className={`p-3 rounded-lg border ${answer.isCorrect ? "border-green-500/30 bg-green-500/5" : "border-red-500/30 bg-red-500/5"
                                                }`}
                                        >
                                            <div className="flex items-start justify-between gap-2">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                                                        <Badge variant="outline" className="text-xs">
                                                            {answer.topicName}
                                                        </Badge>
                                                        {answer.levelName && (
                                                            <Badge variant="secondary" className="text-xs">
                                                                {answer.levelName}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                    <p className="text-sm font-medium line-clamp-2">{answer.questionPrompt}</p>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="text-sm">
                                                        {answer.earnedPoints}/{answer.possiblePoints}
                                                    </span>
                                                    {answer.isCorrect ? (
                                                        <CheckCircle className="h-5 w-5 text-green-500" />
                                                    ) : (
                                                        <XCircle className="h-5 w-5 text-red-500" />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    </div>
                ) : (
                    <p className="text-muted-foreground text-center py-8">Не удалось загрузить данные</p>
                )}
            </DialogContent>
        </Dialog>
    );
}

export default function TestAnalyticsPage() {
    const [, params] = useRoute("/author/tests/:testId/analytics");
    const testId = params?.testId;

    const [selectedAttemptId, setSelectedAttemptId] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState("overview");

    const { data: analytics, isLoading: analyticsLoading } = useQuery<TestAnalytics>({
        queryKey: [`/api/analytics/tests/${testId}`],
        enabled: !!testId,
    });

    const { data: attemptsData, isLoading: attemptsLoading } = useQuery<{
        testId: string;
        testTitle: string;
        testMode: string;
        attempts: AttemptListItem[];
    }>({
        queryKey: [`/api/analytics/tests/${testId}/attempts`],
        enabled: !!testId && activeTab === "attempts",
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
            <div className="flex flex-col items-center justify-center h-64 gap-4">
                <p className="text-muted-foreground">Не удалось загрузить аналитику</p>
                <Link href="/author/tests">
                    <Button variant="outline">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Назад к тестам
                    </Button>
                </Link>
            </div>
        );
    }

    const { summary, topicStats, questionStats, levelStats, scoreDistribution, dailyTrends } = analytics;

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                    <Link href="/author/tests">
                        <Button variant="ghost" size="icon">
                            <ArrowLeft className="h-5 w-5" />
                        </Button>
                    </Link>
                    <div>
                        <h1 className="text-2xl font-semibold">{analytics.testTitle}</h1>
                        <div className="flex items-center gap-2 text-muted-foreground">
                            <span>Аналитика</span>
                            <Badge variant={analytics.testMode === "adaptive" ? "default" : "secondary"}>
                                {analytics.testMode === "adaptive" ? "Адаптивный" : "Стандартный"}
                            </Badge>
                        </div>
                    </div>
                </div>
                <Button onClick={handleExportExcel} variant="outline">
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Экспорт Excel
                </Button>
            </div>

            {/* Summary Cards */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Попытки</CardTitle>
                        <Users className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary.completedAttempts}</div>
                        <p className="text-xs text-muted-foreground">
                            {summary.uniqueUsers} уникальных пользователей
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Средний балл</CardTitle>
                        <TrendingUp className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary.avgPercent.toFixed(1)}%</div>
                        <p className="text-xs text-muted-foreground">
                            {summary.avgScore.toFixed(1)} из {summary.maxScore} баллов
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Прохождение</CardTitle>
                        <Target className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary.passRate.toFixed(1)}%</div>
                        <p className="text-xs text-muted-foreground">успешно сдали тест</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Среднее время</CardTitle>
                        <Clock className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{formatDuration(summary.avgDuration)}</div>
                        <p className="text-xs text-muted-foreground">на прохождение</p>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0 pb-2">
                        <CardTitle className="text-sm font-medium">Всего</CardTitle>
                        <BarChart3 className="h-4 w-4 text-muted-foreground" />
                    </CardHeader>
                    <CardContent>
                        <div className="text-2xl font-bold">{summary.totalAttempts}</div>
                        <p className="text-xs text-muted-foreground">
                            {summary.totalAttempts - summary.completedAttempts} незавершённых
                        </p>
                    </CardContent>
                </Card>
            </div>

            {/* Tabs */}
            <Tabs value={activeTab} onValueChange={setActiveTab}>
                <TabsList>
                    <TabsTrigger value="overview">Обзор</TabsTrigger>
                    <TabsTrigger value="attempts">Попытки</TabsTrigger>
                    <TabsTrigger value="questions">Вопросы</TabsTrigger>
                    {analytics.testMode === "adaptive" && (
                        <TabsTrigger value="levels">Уровни</TabsTrigger>
                    )}
                </TabsList>

                {/* Overview Tab */}
                <TabsContent value="overview" className="space-y-6">
                    <div className="grid gap-6 lg:grid-cols-2">
                        {/* Score Distribution */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Распределение результатов</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {scoreDistribution.some((d) => d.count > 0) ? (
                                    <ResponsiveContainer width="100%" height={250}>
                                        <BarChart data={scoreDistribution}>
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                            <XAxis dataKey="range" className="text-xs" />
                                            <YAxis className="text-xs" />
                                            <Tooltip
                                                contentStyle={{
                                                    backgroundColor: "hsl(var(--card))",
                                                    border: "1px solid hsl(var(--border))",
                                                }}
                                            />
                                            <Bar dataKey="count" fill="hsl(var(--primary))" name="Попытки" />
                                        </BarChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                                        Нет данных
                                    </div>
                                )}
                            </CardContent>
                        </Card>

                        {/* Daily Trends */}
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg">Тренды (30 дней)</CardTitle>
                            </CardHeader>
                            <CardContent>
                                {dailyTrends.length > 0 ? (
                                    <ResponsiveContainer width="100%" height={250}>
                                        <LineChart data={dailyTrends}>
                                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                                            <XAxis
                                                dataKey="date"
                                                tickFormatter={(val) =>
                                                    new Date(val).toLocaleDateString("ru-RU", {
                                                        day: "numeric",
                                                        month: "short",
                                                    })
                                                }
                                                className="text-xs"
                                            />
                                            <YAxis className="text-xs" />
                                            <Tooltip
                                                labelFormatter={(val) => new Date(val).toLocaleDateString("ru-RU")}
                                                contentStyle={{
                                                    backgroundColor: "hsl(var(--card))",
                                                    border: "1px solid hsl(var(--border))",
                                                }}
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="avgPercent"
                                                stroke="hsl(var(--primary))"
                                                strokeWidth={2}
                                                name="Средний %"
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey="passRate"
                                                stroke="hsl(var(--chart-2))"
                                                strokeWidth={2}
                                                name="% прохождения"
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                ) : (
                                    <div className="flex items-center justify-center h-[250px] text-muted-foreground">
                                        Нет данных
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    </div>

                    {/* Topic Stats */}
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Статистика по темам</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {topicStats.length > 0 ? (
                                <div className="space-y-3">
                                    {topicStats.map((topic) => (
                                        <div
                                            key={topic.topicId}
                                            className="flex items-center justify-between gap-4 p-3 rounded-lg bg-muted/50"
                                        >
                                            <div>
                                                <p className="font-medium">{topic.topicName}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {topic.correctAnswers} / {topic.totalAnswers} правильных
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-3">
                                                <Badge variant="secondary">{topic.avgPercent.toFixed(1)}%</Badge>
                                                {topic.passRate !== null && (
                                                    <Badge variant={topic.passRate >= 70 ? "default" : "destructive"}>
                                                        {topic.passRate.toFixed(0)}% сдали
                                                    </Badge>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-muted-foreground text-center py-8">Нет данных по темам</p>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Attempts Tab */}
                <TabsContent value="attempts">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg">Список попыток</CardTitle>
                        </CardHeader>
                        <CardContent>
                            {attemptsLoading ? (
                                <LoadingState message="Загрузка..." />
                            ) : attemptsData?.attempts && attemptsData.attempts.length > 0 ? (
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm">
                                        <thead>
                                            <tr className="border-b">
                                                <th className="text-left py-3 px-2 font-medium">Пользователь</th>
                                                <th className="text-left py-3 px-2 font-medium">Дата</th>
                                                <th className="text-right py-3 px-2 font-medium">Время</th>
                                                <th className="text-right py-3 px-2 font-medium">Результат</th>
                                                <th className="text-right py-3 px-2 font-medium">Статус</th>
                                                {analytics.testMode === "adaptive" && (
                                                    <th className="text-left py-3 px-2 font-medium">Уровни</th>
                                                )}
                                                <th className="py-3 px-2"></th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {attemptsData.attempts.map((attempt) => (
                                                <tr key={attempt.attemptId} className="border-b hover:bg-muted/50">
                                                    <td className="py-3 px-2">{attempt.username}</td>
                                                    <td className="py-3 px-2">{formatDate(attempt.finishedAt)}</td>
                                                    <td className="py-3 px-2 text-right">{formatDuration(attempt.duration)}</td>
                                                    <td className="py-3 px-2 text-right">
                                                        {attempt.completed ? (
                                                            <span className="font-medium">{attempt.overallPercent.toFixed(1)}%</span>
                                                        ) : (
                                                            <span className="text-muted-foreground">—</span>
                                                        )}
                                                    </td>
                                                    <td className="py-3 px-2 text-right">
                                                        {attempt.completed ? (
                                                            <Badge variant={attempt.passed ? "default" : "destructive"}>
                                                                {attempt.passed ? "Сдан" : "Не сдан"}
                                                            </Badge>
                                                        ) : (
                                                            <Badge variant="secondary">В процессе</Badge>
                                                        )}
                                                    </td>
                                                    {analytics.testMode === "adaptive" && (
                                                        <td className="py-3 px-2">
                                                            <div className="flex flex-wrap gap-1">
                                                                {attempt.achievedLevels?.map((level, idx) => (
                                                                    <Badge key={idx} variant="outline" className="text-xs">
                                                                        {level.levelName || "—"}
                                                                    </Badge>
                                                                ))}
                                                            </div>
                                                        </td>
                                                    )}
                                                    <td className="py-3 px-2">
                                                        {attempt.completed && (
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                onClick={() => setSelectedAttemptId(attempt.attemptId)}
                                                            >
                                                                <FileText className="h-4 w-4" />
                                                            </Button>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                <p className="text-muted-foreground text-center py-8">Нет попыток</p>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Questions Tab */}
                <TabsContent value="questions">
                    <Card>
                        <CardHeader>
                            <CardTitle className="text-lg flex items-center gap-2">
                                <HelpCircle className="h-5 w-5" />
                                Статистика по вопросам
                            </CardTitle>
                        </CardHeader>
                        <CardContent>
                            {questionStats.length > 0 ? (
                                <div className="space-y-3">
                                    {questionStats.map((q, idx) => (
                                        <div
                                            key={q.questionId}
                                            className="p-3 rounded-lg border"
                                        >
                                            <div className="flex items-start justify-between gap-4">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <span className="text-xs text-muted-foreground">#{idx + 1}</span>
                                                        <Badge variant="outline" className="text-xs">
                                                            {q.topicName}
                                                        </Badge>
                                                        <Badge variant="secondary" className="text-xs">
                                                            Сложность: {q.difficulty}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-sm line-clamp-2">{q.questionPrompt}</p>
                                                </div>
                                                <div className="text-right">
                                                    <div
                                                        className={`text-lg font-bold ${q.correctPercent >= 70
                                                            ? "text-green-500"
                                                            : q.correctPercent >= 50
                                                                ? "text-yellow-500"
                                                                : "text-red-500"
                                                            }`}
                                                    >
                                                        {q.correctPercent.toFixed(0)}%
                                                    </div>
                                                    <p className="text-xs text-muted-foreground">
                                                        {q.correctAnswers}/{q.totalAnswers}
                                                    </p>
                                                </div>
                                            </div>
                                            {/* Progress bar */}
                                            <div className="mt-2 h-2 bg-muted rounded-full overflow-hidden">
                                                <div
                                                    className={`h-full transition-all ${q.correctPercent >= 70
                                                        ? "bg-green-500"
                                                        : q.correctPercent >= 50
                                                            ? "bg-yellow-500"
                                                            : "bg-red-500"
                                                        }`}
                                                    style={{ width: `${q.correctPercent}%` }}
                                                />
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <p className="text-muted-foreground text-center py-8">Нет данных по вопросам</p>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                {/* Levels Tab (Adaptive only) */}
                {analytics.testMode === "adaptive" && (
                    <TabsContent value="levels">
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-lg flex items-center gap-2">
                                    <Layers className="h-5 w-5" />
                                    Статистика по уровням
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                {levelStats && levelStats.length > 0 ? (
                                    <div className="space-y-4">
                                        {/* Group by topic */}
                                        {Array.from(new Set(levelStats.map((l) => l.topicId))).map((topicId) => {
                                            const topicLevels = levelStats.filter((l) => l.topicId === topicId);
                                            const topicName = topicLevels[0]?.topicName || "Unknown";

                                            return (
                                                <div key={topicId} className="p-4 rounded-lg bg-muted/50">
                                                    <h4 className="font-medium mb-3">{topicName}</h4>
                                                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                                                        {topicLevels
                                                            .sort((a, b) => a.levelIndex - b.levelIndex)
                                                            .map((level) => (
                                                                <div
                                                                    key={`${level.topicId}-${level.levelIndex}`}
                                                                    className="p-3 rounded-lg bg-background border"
                                                                >
                                                                    <div className="flex items-center justify-between mb-2">
                                                                        <span className="font-medium">{level.levelName}</span>
                                                                        <Badge variant="secondary">{level.achievedCount} достигли</Badge>
                                                                    </div>
                                                                    <div className="text-sm text-muted-foreground space-y-1">
                                                                        <div className="flex justify-between">
                                                                            <span>Попыток:</span>
                                                                            <span>{level.attemptedCount}</span>
                                                                        </div>
                                                                        <div className="flex justify-between">
                                                                            <span>Прошли/Провалили:</span>
                                                                            <span className="text-green-500">{level.passedCount}</span>
                                                                            <span>/</span>
                                                                            <span className="text-red-500">{level.failedCount}</span>
                                                                        </div>
                                                                        <div className="flex justify-between">
                                                                            <span>Средний %:</span>
                                                                            <span>{level.avgCorrectPercent.toFixed(1)}%</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            ))}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <p className="text-muted-foreground text-center py-8">Нет данных по уровням</p>
                                )}
                            </CardContent>
                        </Card>
                    </TabsContent>
                )}
            </Tabs>

            {/* Attempt Detail Modal */}
            <AttemptDetailModal
                attemptId={selectedAttemptId}
                open={!!selectedAttemptId}
                onClose={() => setSelectedAttemptId(null)}
            />
        </div>
    );
}