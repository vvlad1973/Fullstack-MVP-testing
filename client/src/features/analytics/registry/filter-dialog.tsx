/**
 * @module features/analytics/registry/filter-dialog
 * @description PRD-56 FR-02: окно условий отбора реестра.
 *
 * Условия набираются целиком и применяются разом. Пять полей, меняемых по одному прямо в
 * списке, означали бы перезапрос выборки на каждый щелчок — и мигающий список под руками.
 * Поэтому окно держит СВОЙ черновик и отдаёт его наверх только по «Применить».
 *
 * Справочники тестов и групп читаются при открытии: список тестов меняется чаще, чем живёт
 * открытая вкладка аналитики.
 */
import { useEffect, useState } from "react";

import {
  Button, Checkbox, Combobox, FormField, Input, ModalDialog, Stack, Text,
} from "@skillum/ui-kit";

import {
  EMPTY_FILTER,
  type RegistryFilter,
  type RegistryOutcome,
  type RegistrySource,
} from "./filter-state";
import { useRegistryDictionaries, useTestDictionary } from "./use-dictionaries";

export interface RegistryFilterDialogProps {
  open: boolean;
  filter: RegistryFilter;
  onApply: (filter: RegistryFilter) => void;
  onClose: () => void;
  /**
   * Скрыть условие «Тест» (FR-13): на аналитике теста он задан страницей и в условия не
   * входит. Форма отбора при этом та же самая — второй формы условий в продукте нет.
   */
  hideTest?: boolean;
  /**
   * Тест, внутри которого набираются условия, когда его не выбирают в самом окне.
   *
   * Нужен аналитике теста: там тест задан страницей, а вариант и версия — условия ВНУТРИ
   * теста, и без него их не из чего предложить.
   */
  scopeTestId?: string | null;
}

const SOURCES: Array<{ value: RegistrySource; label: string }> = [
  { value: "web", label: "Веб" },
  { value: "telemetry", label: "Телеметрия LMS" },
  { value: "import", label: "Импорт" },
];

const OUTCOMES: Array<{ value: RegistryOutcome; label: string }> = [
  { value: "passed", label: "Сдал" },
  { value: "failed", label: "Не сдал" },
  { value: "completed", label: "Завершено без оценки" },
  { value: "incomplete", label: "Не завершено" },
];

/** Добавить или убрать значение из списка условий. */
function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter(item => item !== value) : [...list, value];
}

export function RegistryFilterDialog({
  open, filter, onApply, onClose, hideTest, scopeTestId,
}: RegistryFilterDialogProps) {
  const [draft, setDraft] = useState<RegistryFilter>(filter);
  // Справочники спрашиваются только у открытого окна и тем же хуком, что зовут чипы: иначе
  // одно и то же условие называлось бы в двух местах по-разному.
  const { tests, groups } = useRegistryDictionaries(open);
  /**
   * Тест, внутри которого осмысленны вариант и версия: заданный страницей либо единственный
   * выбранный. Несколько тестов сразу — условие теряет смысл, и поля не показываются.
   */
  const scopedTestId = scopeTestId ?? (draft.testIds.length === 1 ? draft.testIds[0] : null);
  const { forms, versions } = useTestDictionary(scopedTestId, open);

  // Открытие — момент, когда черновик берётся из применённых условий: окно, закрытое отменой,
  // не должно помнить набранное в прошлый раз.
  useEffect(() => {
    if (open) setDraft(filter);
  }, [open, filter]);

  return (
    <ModalDialog
      open={open}
      onClose={onClose}
      size="m"
      title="Условия отбора"
      description="Условия применяются вместе и попадают в адрес страницы — ссылку можно переслать"
      footer={
        <>
          <Button variant="ghost" size="m" onClick={() => setDraft(EMPTY_FILTER)}>Сбросить</Button>
          <Button variant="ghost" size="m" onClick={onClose}>Отмена</Button>
          <Button variant="primary" size="m" onClick={() => { onApply(draft); onClose(); }}>
            Применить
          </Button>
        </>
      }
    >
      <Stack gap={4}>
        <Stack gap={2}>
          <Text variant="body-s" weight="medium">Источник</Text>
          {SOURCES.map(source => (
            <Checkbox
              key={source.value}
              label={source.label}
              checked={draft.sources.includes(source.value)}
              onChange={() => setDraft(d => ({ ...d, sources: toggle(d.sources, source.value) }))}
            />
          ))}
        </Stack>

        <Stack gap={2}>
          <Text variant="body-s" weight="medium">Исход</Text>
          {OUTCOMES.map(outcome => (
            <Checkbox
              key={outcome.value}
              label={outcome.label}
              checked={draft.outcomes.includes(outcome.value)}
              onChange={() => setDraft(d => ({ ...d, outcomes: toggle(d.outcomes, outcome.value) }))}
            />
          ))}
        </Stack>

        {/*
          Тесты и группы выбираются поиском, а не списком: тестов на инсталляции десятки, и
          двадцать чекбоксов подряд — это не выбор, а прокрутка.
        */}
        {!hideTest && (
          <Combobox
            label="Тест"
            multiple
            placeholder="Все тесты"
            options={tests.map(test => ({ value: test.id, label: test.title }))}
            values={draft.testIds}
            onValuesChange={values => setDraft(d => ({ ...d, testIds: values }))}
            fullWidth
          />
        )}

        <Combobox
          label="Группа"
          multiple
          placeholder="Все группы"
          options={groups.map(group => ({ value: group.id, label: group.name }))}
          values={draft.groupIds}
          onValuesChange={values => setDraft(d => ({ ...d, groupIds: values }))}
          fullWidth
        />

        {/*
          Вариант выдачи и версия публикации — условия ВНУТРИ одного теста: у разных тестов
          они свои, и общий список из них был бы перечнем несравнимого. Поэтому поля
          появляются, когда тест в условиях ровно один, и исчезают, когда их несколько или
          нет вовсе. На аналитике теста он задан страницей — там они есть всегда.
        */}
        {scopedTestId && forms.length > 0 && (
          <Combobox
            label="Вариант выдачи"
            multiple
            placeholder="Все варианты"
            options={forms.map(form => ({ value: form.id, label: form.label }))}
            values={draft.formIds}
            onValuesChange={values => setDraft(d => ({ ...d, formIds: values }))}
            fullWidth
          />
        )}

        {scopedTestId && versions.length > 0 && (
          <Combobox
            label="Версия публикации"
            multiple
            placeholder="Все версии"
            options={versions.map(snapshot => ({
              value: snapshot.id,
              label: `Версия ${snapshot.version}`,
            }))}
            values={draft.snapshotIds}
            onValuesChange={values => setDraft(d => ({ ...d, snapshotIds: values }))}
            fullWidth
          />
        )}

        <Stack gap={2}>
          <Text variant="body-s" weight="medium">Период</Text>
          <FormField label="Период с" htmlFor="registry-from">
            <Input
              id="registry-from"
              type="date"
              value={draft.from ?? ""}
              onChange={event => setDraft(d => ({ ...d, from: event.target.value || undefined }))}
            />
          </FormField>
          <FormField label="Период по" htmlFor="registry-to">
            <Input
              id="registry-to"
              type="date"
              value={draft.to ?? ""}
              onChange={event => setDraft(d => ({ ...d, to: event.target.value || undefined }))}
            />
          </FormField>
        </Stack>
      </Stack>
    </ModalDialog>
  );
}
