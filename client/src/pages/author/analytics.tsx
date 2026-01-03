import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LoadingState } from "@/components/loading-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  BarChart3,
  TrendingUp,
  Users,
  Target,
  AlertTriangle,
  CheckCircle,
  FileSpreadsheet,
  ChevronDown,
  ChevronUp,
  Filter,
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
  Legend,
} from "recharts";
import { t } from "@/lib/i18n";

interface Summary {
  totalTests: number;
  totalAttempts: number;
  overallPassRate: number;
  overallAvgPercent: number;
}

interface TestStat {
  testId: string;
  testTitle: string;
  totalAttempts: number;
  passRate: number;
  avgScore: number;
  avgPercent: number;
}

interface TopicStat {
  topicId: string;
  topicName: string;
  totalAppearances: number;
  avgPercent: number;
  passRate: number | null;
  hasPassRule: boolean;
  failureCount: number;
}

interface TrendData {
  date: string;
  attempts: number;
  avgPercent: number;
  passRate: number;
}

interface AnalyticsData {
  summary: Summary;
  testStats: TestStat[];
  topicStats: TopicStat[];
  trends: TrendData[];
}

interface ExportFilters {
  tests: { id: string; title: string; mode: string }[];
  users: { id: string; username: string }[];
}

interface ExportConfig {
  testIds: string[];
  userIds: string[];
  dateFrom: string;
  dateTo: string;
  testMode: "all" | "standard" | "adaptive";
  bestAttemptOnly: boolean;
  bestAttemptCriteria: "percent" | "level_sum" | "level_count";
  includeSheets: {
    summary: boolean;
    attempts: boolean;
    answers: boolean;
    questionStats: boolean;
    levelStats: boolean;
  };
}

