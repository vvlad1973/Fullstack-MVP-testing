import { useState, useEffect, useRef } from "react";
import { useParams, useLocation } from "wouter";
import { ChevronLeft, ChevronRight, CheckCircle, XCircle, ArrowUp, ArrowDown, Trophy, Target, GripVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { LoadingState } from "@/components/loading-state";
import { t } from "@/lib/i18n";
import type { Question, Attempt, Test } from "@shared/schema";

interface AttemptWithQuestions extends Attempt {
  questions: Question[];
  testTitle: string;
}

interface FlatQuestion {
  question: Question;
  topicName: string;
  index: number;
}

interface AdaptiveState {
  attemptId: string;
  testTitle: string;
  showDifficultyLevel: boolean;
  currentQuestion: {
    id: string;
    question: Question;
    topicName: string;
    levelName: string;
    questionNumber: number;
    totalInLevel: number;
  } | null;
  totalTopics: number;
  currentTopicIndex: number;
  answer: any;
  lastResult: {
    isCorrect: boolean;
    correctAnswer?: any;
    feedback?: string;
    levelTransition?: {
      type: "up" | "down" | "complete";
      fromLevel: string;
      toLevel: string | null;
      message: string;
    };
    topicTransition?: {
      fromTopic: string;
      toTopic: string;
    };
  } | null;
  isFinished: boolean;
  result: any;
  questionsAnswered: number;
}

export default function TakeTestPage() {
  const { testId } = useParams<{ testId: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  // Common state
  const [isStarting, setIsStarting] = useState(true);
  const [testMode, setTestMode] = useState<"standard" | "adaptive" | null>(null);
  const [testInfo, setTestInfo] = useState<Test | null>(null);

  // Standard mode state
  const [attempt, setAttempt] = useState<AttemptWithQuestions | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, any>>({});
  const [flatQuestions, setFlatQuestions] = useState<FlatQuestion[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [shuffleMappings, setShuffleMappings] = useState<Record<string, any>>({});

  // Adaptive mode state
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveState | null>(null);
  const [isAnswering, setIsAnswering] = useState(false);
  const [showTransition, setShowTransition] = useState(false);

  const shuffleArray = (arr: any[]) => {
    const shuffled = [...arr];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };

  const createShuffleMapping = (length: number): number[] => {
    const indices = Array.from({ length }, (_, i) => i);
    return shuffleArray(indices);
  };

  // Fetch test info and start appropriate attempt
  useEffect(() => {
    const initTest = async () => {
      setIsStarting(true);
      try {
        // First, get test info to determine mode
        const testRes = await fetch(`/api/tests`, { credentials: "include" });
        if (!testRes.ok) throw new Error("Failed to fetch tests");
        const tests = await testRes.json();
        const test = tests.find((t: Test) => t.id === testId);
        
        if (!test) {
          throw new Error("Test not found");
        }

        setTestInfo(test);
        setTestMode(test.mode || "standard");

        if (test.mode === "adaptive") {
          await startAdaptiveAttempt();
        } else {
          await startStandardAttempt();
        }
      } catch (err) {
        console.error("Init test error:", err);
        toast({
          variant: "destructive",
          title: t.common.error,
          description: t.common.failedToStartTest,
        });
        navigate("/learner");
      } finally {
        setIsStarting(false);
      }
    };

    initTest();
  }, [testId]);

  // Standard attempt start
  const startStandardAttempt = async () => {
    const res = await fetch(`/api/tests/${testId}/attempts/start`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to start attempt");
    const data = await res.json();
    setAttempt(data);

    const variant = data.variantJson as any;
    const questions: FlatQuestion[] = [];
    const mappings: Record<string, any> = {};
    let idx = 0;

    for (const section of variant.sections) {
      for (const qId of section.questionIds) {
        const question = data.questions.find((q: Question) => q.id === qId);
        if (question) {
          questions.push({
            question,
            topicName: section.topicName,
            index: idx++,
          });

          // Generate shuffle mappings
          if (question.shuffleAnswers !== false) {
            const qData = question.dataJson as any;
            
            if (question.type === "single" || question.type === "multiple") {
              const optCount = qData.options?.length || 0;
              if (optCount > 0) {
                mappings[question.id] = createShuffleMapping(optCount);
              }
            } else if (question.type === "matching") {
              const leftCount = qData.left?.length || 0;
              const rightCount = qData.right?.length || 0;
              if (leftCount > 0 && rightCount > 0) {
                mappings[question.id] = {
                  left: createShuffleMapping(leftCount),
                  right: createShuffleMapping(rightCount),
                };
              }
            } else if (question.type === "ranking") {
              const itemCount = qData.items?.length || 0;
              if (itemCount > 0) {
                mappings[question.id] = createShuffleMapping(itemCount);
              }
            }
          }
        }
      }
    }

    setFlatQuestions(questions);
    setShuffleMappings(mappings);
  };

  // Adaptive attempt start
  const startAdaptiveAttempt = async () => {
    const res = await fetch(`/api/tests/${testId}/attempts/start-adaptive`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) throw new Error("Failed to start adaptive attempt");
    const data = await res.json();

    setAdaptiveState({
      attemptId: data.attemptId,
      testTitle: data.testTitle,
      showDifficultyLevel: data.showDifficultyLevel,
      currentQuestion: data.currentQuestion,
      totalTopics: data.totalTopics,
      currentTopicIndex: data.currentTopicIndex,
      answer: null,
      lastResult: null,
      isFinished: false,
      result: null,
      questionsAnswered: 0,
    });
  };

  // Standard mode handlers
  const handleAnswer = (questionId: string, answer: any) => {
    setAnswers((prev) => ({ ...prev, [questionId]: answer }));
  };

  const handleNext = () => {
    const currentQ = flatQuestions[currentIndex];
    const currentAnswer = answers[currentQ.question.id];

    if (currentAnswer === undefined || currentAnswer === null) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, ответьте на вопрос перед продолжением",
      });
      return;
    }

    if (currentQ.question.type === "multiple" && Array.isArray(currentAnswer) && currentAnswer.length === 0) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, выберите хотя бы один вариант ответа",
      });
      return;
    }

    if (currentQ.question.type === "matching") {
      const data = currentQ.question.dataJson as any;
      const leftItems = data.left || [];
      const pairs = currentAnswer || {};
      
      for (let i = 0; i < leftItems.length; i++) {
        if (pairs[i] === undefined || pairs[i] === null) {
          toast({
            variant: "destructive",
            title: "Требуется ответ",
            description: "Пожалуйста, сопоставьте все элементы",
          });
          return;
        }
      }
    }

    setCurrentIndex((i) => Math.min(flatQuestions.length - 1, i + 1));
  };

  const handleSubmit = async () => {
    if (!attempt) return;

    const unansweredQuestions = flatQuestions.filter(
      (fq) => answers[fq.question.id] === undefined || answers[fq.question.id] === null
    );

    if (unansweredQuestions.length > 0) {
      toast({
        variant: "destructive",
        title: "Не все вопросы отвечены",
        description: `Осталось ${unansweredQuestions.length} вопросов без ответа.`,
      });
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/attempts/${attempt.id}/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ answers }),
      });

      if (!res.ok) throw new Error("Failed to submit");
      navigate(`/learner/result/${attempt.id}`);
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Ошибка отправки",
        description: "Не удалось отправить ответы",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Adaptive mode handlers
  const handleAdaptiveAnswer = (answer: any) => {
    if (!adaptiveState) return;
    setAdaptiveState({ ...adaptiveState, answer });
  };

  const handleAdaptiveSubmit = async () => {
    if (!adaptiveState || !adaptiveState.currentQuestion || adaptiveState.answer === null) {
      toast({
        variant: "destructive",
        title: "Требуется ответ",
        description: "Пожалуйста, ответьте на вопрос",
      });
      return;
    }

    setIsAnswering(true);
    try {
      const res = await fetch(`/api/attempts/${adaptiveState.attemptId}/answer-adaptive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          questionId: adaptiveState.currentQuestion.id,
          answer: adaptiveState.answer,
        }),
      });

      if (!res.ok) throw new Error("Failed to submit answer");
      const data = await res.json();

      // Show transition if level changed
      if (data.levelTransition || data.topicTransition) {
        setShowTransition(true);
        setAdaptiveState({
          ...adaptiveState,
          lastResult: {
            isCorrect: data.isCorrect,
            correctAnswer: data.correctAnswer,
            feedback: data.feedback,
            levelTransition: data.levelTransition,
            topicTransition: data.topicTransition,
          },
          questionsAnswered: adaptiveState.questionsAnswered + 1,
        });

        // Auto-continue after delay
        setTimeout(() => {
          setShowTransition(false);
          if (data.isFinished) {
            setAdaptiveState(prev => prev ? {
              ...prev,
              isFinished: true,
              result: data.result,
              currentQuestion: null,
            } : null);
          } else {
            setAdaptiveState(prev => prev ? {
              ...prev,
              currentQuestion: data.nextQuestion,
              currentTopicIndex: data.topicTransition 
                ? prev.currentTopicIndex + 1 
                : prev.currentTopicIndex,
              answer: null,
              lastResult: null,
            } : null);
          }
        }, 2500);
      } else {
        // No transition, just move to next question
        if (data.isFinished) {
          setAdaptiveState({
            ...adaptiveState,
            isFinished: true,
            result: data.result,
            currentQuestion: null,
            questionsAnswered: adaptiveState.questionsAnswered + 1,
          });
        } else {
          setAdaptiveState({
            ...adaptiveState,
            currentQuestion: data.nextQuestion,
            answer: null,
            lastResult: data.isCorrect !== undefined ? {
              isCorrect: data.isCorrect,
              correctAnswer: data.correctAnswer,
              feedback: data.feedback,
            } : null,
            questionsAnswered: adaptiveState.questionsAnswered + 1,
          });
        }
      }
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Ошибка",
        description: "Не удалось отправить ответ",
      });
    } finally {
      setIsAnswering(false);
    }
  };

  // Loading state
  if (isStarting || testMode === null) {
    return <LoadingState message={t.common.preparingTest} />;
  }

  // Adaptive mode - finished
  if (testMode === "adaptive" && adaptiveState?.isFinished) {
    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <Card>
            <CardHeader className="text-center">
              <Trophy className="h-16 w-16 mx-auto text-primary mb-4" />
              <CardTitle className="text-2xl">Тест завершён!</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              {adaptiveState.result?.topicResults?.map((tr: any, idx: number) => (
                <div key={idx} className="p-4 rounded-lg border">
                  <h3 className="font-semibold text-lg">{tr.topicName}</h3>
                  <div className="mt-2 space-y-2">
                    {tr.achievedLevelName ? (
                      <div className="flex items-center gap-2">
                        <Badge variant="default" className="bg-green-600">
                          {tr.achievedLevelName}
                        </Badge>
                        <span className="text-sm text-muted-foreground">
                          ({Math.round(tr.levelPercent)}% правильных)
                        </span>
                      </div>
                    ) : (
                      <Badge variant="destructive">Уровень не достигнут</Badge>
                    )}
                    <p className="text-sm text-muted-foreground">
                      Вопросов: {tr.totalQuestionsAnswered}, правильных: {tr.totalCorrect}
                    </p>
                    {tr.feedback && (
                      <p className="text-sm mt-2 p-2 bg-muted rounded">{tr.feedback}</p>
                    )}
                    {tr.recommendedLinks?.length > 0 && (
                      <div className="mt-2">
                        <p className="text-sm font-medium">Рекомендуемые материалы:</p>
                        <ul className="list-disc list-inside text-sm">
                          {tr.recommendedLinks.map((link: any, i: number) => (
                            <li key={i}>
                              <a href={link.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                                {link.title}
                              </a>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              <Button className="w-full" onClick={() => navigate("/learner")}>
                Вернуться к списку тестов
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Adaptive mode - transition screen
  if (testMode === "adaptive" && showTransition && adaptiveState?.lastResult) {
    const { levelTransition, topicTransition, isCorrect } = adaptiveState.lastResult;
    
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md w-full mx-4">
          <CardContent className="pt-6 text-center space-y-4">
            {isCorrect ? (
              <CheckCircle className="h-16 w-16 mx-auto text-green-500" />
            ) : (
              <XCircle className="h-16 w-16 mx-auto text-red-500" />
            )}
            
            <p className="text-lg font-medium">
              {isCorrect ? "Правильно!" : "Неправильно"}
            </p>

            {levelTransition && (
              <Alert className={levelTransition.type === "up" ? "border-green-500" : levelTransition.type === "down" ? "border-red-500" : "border-primary"}>
                <div className="flex items-center gap-2">
                  {levelTransition.type === "up" && <ArrowUp className="h-5 w-5 text-green-500" />}
                  {levelTransition.type === "down" && <ArrowDown className="h-5 w-5 text-red-500" />}
                  {levelTransition.type === "complete" && <Target className="h-5 w-5 text-primary" />}
                  <AlertDescription>{levelTransition.message}</AlertDescription>
                </div>
              </Alert>
            )}

            {topicTransition && (
              <p className="text-sm text-muted-foreground">
                Переход к теме: <span className="font-medium">{topicTransition.toTopic}</span>
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  // Adaptive mode - question
  if (testMode === "adaptive" && adaptiveState?.currentQuestion) {
    const { currentQuestion, showDifficultyLevel, testTitle, questionsAnswered } = adaptiveState;

    return (
      <div className="min-h-screen bg-background">
        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold">{testTitle}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Вопрос {currentQuestion.questionNumber} из {currentQuestion.totalInLevel}
                {showDifficultyLevel && (
                  <span className="ml-2">• Уровень: <Badge variant="outline">{currentQuestion.levelName}</Badge></span>
                )}
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              Тема: <span className="font-medium text-foreground">{currentQuestion.topicName}</span>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">
                {currentQuestion.question.prompt}
              </CardTitle>
              {currentQuestion.question.mediaUrl && currentQuestion.question.mediaType && (
                <div className="mt-4">
                  {currentQuestion.question.mediaType === "image" && (
                    <img
                      src={currentQuestion.question.mediaUrl}
                      alt="Изображение к вопросу"
                      className="max-h-64 object-contain mx-auto rounded-md"
                    />
                  )}
                  {currentQuestion.question.mediaType === "audio" && (
                    <audio controls className="w-full">
                      <source src={currentQuestion.question.mediaUrl} />
                    </audio>
                  )}
                  {currentQuestion.question.mediaType === "video" && (
                    <video controls className="max-h-64 w-full rounded-md">
                      <source src={currentQuestion.question.mediaUrl} />
                    </video>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent>
              <QuestionInput
                question={currentQuestion.question}
                answer={adaptiveState.answer}
                onAnswer={handleAdaptiveAnswer}
                shuffleMapping={null}
              />
            </CardContent>
          </Card>

          <div className="flex justify-end mt-8">
            <Button
              onClick={handleAdaptiveSubmit}
              disabled={isAnswering || adaptiveState.answer === null}
            >
              {isAnswering ? "Отправка..." : "Ответить"}
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Standard mode
  if (testMode === "standard" && attempt && flatQuestions.length > 0) {
    const currentQ = flatQuestions[currentIndex];
    const progress = ((currentIndex + 1) / flatQuestions.length) * 100;

    return (
      <div className="min-h-screen bg-background">
        <div className="fixed top-0 left-0 right-0 h-2 bg-muted z-50">
          <Progress value={progress} className="h-2" />
        </div>

        <div className="max-w-3xl mx-auto px-6 py-12">
          <div className="flex items-center justify-between mb-8">
            <div>
              <h1 className="text-xl font-semibold">{attempt.testTitle}</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Вопрос {currentIndex + 1} из {flatQuestions.length}
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              Тема: <span className="font-medium text-foreground">{currentQ.topicName}</span>
            </div>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg font-medium">{currentQ.question.prompt}</CardTitle>
              {currentQ.question.mediaUrl && currentQ.question.mediaType && (
                <div className="mt-4">
                  {currentQ.question.mediaType === "image" && (
                    <img
                      src={currentQ.question.mediaUrl}
                      alt="Изображение"
                      className="max-h-64 object-contain mx-auto rounded-md"
                    />
                  )}
                  {currentQ.question.mediaType === "audio" && (
                    <audio controls className="w-full">
                      <source src={currentQ.question.mediaUrl} />
                    </audio>
                  )}
                  {currentQ.question.mediaType === "video" && (
                    <video controls className="max-h-64 w-full rounded-md">
                      <source src={currentQ.question.mediaUrl} />
                    </video>
                  )}
                </div>
              )}
            </CardHeader>
            <CardContent>
              <QuestionInput
                question={currentQ.question}
                answer={answers[currentQ.question.id]}
                onAnswer={(answer) => handleAnswer(currentQ.question.id, answer)}
                shuffleMapping={shuffleMappings[currentQ.question.id]}
              />
            </CardContent>
          </Card>

          <div className="flex items-center justify-between mt-8">
            <Button
              variant="outline"
              onClick={() => setCurrentIndex((i) => Math.max(0, i - 1))}
              disabled={currentIndex === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Назад
            </Button>

            {currentIndex === flatQuestions.length - 1 ? (
              <Button onClick={handleSubmit} disabled={isSubmitting}>
                {isSubmitting ? "Отправка..." : "Завершить тест"}
                <CheckCircle className="h-4 w-4 ml-2" />
              </Button>
            ) : (
              <Button onClick={handleNext}>
                Далее
                <ChevronRight className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <LoadingState message={t.common.preparingTest} />;
}

// ==================== Question Input Component ====================

interface QuestionInputProps {
  question: Question;
  answer: any;
  onAnswer: (answer: any) => void;
  shuffleMapping?: any;
}

function QuestionInput({ question, answer, onAnswer, shuffleMapping }: QuestionInputProps) {
  const data = question.dataJson as any;

  // Single choice
  if (question.type === "single") {
    const options = data.options || [];
    const displayOrder = shuffleMapping || options.map((_: any, i: number) => i);

    return (
      <RadioGroup
        value={answer !== undefined && answer !== null ? String(answer) : ""}
        onValueChange={(val) => onAnswer(Number(val))}
        className="space-y-3"
      >
        {displayOrder.map((originalIndex: number, displayIndex: number) => (
          <div
            key={displayIndex}
            className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors cursor-pointer ${
              answer === originalIndex ? "border-primary bg-primary/5" : "border-border hover:border-primary/50"
            }`}
            onClick={() => onAnswer(originalIndex)}
          >
            <RadioGroupItem value={String(originalIndex)} id={`opt-${question.id}-${displayIndex}`} />
            <Label htmlFor={`opt-${question.id}-${displayIndex}`} className="flex-1 cursor-pointer">
              {options[originalIndex]}
            </Label>
          </div>
        ))}
      </RadioGroup>
    );
  }

  // Multiple choice
  if (question.type === "multiple") {
    const options = data.options || [];
    const displayOrder = shuffleMapping || options.map((_: any, i: number) => i);
    const selected: number[] = answer || [];

    const toggle = (originalIdx: number) => {
      if (selected.includes(originalIdx)) {
        onAnswer(selected.filter((i) => i !== originalIdx));
      } else {
        onAnswer([...selected, originalIdx]);
      }
    };

    return (
      <div className="space-y-3">
        {displayOrder.map((originalIndex: number, displayIndex: number) => (
          <div
            key={displayIndex}
            className={`flex items-center space-x-3 p-4 rounded-lg border transition-colors cursor-pointer select-none ${
              selected.includes(originalIndex)
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/50"
            }`}
            onClick={() => toggle(originalIndex)}
          >
            <Checkbox 
              checked={selected.includes(originalIndex)} 
              className="pointer-events-none"
            />
            <span className="flex-1">
              {options[originalIndex]}
            </span>
          </div>
        ))}
      </div>
    );
  }

  // Matching with DnD
  if (question.type === "matching") {
    return (
      <MatchingQuestion
        question={question}
        answer={answer}
        onAnswer={onAnswer}
        shuffleMapping={shuffleMapping}
      />
    );
  }

  // Ranking with DnD
  if (question.type === "ranking") {
    return (
      <RankingQuestion
        question={question}
        answer={answer}
        onAnswer={onAnswer}
        shuffleMapping={shuffleMapping}
      />
    );
  }

  return <div>Неизвестный тип вопроса</div>;
}

