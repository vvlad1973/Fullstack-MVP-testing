/**
 * @module features/analytics/registry/use-dictionaries
 * @description Справочники тестов и групп для языка условий реестра (PRD-56 FR-02).
 *
 * Условия отбора хранятся идентификаторами — их пересылают ссылкой, и они переживают
 * переименование. Но показывать идентификатор человеку нельзя: по «6e10d1e6-0fc9…» он не может
 * ни проверить отбор, ни объяснить его коллеге. Поэтому и чипы применённых условий, и окно
 * отбора берут названия отсюда — из одного места, чтобы не разошлись.
 *
 * Справочники — подсказка, а не условие работы: не загрузились — экран остаётся годным, просто
 * условие называется своим идентификатором.
 */
import { useEffect, useState } from "react";

export interface RegistryDictionaries {
  tests: Array<{ id: string; title: string }>;
  groups: Array<{ id: string; name: string }>;
}

const EMPTY: RegistryDictionaries = { tests: [], groups: [] };

/**
 * Прочитать справочники.
 *
 * @param enabled когда `false`, запросов нет: окно отбора спрашивает их только открытым.
 */
export function useRegistryDictionaries(enabled = true): RegistryDictionaries {
  const [dictionaries, setDictionaries] = useState<RegistryDictionaries>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;

    void (async () => {
      try {
        const [testsRes, groupsRes] = await Promise.all([
          fetch("/api/tests", { credentials: "include" }),
          fetch("/api/groups", { credentials: "include" }),
        ]);
        if (!alive) return;

        const tests = testsRes.ok
          ? (await testsRes.json() as Array<{ id: string; title: string }>)
            .map(test => ({ id: test.id, title: test.title }))
          : [];
        const groups = groupsRes.ok
          ? (await groupsRes.json() as Array<{ id: string; name: string }>)
            .map(group => ({ id: group.id, name: group.name }))
          : [];
        if (alive) setDictionaries({ tests, groups });
      } catch {
        // Молча: без справочников условие называется идентификатором, и это лучше, чем
        // сообщение об ошибке на экране, где отбор всё равно работает.
      }
    })();

    return () => { alive = false; };
  }, [enabled]);

  return dictionaries;
}
