/**
 * @module features/analytics/slices/slice-list
 * @description PRD-56 FR-06, FR-06c, FR-06d, FR-08: список срезов.
 *
 * Показывает ФАКТЫ: сколько начали, сколько дошли до конца, сколько сдали и с каким средним.
 * Отклонений от невидимой на экране величины здесь нет (FR-06c) — за сравнением ведёт отдельный
 * режим с явно названными срезами.
 *
 * Ниже порога наблюдений процент не печатается: вместо него «мало данных» и сам объём выборки
 * (FR-06d). Объём показывается всегда — «81 % из 12» и «81 % из 340» читаются по-разному.
 *
 * Разворот строки (FR-06e) отвечает на «в какой теме провал У ЭТОГО среза»: доля верных по темам
 * и объём выборки каждой темы — и ничего больше. Ни с чем не сравнивает: за сравнением ведёт
 * отдельный режим. Темы грузятся ПРИ РАЗВОРОТЕ: платить за них у всех срезов сразу незачем,
 * а развёрнут за раз один.
 */
import { useEffect, useState } from "react";

import { Button, DataGrid, Text } from "@skillum/ui-kit";

/** Срез с посчитанными величинами — то, что отдаёт `GET /api/analytics/slices`. */
export interface SliceRow {
  id: string;
  name: string;
  conditions: Record<string, unknown>;
  started: number;
  completed: number;
  passed: number;
  participants: number;
  passRate: number | null;
  avgPercent: number | null;
  enoughData: boolean;
  /**
   * Сколько людей среза получили назначение теста (FR-06). `null` — величина к этому срезу
   * неприменима: назначают человека, а срез по номеру попытки или варианту описывает попытку.
   */
  assigned?: number | null;
  /**
   * Слабейшая тема среза (FR-06): та, где доля верных ниже всех. `null` — говорить не о чем:
   * ответов нет либо ни одна тема не набрала порога наблюдений.
   */
  weakest?: SliceTopic | null;
  /** Темы среза целиком — ими сравнение сопоставляет доли верных (FR-07). */
  topics?: SliceTopic[];
}

export interface SliceListProps {
  /** Тест — рамка расчёта. Без него средние не считаются (решение 2 спеки). */
  testId: string;
  /** Период как рамка; пустой означает «за всё время» (FR-07j). */
  from?: string;
  to?: string;
  /** Ось разбиения. Без неё показываются сохранённые срезы. */
  axis?: string;
  /** Перейти в реестр с условиями среза (FR-08). */
  onOpenRegistry?: (conditions: Record<string, unknown>) => void;
}