function ExportSection() {
  const [isOpen, setIsOpen] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [testSearch, setTestSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");

  const { data: filters, isLoading: filtersLoading } = useQuery<ExportFilters>({
    queryKey: ["/api/export/filters"],
    enabled: isOpen,
  });

  const [config, setConfig] = useState<ExportConfig>({
    testIds: [],
    userIds: [],
    dateFrom: "",
    dateTo: "",
    testMode: "all",
    bestAttemptOnly: false,
    bestAttemptCriteria: "percent",
    includeSheets: {
      summary: true,
      attempts: true,
      answers: true,
      questionStats: true,
      levelStats: true,
    },
  });

  const handleTestToggle = (testId: string) => {
    setConfig(prev => ({
      ...prev,
      testIds: prev.testIds.includes(testId)
        ? prev.testIds.filter(id => id !== testId)
        : [...prev.testIds, testId],
    }));
  };

  const handleSelectAllTests = () => {
    if (!filters) return;

    let testsToSelect = filters.tests;
    if (config.testMode === "standard") {
      testsToSelect = testsToSelect.filter(t => t.mode !== "adaptive");
    } else if (config.testMode === "adaptive") {
      testsToSelect = testsToSelect.filter(t => t.mode === "adaptive");
    }

    const allSelected = testsToSelect.every(t => config.testIds.includes(t.id));

    setConfig(prev => ({
      ...prev,
      testIds: allSelected ? [] : testsToSelect.map(t => t.id),
    }));
  };

  const handleUserToggle = (userId: string) => {
    setConfig(prev => ({
      ...prev,
      userIds: prev.userIds.includes(userId)
        ? prev.userIds.filter(id => id !== userId)
        : [...prev.userIds, userId],
    }));
  };

  const handleSelectAllUsers = () => {
    if (!filters) return;
    const allSelected = filters.users.length === config.userIds.length;
    setConfig(prev => ({
      ...prev,
      userIds: allSelected ? [] : filters.users.map(u => u.id),
    }));
  };

  const handleExport = async () => {
    if (config.testIds.length === 0) {
      alert("Выберите хотя бы один тест");
      return;
    }

    setIsExporting(true);

    try {
      const response = await fetch("/api/export/excel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
        credentials: "include", // на всякий случай для сессии
      });

      const ct = response.headers.get("content-type") || "";
      if (!response.ok || !ct.includes("spreadsheetml.sheet")) {
        const text = await response.text();
        console.error("Export returned non-xlsx:", response.status, ct, text.slice(0, 300));
        throw new Error("Сервер вернул не Excel (скорее всего роут не найден)");
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `report_${new Date().toISOString().split("T")[0]}.xlsx`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error("Export error:", error);
      alert("Ошибка при создании отчёта");
    } finally {
      setIsExporting(false);
    }
  };

  // Фильтруем тесты по режиму и поиску
  const filteredTests = filters?.tests.filter(test => {
    if (config.testMode === "standard" && test.mode === "adaptive") return false;
    if (config.testMode === "adaptive" && test.mode !== "adaptive") return false;
    if (testSearch && !test.title.toLowerCase().includes(testSearch.toLowerCase())) return false;
    return true;
  }) || [];

  // Фильтруем пользователей по поиску
  const filteredUsers = filters?.users.filter(user => {
    if (userSearch && !user.username.toLowerCase().includes(userSearch.toLowerCase())) return false;
    return true;
  }) || [];

  // Проверяем есть ли адаптивные тесты в выборке
  const hasAdaptiveSelected = config.testIds.some(id =>
    filters?.tests.find(t => t.id === id)?.mode === "adaptive"
  );

  return (
    <Card>
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5" />
                <CardTitle className="text-lg">Экспорт отчёта</CardTitle>
              </div>
              {isOpen ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
            </div>
          </CardHeader>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <CardContent className="space-y-6">
            {filtersLoading ? (
              <div className="flex items-center justify-center py-8">
                <LoadingState message="Загрузка фильтров..." />
              </div>
            ) : (
              <>
                {/* Режим тестов */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Режим тестов</Label>
                  <Select
                    value={config.testMode}
                    onValueChange={(value: "all" | "standard" | "adaptive") => {
                      setConfig(prev => ({ ...prev, testMode: value, testIds: [] }));
                    }}
                  >
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все тесты</SelectItem>
                      <SelectItem value="standard">Только стандартные</SelectItem>
                      <SelectItem value="adaptive">Только адаптивные</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {/* Выбор тестов */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">Тесты ({config.testIds.length} выбрано)</Label>
                    <Button variant="ghost" size="sm" onClick={handleSelectAllTests}>
                      {filteredTests.every(t => config.testIds.includes(t.id)) && filteredTests.length > 0 ? "Снять все" : "Выбрать все"}
                    </Button>
                  </div>
                  <Input
                    placeholder="Поиск тестов..."
                    value={testSearch}
                    onChange={(e) => setTestSearch(e.target.value)}
                    className="h-8"
                  />
                  <div className="border rounded-lg p-3 max-h-[200px] overflow-y-auto space-y-2">
                    {filteredTests.length > 0 ? (
                      filteredTests.map(test => (
                        <div key={test.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`test-${test.id}`}
                            checked={config.testIds.includes(test.id)}
                            onCheckedChange={() => handleTestToggle(test.id)}
                          />
                          <Label htmlFor={`test-${test.id}`} className="flex-1 cursor-pointer">
                            {test.title}
                          </Label>
                          <Badge variant="outline" className="text-xs">
                            {test.mode === "adaptive" ? "Адапт." : "Станд."}
                          </Badge>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-sm text-center py-4">
                        Нет тестов для выбранного режима
                      </p>
                    )}
                  </div>
                </div>

                {/* Даты */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Дата от</Label>
                    <Input
                      type="date"
                      className="[color-scheme:light] dark:[color-scheme:dark]"
                      value={config.dateFrom}
                      onChange={(e) => setConfig(prev => ({ ...prev, dateFrom: e.target.value }))}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm font-medium">Дата до</Label>
                    <Input
                      type="date"
                      className="[color-scheme:light] dark:[color-scheme:dark]"
                      value={config.dateTo}
                      onChange={(e) => setConfig(prev => ({ ...prev, dateTo: e.target.value }))}
                    />
                  </div>
                </div>


                {/* Выбор пользователей */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-medium">
                      Пользователи ({config.userIds.length === 0 ? "все" : `${config.userIds.length} выбрано`})
                    </Label>
                    <Button variant="ghost" size="sm" onClick={handleSelectAllUsers}>
                      {config.userIds.length === filteredUsers.length && filteredUsers.length > 0 ? "Снять все" : "Выбрать всех"}
                    </Button>
                  </div>
                  <Input
                    placeholder="Поиск пользователей..."
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    className="h-8"
                  />
                  <div className="border rounded-lg p-3 max-h-[150px] overflow-y-auto space-y-2">
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map(user => (
                        <div key={user.id} className="flex items-center gap-2">
                          <Checkbox
                            id={`user-${user.id}`}
                            checked={config.userIds.includes(user.id)}
                            onCheckedChange={() => handleUserToggle(user.id)}
                          />
                          <Label htmlFor={`user-${user.id}`} className="cursor-pointer">
                            {user.username}
                          </Label>
                        </div>
                      ))
                    ) : (
                      <p className="text-muted-foreground text-sm text-center py-4">
                        Нет пользователей
                      </p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Если никто не выбран — будут включены все пользователи
                  </p>
                </div>

                {/* Лучшая попытка */}
                <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="bestAttempt"
                      checked={config.bestAttemptOnly}
                      onCheckedChange={(checked) =>
                        setConfig(prev => ({ ...prev, bestAttemptOnly: checked === true }))
                      }
                    />
                    <Label htmlFor="bestAttempt" className="cursor-pointer font-medium">
                      Только лучшая попытка каждого пользователя
                    </Label>
                  </div>

                  {config.bestAttemptOnly && hasAdaptiveSelected && (
                    <div className="ml-6 space-y-2">
                      <Label className="text-sm">Критерий лучшей попытки (для адаптивных)</Label>
                      <Select
                        value={config.bestAttemptCriteria}
                        onValueChange={(value: "percent" | "level_sum" | "level_count") =>
                          setConfig(prev => ({ ...prev, bestAttemptCriteria: value }))
                        }
                      >
                        <SelectTrigger className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="percent">По максимальному проценту</SelectItem>
                          <SelectItem value="level_sum">По сумме индексов уровней</SelectItem>
                          <SelectItem value="level_count">По количеству тем с достигнутым уровнем</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>

                {/* Листы для включения */}
                <div className="space-y-2">
                  <Label className="text-sm font-medium">Листы в отчёте</Label>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="sheet-summary"
                        checked={config.includeSheets.summary}
                        onCheckedChange={(checked) =>
                          setConfig(prev => ({
                            ...prev,
                            includeSheets: { ...prev.includeSheets, summary: checked === true }
                          }))
                        }
                      />
                      <Label htmlFor="sheet-summary" className="cursor-pointer text-sm">Сводка</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="sheet-attempts"
                        checked={config.includeSheets.attempts}
                        onCheckedChange={(checked) =>
                          setConfig(prev => ({
                            ...prev,
                            includeSheets: { ...prev.includeSheets, attempts: checked === true }
                          }))
                        }
                      />
                      <Label htmlFor="sheet-attempts" className="cursor-pointer text-sm">Попытки</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="sheet-answers"
                        checked={config.includeSheets.answers}
                        onCheckedChange={(checked) =>
                          setConfig(prev => ({
                            ...prev,
                            includeSheets: { ...prev.includeSheets, answers: checked === true }
                          }))
                        }
                      />
                      <Label htmlFor="sheet-answers" className="cursor-pointer text-sm">Ответы</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="sheet-questionStats"
                        checked={config.includeSheets.questionStats}
                        onCheckedChange={(checked) =>
                          setConfig(prev => ({
                            ...prev,
                            includeSheets: { ...prev.includeSheets, questionStats: checked === true }
                          }))
                        }
                      />
                      <Label htmlFor="sheet-questionStats" className="cursor-pointer text-sm">Статистика вопросов</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="sheet-levelStats"
                        checked={config.includeSheets.levelStats}
                        onCheckedChange={(checked) =>
                          setConfig(prev => ({
                            ...prev,
                            includeSheets: { ...prev.includeSheets, levelStats: checked === true }
                          }))
                        }
                      />
                      <Label htmlFor="sheet-levelStats" className="cursor-pointer text-sm">
                        Статистика уровней
                        <span className="text-xs text-muted-foreground ml-1">(адапт.)</span>
                      </Label>
                    </div>
                  </div>
                </div>

                {/* Кнопка экспорта */}
                <div className="flex justify-end pt-4 border-t">
                  <Button
                    onClick={handleExport}
                    disabled={isExporting || config.testIds.length === 0}
                    className="min-w-[200px]"
                  >
                    {isExporting ? (
                      <>Создание отчёта...</>
                    ) : (
                      <>
                        <FileSpreadsheet className="h-4 w-4 mr-2" />
                        Создать отчёт
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}

export default function AnalyticsPage() {
  const { data, isLoading, error } = useQuery<AnalyticsData>({
    queryKey: ["/api/analytics"],
  });

  if (isLoading) {
    return <LoadingState message={t.analytics.loading} />;
  }

  if (error || !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">{t.common.failedToLoadAnalytics}</p>
      </div>
    );
  }

  const { summary, testStats, topicStats, trends } = data;

  const mostFailedTopics = [...topicStats]
    .filter((topic) => topic.hasPassRule && topic.failureCount > 0)
    .sort((a, b) => b.failureCount - a.failureCount)
    .slice(0, 5);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold" data-testid="text-analytics-title">{t.analytics.title}</h1>
        <p className="text-muted-foreground">{t.analytics.description}</p>
      </div>

      {/* Export Section */}
      <ExportSection />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card data-testid="card-total-tests">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.totalTests}</CardTitle>
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-tests">{summary.totalTests}</div>
          </CardContent>
        </Card>

        <Card data-testid="card-total-attempts">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.totalAttempts}</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-total-attempts">{summary.totalAttempts}</div>
          </CardContent>
        </Card>

        <Card data-testid="card-pass-rate">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.overallPassRate}</CardTitle>
            <Target className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-pass-rate">{summary.overallPassRate.toFixed(1)}%</div>
          </CardContent>
        </Card>

        <Card data-testid="card-avg-score">
          <CardHeader className="flex flex-row items-center justify-between gap-4 space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">{t.analytics.avgScore}</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold" data-testid="text-avg-score">{summary.overallAvgPercent.toFixed(1)}%</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-trends-chart">
          <CardHeader>
            <CardTitle className="text-lg">{t.analytics.attemptTrends} (30 {t.analytics.date.toLowerCase()})</CardTitle>
          </CardHeader>
          <CardContent>
            {trends.length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={trends}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(val) => new Date(val).toLocaleDateString("ru-RU", { month: "short", day: "numeric" })}
                    className="text-xs"
                  />
                  <YAxis className="text-xs" />
                  <Tooltip
                    labelFormatter={(val) => new Date(val).toLocaleDateString("ru-RU")}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  />
                  <Legend />
                  <Line
                    type="monotone"
                    dataKey="attempts"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    name={t.analytics.attempts}
                  />
                  <Line
                    type="monotone"
                    dataKey="passRate"
                    stroke="hsl(var(--chart-2))"
                    strokeWidth={2}
                    name={t.analytics.passRate}
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                {t.analytics.noData}
              </div>
            )}
          </CardContent>
        </Card>

        <Card data-testid="card-test-performance">
          <CardHeader>
            <CardTitle className="text-lg">{t.analytics.testPerformance}</CardTitle>
          </CardHeader>
          <CardContent>
            {testStats.filter((item) => item.totalAttempts > 0).length > 0 ? (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={testStats.filter((item) => item.totalAttempts > 0)}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="testTitle"
                    className="text-xs"
                    tick={{ fontSize: 10 }}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis className="text-xs" />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }}
                  />
                  <Legend />
                  <Bar dataKey="avgPercent" fill="hsl(var(--primary))" name={`${t.common.avg} %`} />
                  <Bar dataKey="passRate" fill="hsl(var(--chart-2))" name={t.analytics.passRate} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                {t.analytics.noAttempts}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card data-testid="card-topic-stats">
          <CardHeader>
            <CardTitle className="text-lg">{t.analytics.topicStatistics}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {topicStats.length > 0 ? (
                topicStats.map((topic) => (
                  <div
                    key={topic.topicId}
                    className="flex items-center justify-between gap-4"
                    data-testid={`row-topic-${topic.topicId}`}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{topic.topicName}</p>
                      <p className="text-sm text-muted-foreground">
                        {topic.totalAppearances} {t.common.appearances}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="whitespace-nowrap">
                        {topic.avgPercent.toFixed(1)}% {t.common.avg}
                      </Badge>
                      {topic.hasPassRule && topic.passRate !== null ? (
                        topic.passRate >= 70 ? (
                          <CheckCircle className="h-4 w-4 text-green-500" />
                        ) : topic.passRate >= 50 ? (
                          <AlertTriangle className="h-4 w-4 text-yellow-500" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-red-500" />
                        )
                      ) : null}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground text-center py-8">{t.analytics.noData}</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-failed-topics">
          <CardHeader>
            <CardTitle className="text-lg">{t.analytics.mostFailedTopics}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {mostFailedTopics.length > 0 ? (
                mostFailedTopics.map((topic, idx) => (
                  <div
                    key={topic.topicId}
                    className="flex items-center justify-between gap-4"
                    data-testid={`row-failed-topic-${idx}`}
                  >
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <span className="flex items-center justify-center w-6 h-6 rounded-full bg-destructive/10 text-destructive text-xs font-medium">
                        {idx + 1}
                      </span>
                      <p className="font-medium truncate">{topic.topicName}</p>
                    </div>
                    <Badge variant="destructive">
                      {topic.failureCount} {t.common.failures}
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle className="h-8 w-8 text-green-500 mb-2" />
                  <p className="text-muted-foreground">{t.common.noTopicFailures}</p>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card data-testid="card-test-details">
        <CardHeader>
          <CardTitle className="text-lg">{t.common.testDetails}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-2 font-medium">{t.common.test}</th>
                  <th className="text-right py-3 px-2 font-medium">{t.analytics.attempts}</th>
                  <th className="text-right py-3 px-2 font-medium">{t.common.avg} %</th>
                  <th className="text-right py-3 px-2 font-medium">{t.analytics.passRate}</th>
                </tr>
              </thead>
              <tbody>
                {testStats.map((test) => (
                  <tr key={test.testId} className="border-b" data-testid={`row-test-${test.testId}`}>
                    <td className="py-3 px-2">{test.testTitle}</td>
                    <td className="py-3 px-2 text-right">{test.totalAttempts}</td>
                    <td className="py-3 px-2 text-right">{test.avgPercent.toFixed(1)}%</td>
                    <td className="py-3 px-2 text-right">
                      <Badge variant={test.passRate >= 70 ? "secondary" : test.passRate >= 50 ? "outline" : "destructive"}>
                        {test.passRate.toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                ))}
                {testStats.length === 0 && (
                  <tr>
                    <td colSpan={4} className="text-center py-8 text-muted-foreground">
                      {t.common.noTestsAvailable}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}