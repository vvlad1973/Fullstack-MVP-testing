/**
 * @module features/analytics/lms-import/lms-import-dialog
 * @description Окно загрузки выгрузки отчёта LMS (PRD-54) — общее для обеих страниц аналитики.
 *
 * Окно владеет и `ModalDialog`, и формой: форма отдаёт тело и кнопки порознь (`frame`), кнопки
 * встают в стандартный подвал окна с разделителем — как в эскизе
 * `docs/wireframes/prd54-lms-import.html` (состояние «в окне») и во всех прочих окнах продукта.
 * Состояние и логика остаются в форме — одно место на все точки входа.
 */
import { ModalDialog } from "@skillum/ui-kit";
import { LmsImportForm } from "./lms-import-form";

/** Свойства окна загрузки выгрузки LMS. */
export interface LmsImportDialogProps {
  /** Открыто ли окно. Закрытое окно форму размонтирует: при новом открытии она начинается с нуля. */
  open: boolean;
  /** Закрыть окно — крестиком, по Esc или кнопкой «Отмена»/«Закрыть». */
  onClose: () => void;
  /** Подзаголовок окна: название теста или подсказка, откуда берётся тест. */
  description?: string;
  /** Тест, заданный страницей: файл другого теста форма отвергнет. */
  fixedTestId?: string;
  /** Зовётся после успешного импорта — чтобы страница обновила свои данные. */
  onDone?: () => void;
}

/**
 * Окно загрузки выгрузки LMS с кнопками формы в подвале.
 *
 * @param props свойства окна
 * @returns окно или ничего, пока оно закрыто
 */
export function LmsImportDialog({ open, onClose, description, fixedTestId, onDone }: LmsImportDialogProps) {
  // Закрытое окно не держит форму смонтированной: иначе её запросы шли бы в фоне, а выбранный
  // файл и план пережили бы закрытие.
  if (!open) return null;
  return (
    <LmsImportForm
      fixedTestId={fixedTestId}
      onDone={onDone}
      onCancel={onClose}
      frame={({ body, actions }) => (
        <ModalDialog open onClose={onClose} title="Загрузка выгрузки LMS" description={description} footer={actions}>
          {body}
        </ModalDialog>
      )}
    />
  );
}
