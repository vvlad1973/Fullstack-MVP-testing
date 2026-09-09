/**
 * @module shared/template/scale-bars
 *
 * Линейчатая диаграмма шкал: горизонтальные столбики всех шкал в ОДНОЙ фигуре, с числом
 * у каждого. Печатается вместо списка карточек и уживается с розой или радаром рядом —
 * это другой способ показать те же шкалы, а не другая диаграмма.
 *
 * Зачем отдельный модуль, если карточка-градусник рисует такой же столбик: у карточек нет
 * и не может быть ОБЩЕЙ оси. Каждая масштабируется доменом своей шкалы, поэтому «27 из 45»
 * и «30 из 98» дают почти одинаковую длину, а профиль читается ровно по сравнению шкал
 * между собой. Ось здесь одна на всю фигуру, и решить это можно только видя весь список —
 * то есть выше карточки.
 *
 * Числа при этом остаются НЕ нормированными: столбик приводится к общей оси, а печатается
 * сырой балл методики. Проценты были бы вторым, не существующим у методики показателем.
 *
 * Чистый — ни DOM, ни Node; бандлится в SCORM-пакет как есть.
 */

import { measureBarColor, type CtxMeasureView } from "./measure-view";
import type { HslTriple, LevelRamp } from "./level-ramp";
import type { ScaleInterpretation, IndicatorInterpretation } from "../scales/interpretation";

/** Одна строка диаграммы: имя, столбик, число. */
export interface CtxScaleBar {
  key: string;
  name: string;
  /** Печатается ли имя — тумблер слота карточки (PRD-49) действует и здесь. */
  hideName?: boolean;
  /** Балл как число: «21». */
  valueText: string;
  /** Балл с максимумом, когда автор его показывает: «21 из 98», иначе «21». */
  valueLabel: string;
  /** Печатать ли число: скрытое значение (видимость «уровень») его не раскрывает. */
  showValue: boolean;
  /** Длина столбика в процентах ОБЩЕЙ оси. */
  widthPercent: number;
  /** Цвет столбика — HSL-тройка, как везде в оформлении (`hsl(var(--tb-zone))`). */
  color: HslTriple;
  /** Метка уровня, когда методика её даёт и автор её показывает. */
  levelLabel: string;
  hideLevel?: boolean;
  toneClass: string;
}

/** Диаграмма целиком. `null` — печатать нечего, список карточек остаётся за старшего. */
export interface CtxScaleBars {
  rows: CtxScaleBar[];
  /** Подписи краёв общей оси. */
  axisMinText: string;
  axisMaxText: string;
  ariaLabel: string;
}

/** Мера с её интерпретацией — то же, что читает карточка. */
export interface ScaleBarInput {
  key: string;
  name: string;
  value: number | string | boolean | null | undefined;
  interpretation: ScaleInterpretation | IndicatorInterpretation;
  /** Цвет шкалы из «Оформления шкал», если автор его задал. */
  color?: HslTriple;
}

export interface ScaleBarsInput {
  /** Меры в порядке печати. Карточки уже построены — из них берутся готовые надписи. */
  measures: ScaleBarInput[];
  /** Карточки тех же мер, той же длины и в том же порядке. */
  views: CtxMeasureView[];
  ramp: LevelRamp;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/**
 * Верхняя граница оси меры: объявленный автором предел рисунка, иначе домен. Тот же выбор
 * делает роза для длины луча (`displayMax`), поэтому шкала, укороченная автором на розе,
 * укорачивается и здесь — две фигуры одного экрана не должны спорить о масштабе.
 */
function axisTopOf(interpretation: ScaleInterpretation | IndicatorInterpretation): number | null {
  const declared = (interpretation as ScaleInterpretation).displayMax;
  if (typeof declared === "number" && Number.isFinite(declared)) return declared;
  return interpretation.domainMax;
}

/**
 * Построить диаграмму, или `null`, когда её не из чего собрать.
 *
 * Отказ — не ошибка, а обычный ход: у методики может не быть домена ни у одной шкалы, и
 * тогда откладывать столбики не от чего. Макет в этом случае печатает карточки, как раньше.
 *
 * В диаграмму попадают только меры С ДОМЕНОМ. Мера без него осталась бы строкой без
 * столбика — то есть числом, притворяющимся диаграммой; её печатает карточка-фолбэк, куда
 * её и отправил откат вида ({@link module:shared/template/measure-view resolveRenderKind}).
 */
export function buildScaleBars(input: ScaleBarsInput): CtxScaleBars | null {
  const rows: CtxScaleBar[] = [];
  const tops: number[] = [];
  const bottoms: number[] = [];

  input.measures.forEach((m, i) => {
    const view = input.views[i];
    if (!view) return;
    const top = axisTopOf(m.interpretation);
    const bottom = m.interpretation.domainMin;
    if (top === null || bottom === null || typeof m.value !== "number" || !Number.isFinite(m.value)) return;
    tops.push(top);
    bottoms.push(bottom);
  });
  if (!tops.length) return null;

  // Одна ось на фигуру: нижний край — самый низкий из доменов, верхний — самый высокий.
  // Не среднее и не отдельная ось на строку: ось, разная у соседних столбиков, снимает
  // единственное, ради чего диаграмму строят.
  const axisMin = Math.min(...bottoms);
  const axisMax = Math.max(...tops);
  const span = axisMax - axisMin;
  if (!(span > 0)) return null;

  input.measures.forEach((m, i) => {
    const view = input.views[i];
    if (!view) return;
    const top = axisTopOf(m.interpretation);
    if (top === null || m.interpretation.domainMin === null) return;
    if (typeof m.value !== "number" || !Number.isFinite(m.value)) return;
    const ratio = (m.value - axisMin) / span;
    const clamped = ratio < 0 ? 0 : ratio > 1 ? 1 : ratio;
    // Цвет — от положения в СВОЁМ домене, а не на общей оси: он говорит об уровне шкалы,
    // и на общей оси высокий балл короткой шкалы выглядел бы низким.
    const ownSpan = top - m.interpretation.domainMin;
    const ownRatio = ownSpan > 0 ? (m.value - m.interpretation.domainMin) / ownSpan : 0;
    rows.push({
      key: m.key,
      name: m.name,
      ...(view.hideName ? { hideName: true } : {}),
      valueText: view.valueText,
      valueLabel: view.valueLabel,
      showValue: view.showValue,
      widthPercent: round1(clamped * 100),
      color: measureBarColor(
        m.interpretation.valence,
        input.ramp,
        m.color,
        ownRatio < 0 ? 0 : ownRatio > 1 ? 1 : ownRatio,
      ),
      levelLabel: view.levelLabel,
      ...(view.hideLevel ? { hideLevel: true } : {}),
      toneClass: view.toneClass,
    });
  });
  if (!rows.length) return null;

  return {
    rows,
    axisMinText: String(round1(axisMin)),
    axisMaxText: String(round1(axisMax)),
    // Стопка полос ничего не говорит читалке сама по себе — то же соображение, что у
    // линейки в карточке: подпись собирается ядром, потому что макету не из чего.
    ariaLabel: `Шкалы на общей оси от ${round1(axisMin)} до ${round1(axisMax)}: ${rows
      .map((r) => `${r.name} — ${r.valueText}`)
      .join(", ")}`,
  };
}
