/**
 * @module features/tests/editor/sections/tab-rail
 * @description Rail shell shared by the editor tabs (план «перестройка редактора», Э3.1).
 *
 * До перестройки рейл был у «Настроек» и у «Оформления», и каждый рисовал разметку сам.
 * Теперь рейл есть почти у каждой вкладки, поэтому разметка `ou-drawer__split` + пункты
 * живут в одном месте: вкладка объявляет ПУНКТЫ и рисует активную панель, а не повторяет
 * навигацию.
 *
 * Компонент намеренно ничего не знает о модели теста: пункты и точки состояния вкладка
 * считает сама — только она знает, что для неё ошибка, а что замечание.
 */
import { useMemo, useState } from "react";
import type * as React from "react";

/** Состояние пункта рейла: точка справа от подписи. */
export type RailDot = "error" | "warning";

/** Один пункт рейла. */
export type RailItem<K extends string> = {
  key: K;
  label: string;
  /** Точка состояния; отсутствует — пункт чистый. */
  dot?: RailDot;
  /** Пункт виден, но недоступен (например, шаблон не прочитался). */
  disabled?: boolean;
};

export type TabRailProps<K extends string> = {
  /** Пункты в порядке показа. Пустой список рисует только область содержимого. */
  items: RailItem<K>[];
  /** Активный пункт; если его нет в списке, берётся первый. */
  active: K;
  onChange: (key: K) => void;
  /** `aria-label` навигации: «Подразделы правил прохождения» и т. п. */
  ariaLabel: string;
  /**
   * Префикс `data-testid`: пункты получают `<prefix>-rail-<key>`, область содержимого —
   * `<prefix>-pane-<key>`. Прежние идентификаторы «Настроек» и «Оформления» так и
   * сохраняются, поэтому приёмочные проверки не переписываются вслед за переездом.
   */
  testIdPrefix: string;
  children: React.ReactNode;
};

/**
 * Рейл вкладки: колонка пунктов слева, панель справа.
 */
export function TabRail<K extends string>({
  items,
  active,
  onChange,
  ariaLabel,
  testIdPrefix,
  children,
}: TabRailProps<K>): React.JSX.Element {
  const effective = items.some((i) => i.key === active) ? active : (items[0]?.key ?? active);
  return (
    <div className="ou-drawer__split" data-testid={`${testIdPrefix}-split`}>
      <nav className="ou-drawer__rail" aria-label={ariaLabel}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            className={"ou-drawer__rail-item" + (effective === item.key ? " is-active" : "")}
            aria-current={effective === item.key ? "page" : undefined}
            aria-disabled={item.disabled ? "true" : undefined}
            disabled={item.disabled}
            onClick={item.disabled ? undefined : () => onChange(item.key)}
            data-testid={`${testIdPrefix}-rail-${item.key}`}
          >
            {item.label}
            {item.dot === "error" && (
              <span className="tb-status-dot tb-status-dot--err" aria-label="Ошибка" />
            )}
            {item.dot === "warning" && (
              <span
                className="tb-status-dot tb-status-dot--warn"
                aria-label="Требует внимания"
              />
            )}
          </button>
        ))}
      </nav>
      <div className="tb-settings-content" data-testid={`${testIdPrefix}-pane-${effective}`}>
        {children}
      </div>
    </div>
  );
}

/**
 * Активный пункт рейла с оглядкой на видимость: пункт мог исчезнуть (адаптивный режим
 * выключили), и тогда вкладка обязана вернуться на первый, а не показать пустоту.
 */
export function useRailState<K extends string>(
  items: RailItem<K>[],
  initial: K,
): [K, (key: K) => void] {
  const [active, setActive] = useState<K>(initial);
  const effective = useMemo(
    () => (items.some((i) => i.key === active) ? active : (items[0]?.key ?? active)),
    [items, active],
  );
  return [effective, setActive];
}