/** Процент для чтения человеком: без десятых, которых в таких числах всё равно нет. */
function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} %`;
}

/** Тема развёрнутой строки — то, что отдаёт `GET /api/analytics/slices/topics`. */
export interface SliceTopic {
  topicId: string;
  topicName: string;
  correctShare: number | null;
  inSample: number;
}

/** Состояние разворота одной строки: пока грузится — `null`, потом список тем. */
type TopicsState = Record<string, SliceTopic[] | null>;

export function SliceList({ testId, from, to, axis, onOpenRegistry }: SliceListProps) {
  const [slices, setSlices] = useState<SliceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [topics, setTopics] = useState<TopicsState>({});

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFailed(false);

    const query = new URLSearchParams({ testId });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (axis) query.set("axis", axis);

    void (async () => {
      try {
        const response = await fetch(`/api/analytics/slices?${query.toString()}`, {
          credentials: "include",
        });
        if (!response.ok) throw new Error(String(response.status));
        const data = await response.json() as { slices: SliceRow[] };
        if (!alive) return;
        setSlices(data.slices);
      } catch {
        // Пустой список на месте ошибки читается как «данных нет» — это разные вещи, и
        // молчать о второй нельзя: по «нет данных» принимают решение, по ошибке — обновляют.
        if (alive) setFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    // Рамка сменилась — прежние темы к новой выборке отношения не имеют.
    setTopics({});
    return () => { alive = false; };
  }, [testId, from, to, axis]);

  /**
   * Темы одного среза — по требованию, при развороте.
   *
   * Срез адресуется ОСЬЮ с ключом либо идентификатором сохранённого: условия реестра покрывают
   * не всякую ось, и по ним срез не восстановить. Ключ оси лежит в идентификаторе строки
   * (`<ось>:<ключ>`) — так его собрала ручка списка.
   */
  const loadTopics = async (row: SliceRow) => {
    if (topics[row.id] !== undefined) return;
    setTopics(prev => ({ ...prev, [row.id]: null }));

    const query = new URLSearchParams({ testId });
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    if (axis) {
      query.set("axis", axis);
      query.set("key", row.id.slice(row.id.indexOf(":") + 1));
    } else {
      query.set("sliceId", row.id);
    }

    try {
      const response = await fetch(`/api/analytics/slices/topics?${query.toString()}`, {
        credentials: "include",
      });
      if (!response.ok) throw new Error(String(response.status));
      const data = await response.json() as { topics: SliceTopic[] };
      setTopics(prev => ({ ...prev, [row.id]: data.topics }));
    } catch {
      // Пустой список честнее ложных нулей: строка скажет «не удалось посчитать».
      setTopics(prev => ({ ...prev, [row.id]: [] }));
    }
  };

  if (failed) {
    return <Text tone="error">Не удалось загрузить срезы. Обновите страницу.</Text>;
  }

  const columns = [
    {
      key: "name",
      header: "Срез",
      frozen: true,
      render: (row: SliceRow) => <span className="ou-grid__cell-strong">{row.name}</span>,
    },
    {
      key: "assigned",
      header: "Назначено",
      numeric: true,
      // Прочерк здесь значит «величина к этому срезу неприменима», а не «ноль назначений»:
      // по оси вроде номера попытки назначать нечего — назначают человека (FR-27).
      render: (row: SliceRow) => (row.assigned === null || row.assigned === undefined
        ? "—"
        : row.assigned),
    },
    { key: "started", header: "Начато", numeric: true, render: (row: SliceRow) => row.started },
    {
      key: "completed",
      header: "Завершено",
      numeric: true,
      render: (row: SliceRow) => row.completed,
    },
    {
      key: "participants",
      header: "Участников",
      numeric: true,
      render: (row: SliceRow) => row.participants,
    },
    {
      key: "passRate",
      header: "Сдали",
      numeric: true,
      // «Мало данных» вместо процента — и это не то же самое, что прочерк: прочерк говорит
      // «нечего оценивать», а здесь оценивать есть что, просто выборка мала.
      render: (row: SliceRow) => (row.enoughData
        ? percent(row.passRate)
        : <Text variant="body-s" tone="muted">мало данных</Text>),
    },
    {
      key: "avgPercent",
      header: "Средний результат",
      numeric: true,
      render: (row: SliceRow) => (row.enoughData
        ? percent(row.avgPercent)
        : <Text variant="body-s" tone="muted">мало данных</Text>),
    },
    {
      key: "weakest",
      header: "Слабое место",
      // Тема названа вместе со своей долей: «Корпоративные финансы» без числа не говорит,
      // провал это или ровный результат, у которого просто кто-то обязан быть последним.
      // Прочерк здесь честен — он значит «называть слабейшую не из чего» (FR-06d).
      render: (row: SliceRow) => (row.weakest
        ? `${row.weakest.topicName}${row.weakest.correctShare === null
          ? ""
          : ` · ${Math.round(row.weakest.correctShare)} %`}`
        : "—"),
    },
    {
      key: "actions",
      header: "",
      render: (row: SliceRow) => (onOpenRegistry ? (
        <Button
          variant="ghost"
          size="s"
          onClick={() => onOpenRegistry(row.conditions)}
        >
          Прохождения: {row.name}
        </Button>
      ) : null),
    },
  ];

  return (
    <DataGrid
      columns={columns}
      rows={slices}
      rowKey={row => row.id}
      emptyMessage={loading ? "Считаем срезы…" : "Срезов пока нет"}
      expandable
      // Разворачивать нечего там, где прохождений не было: раскрытие в пустоту читается как
      // поломка, а не как «данных нет».
      canExpand={row => row.completed > 0}
      onRowExpand={row => { void loadTopics(row); }}
      renderExpanded={row => {
        const rows = topics[row.id];
        if (rows === undefined || rows === null) {
          return <Text variant="body-s" tone="muted">Считаем темы…</Text>;
        }
        if (rows.length === 0) {
          return <Text variant="body-s" tone="muted">По темам считать нечего: ответов нет</Text>;
        }
        return (
          <DataGrid
            columns={[
              {
                key: "topic",
                header: "Тема",
                render: (topic: SliceTopic) => topic.topicName,
              },
              {
                key: "correct",
                header: "Доля верных, % ответов",
                numeric: true,
                render: (topic: SliceTopic) => (topic.correctShare === null
                  ? "—"
                  : `${Math.round(topic.correctShare)} %`),
              },
              {
                key: "sample",
                header: "В выборке, прохождений",
                numeric: true,
                render: (topic: SliceTopic) => topic.inSample,
              },
            ]}
            rows={rows}
            rowKey={topic => topic.topicId}
            emptyMessage="Тем нет"
          />
        );
      }}
    />
  );
}
