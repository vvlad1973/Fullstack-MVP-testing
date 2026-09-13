/**
 * @module features/analytics/registry/use-registry-filter
 * @description PRD-56 FR-03: условия отбора реестра держатся в адресе страницы.
 *
 * Хук — единственное место, где состояние фильтра встречается с историей браузера: разбор и
 * сборка живут в чистом `filter-state`, а сюда вынесено то, что нельзя проверить без DOM.
 *
 * Замена условий пишется через `replace`, а не `push`: перебор фильтров — не путь по
 * страницам, и кнопка «назад» должна возвращать туда, откуда человек пришёл в аналитику, а не
 * прокручивать десяток промежуточных выборок.
 */
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";

import { filterToSearch, parseFilter, type RegistryFilter } from "./filter-state";

/** Условия отбора и способ их изменить. */
export function useRegistryFilter(): [RegistryFilter, (next: RegistryFilter) => void] {
  const [location] = useLocation();
  const [filter, setFilter] = useState<RegistryFilter>(
    () => parseFilter(typeof window === "undefined" ? "" : window.location.search),
  );

  // Адрес меняется и снаружи: переход по ссылке, «назад», ссылка из письма.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setFilter(parseFilter(window.location.search));
  }, [location]);

  const change = useCallback((next: RegistryFilter) => {
    setFilter(next);
    if (typeof window === "undefined") return;
    const search = filterToSearch(next);
    window.history.replaceState(null, "", `${window.location.pathname}${search}`);
  }, []);

  return [filter, change];
}