// ==================== Matching Question with DnD (SCORM style) ====================

interface MatchingQuestionProps {
  question: Question;
  answer: any;
  onAnswer: (answer: any) => void;
  shuffleMapping?: any;
}

function MatchingQuestion({ question, answer, onAnswer, shuffleMapping }: MatchingQuestionProps) {
  const data = question.dataJson as any;
  const leftItems = data.left || [];
  const rightItems = data.right || [];
  
  const leftMapping = shuffleMapping?.left || leftItems.map((_: any, i: number) => i);
  const rightMapping = shuffleMapping?.right || rightItems.map((_: any, i: number) => i);
  
  const pairs: Record<number, number> = answer || {};
  
  // Build rightToLeft mapping
  const rightToLeft: Record<number, number> = {};
  Object.keys(pairs).forEach(k => {
    const leftIdx = parseInt(k);
    const rightIdx = pairs[leftIdx];
    if (typeof rightIdx === 'number') {
      rightToLeft[rightIdx] = leftIdx;
    }
  });

  // Build pool - left items not yet matched, in leftMapping order
  const usedLeft = new Set(Object.keys(pairs).map(k => parseInt(k)));
  const pool = leftMapping.filter((idx: number) => !usedLeft.has(idx));

  const [draggedItem, setDraggedItem] = useState<{ 
    leftIdx: number; 
    from: 'pool' | 'matched'; 
    fromRightIdx?: number;
    poolIndex?: number;
  } | null>(null);
  const [dragOverTarget, setDragOverTarget] = useState<string | null>(null);

  const handleDragStart = (
    e: React.DragEvent, 
    leftIdx: number, 
    from: 'pool' | 'matched', 
    fromRightIdx?: number,
    poolIndex?: number
  ) => {
    setDraggedItem({ leftIdx, from, fromRightIdx, poolIndex });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverTarget(null);
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverTarget(targetId);
  };

  const handleDragLeave = () => {
    setDragOverTarget(null);
  };

  const handleDropOnRight = (e: React.DragEvent, targetRightIdx: number) => {
    e.preventDefault();
    if (!draggedItem) return;

    const newPairs = { ...pairs };
    
    // If target already has a match, it will be displaced
    const existingLeftIdx = rightToLeft[targetRightIdx];
    
    // Remove dragged item from its previous position
    if (draggedItem.from === 'matched' && draggedItem.fromRightIdx !== undefined) {
      delete newPairs[draggedItem.leftIdx];
    }

    // If there was something in target slot, remove it (it goes back to pool)
    if (existingLeftIdx !== undefined && existingLeftIdx !== draggedItem.leftIdx) {
      delete newPairs[existingLeftIdx];
    }

    // Add new match
    newPairs[draggedItem.leftIdx] = targetRightIdx;
    
    onAnswer(newPairs);
    setDraggedItem(null);
    setDragOverTarget(null);
  };

  const handleDropOnPool = (e: React.DragEvent, targetPoolSlot: number) => {
    e.preventDefault();
    if (!draggedItem || draggedItem.from !== 'matched') return;

    // Remove from matched pairs - it will appear in pool automatically
    const newPairs = { ...pairs };
    delete newPairs[draggedItem.leftIdx];
    onAnswer(newPairs);
    
    setDraggedItem(null);
    setDragOverTarget(null);
  };

  const handleDoubleClick = (leftIdx: number) => {
    // Return to pool on double click
    const newPairs = { ...pairs };
    delete newPairs[leftIdx];
    onAnswer(newPairs);
  };

  // Track pool slot index
  let poolSlot = 0;

  return (
    <div className="space-y-3">
      {rightMapping.map((rightIdx: number, displayIdx: number) => {
        const matchedLeftIdx = rightToLeft[rightIdx];
        const isJoined = matchedLeftIdx !== undefined;
        const currentPoolSlot = poolSlot;
        const poolLeftIdx = !isJoined && poolSlot < pool.length ? pool[poolSlot] : null;
        
        if (!isJoined) {
          poolSlot++;
        }

        const leftTargetId = `left-${rightIdx}`;
        const rightTargetId = `right-${rightIdx}`;

        // When joined - render as single merged block
        if (isJoined) {
          return (
            <div 
              key={displayIdx} 
              className="flex items-stretch"
            >
              {/* MERGED BLOCK - Left chip + Right text */}
              <div
                className="flex-1 min-h-[56px] rounded-lg border border-border bg-card flex items-stretch overflow-hidden"
                onDragOver={(e) => handleDragOver(e, rightTargetId)}
                onDragLeave={handleDragLeave}
                onDrop={(e) => handleDropOnRight(e, rightIdx)}
              >
                {/* Left part - draggable chip */}
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, matchedLeftIdx, 'matched', rightIdx)}
                  onDragEnd={handleDragEnd}
                  onDoubleClick={() => handleDoubleClick(matchedLeftIdx)}
                  className="min-w-[120px] px-4 py-3 bg-primary text-primary-foreground flex items-center justify-center cursor-grab active:cursor-grabbing select-none font-medium"
                  title="Дважды щёлкните, чтобы вернуть"
                >
                  {leftItems[matchedLeftIdx]}
                </div>
                {/* Right part - text */}
                <div className="flex-1 px-4 py-3 flex items-center">
                  <span className="text-sm">
                    {rightItems[rightIdx]}
                  </span>
                </div>
              </div>
            </div>
          );
        }

        // Not joined - separate blocks
        return (
          <div 
            key={displayIdx} 
            className="flex items-stretch gap-3"
          >
            {/* LEFT SIDE - Slot with draggable chip */}
            <div
              className={`flex-1 min-h-[56px] rounded-lg border transition-all flex items-center px-3 ${
                dragOverTarget === leftTargetId
                  ? 'border-primary border-2 bg-primary/5' 
                  : 'border-border bg-card'
              }`}
              onDragOver={(e) => handleDragOver(e, leftTargetId)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnPool(e, currentPoolSlot)}
            >
              {poolLeftIdx !== null ? (
                // Pool item - chip style
                <div
                  draggable
                  onDragStart={(e) => handleDragStart(e, poolLeftIdx, 'pool', undefined, currentPoolSlot)}
                  onDragEnd={handleDragEnd}
                  className="px-4 py-2 bg-primary text-primary-foreground rounded-md cursor-grab active:cursor-grabbing select-none font-medium hover:bg-primary/90 transition-colors"
                >
                  {leftItems[poolLeftIdx]}
                </div>
              ) : (
                // Empty slot placeholder
                <span className="text-muted-foreground text-sm">Перетащите вариант</span>
              )}
            </div>

            {/* ARROW */}
            <div className="w-8 flex items-center justify-center text-muted-foreground">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M5 12h14M13 5l7 7-7 7" />
              </svg>
            </div>

            {/* RIGHT SIDE - Drop target with text */}
            <div
              className={`flex-1 min-h-[56px] rounded-lg border transition-all flex items-center px-4 ${
                dragOverTarget === rightTargetId
                  ? 'border-primary border-2 bg-primary/5' 
                  : 'border-border bg-muted/30'
              }`}
              onDragOver={(e) => handleDragOver(e, rightTargetId)}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDropOnRight(e, rightIdx)}
            >
              <span className="text-sm">
                {rightItems[rightIdx]}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ==================== Ranking Question with DnD ====================

interface RankingQuestionProps {
  question: Question;
  answer: any;
  onAnswer: (answer: any) => void;
  shuffleMapping?: any;
}

function RankingQuestion({ question, answer, onAnswer, shuffleMapping }: RankingQuestionProps) {
  const data = question.dataJson as any;
  const items = data.items || [];
  
  // Initialize order from answer or shuffle mapping
  const initialOrder = shuffleMapping || items.map((_: any, i: number) => i);
  const order: number[] = answer || initialOrder;

  // Set initial answer if not set
  useEffect(() => {
    if (answer === undefined || answer === null) {
      onAnswer(initialOrder);
    }
  }, []);

  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDraggedIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (draggedIndex === null || draggedIndex === targetIndex) return;

    const newOrder = [...order];
    const [draggedItem] = newOrder.splice(draggedIndex, 1);
    newOrder.splice(targetIndex, 0, draggedItem);
    
    onAnswer(newOrder);
    setDraggedIndex(null);
    setDragOverIndex(null);
  };

  const moveItem = (fromIndex: number, toIndex: number) => {
    if (toIndex < 0 || toIndex >= order.length) return;
    
    const newOrder = [...order];
    const [item] = newOrder.splice(fromIndex, 1);
    newOrder.splice(toIndex, 0, item);
    onAnswer(newOrder);
  };

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Расположите элементы в правильном порядке (перетаскивайте или используйте стрелки)
      </p>
      
      {order.map((itemIdx, position) => (
        <div
          key={`${itemIdx}-${position}`}
          draggable
          onDragStart={(e) => handleDragStart(e, position)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, position)}
          onDrop={(e) => handleDrop(e, position)}
          className={`flex items-center gap-3 p-4 rounded-lg border bg-card transition-all cursor-grab active:cursor-grabbing ${
            draggedIndex === position 
              ? 'opacity-50 border-primary' 
              : dragOverIndex === position 
                ? 'border-primary bg-primary/5' 
                : 'border-border hover:border-primary/50'
          }`}
        >
          {/* Drag handle */}
          <GripVertical className="h-5 w-5 text-muted-foreground shrink-0" />
          
          {/* Position number */}
          <span className="text-sm font-bold w-6 text-muted-foreground">{position + 1}.</span>
          
          {/* Item text */}
          <span className="flex-1">{items[itemIdx]}</span>
          
          {/* Arrow buttons */}
          <div className="flex flex-col gap-0.5">
            <button
              type="button"
              onClick={() => moveItem(position, position - 1)}
              disabled={position === 0}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => moveItem(position, position + 1)}
              disabled={position === order.length - 1}
              className="p-1 text-muted-foreground hover:text-foreground disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}