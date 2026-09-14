/**
 * @module features/analytics/test/score-distribution
 * @description PRD-56 FR-13a: распределение результатов теста.
 *
 * Цвет столбика говорит о сдаваемости корзины, поэтому подпись обязана назвать сам проходной
 * балл: без него читателю не с чем соотнести красное и зелёное. Там, где порога нет, об этом
 * сказано словами — одноцветные столбики без объяснения выглядят сломанной диаграммой, а не
 * опросником, который ничего не оценивает.
 */
import { BarChart, Card, CardBody, CardHeader, Text } from "@skillum/ui-kit";

import { pluralize } from "@/lib/i18n";

/** Корзина распределения — то, что отдаёт `GET /api/analytics/tests/:testId`. */
export interface ScoreBucketView {
  label: string;
  from: number;
  to: number;
  count: number;
  share: number;
  tone: "error" | "warning" | "success" | "neutral";
  holdsThreshold: boolean;
}

export interface ScoreDistributionProps {
  buckets: ScoreBucketView[];
  /** Сколько завершённых прохождений попало в гистограмму. */
  completed: number;
  /** Проходной балл в процентах; `null` — тест не оценивает либо порог задан в баллах. */
  thresholdPercent: number | null;
}

/** Цвет корзины — токеном дизайн-системы: тон задан расчётом, а не порядком столбика. */
const TONE_COLOR: Record<ScoreBucketView["tone"], string> = {
  error: "var(--ou-error-default)",
  warning: "var(--ou-warning-default)",
  success: "var(--ou-success-default)",
  neutral: "var(--ou-accent-default)",
};

export function ScoreDistribution({ buckets, completed, thresholdPercent }: ScoreDistributionProps) {
  const subtitle = [
    `${completed} ${pluralize(completed, "завершённое прохождение", "завершённых прохождения", "завершённых прохождений")}`,
    thresholdPercent === null
      ? "проходного балла нет: тест не выносит вердикта"
      : `проходной балл ${Math.round(thresholdPercent)} %`,
  ].join(" · ");

  return (
    <Card>
      <CardHeader title="Распределение результатов" subtitle={subtitle} />
      <CardBody>
        {completed === 0 ? (
          <Text tone="muted">Прохождений пока нет — распределять нечего.</Text>
        ) : buckets.every(bucket => bucket.count === 0) ? (
          // Прохождения были, а столбиков нет — значит у них нет результата в процентах:
          // так бывает у адаптивного теста, где итог это достигнутый уровень, и у опросника.
          // Пустая сетка без объяснения читается как поломка экрана.
          <Text tone="muted">
            У прохождений этого теста нет результата в процентах: распределять нечего.
          </Text>
        ) : (
          <BarChart
            height={260}
            categories={buckets.map(bucket => bucket.label)}
            series={[{
              id: "share",
              label: "Доля прохождений",
              data: buckets.map(bucket => Math.round(bucket.share)),
              color: TONE_COLOR.neutral,
              colors: buckets.map(bucket => TONE_COLOR[bucket.tone]),
              labels: "outside",
              labelFormat: value => `${value} %`,
            }]}
            yTickFormat={value => `${value} %`}
            // FR-13a: порог, не кратный ширине корзины, проходит ВНУТРИ столбика — и показать
            // его можно только вертикалью на своём месте. Позиция — доля шкалы 0…100 %,
            // потому что корзины покрывают её целиком и равными долями.
            xMarker={thresholdPercent === null ? undefined : {
              position: thresholdPercent / 100,
              label: `порог ${Math.round(thresholdPercent)} %`,
            }}
          />
        )}
      </CardBody>
    </Card>
  );
}
