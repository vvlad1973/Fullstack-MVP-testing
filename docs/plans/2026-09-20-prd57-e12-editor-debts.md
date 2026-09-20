# Долги трека (PRD-57): панель вставки и предпросмотр — план

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** автор вставляет листинг и формулу кнопкой, а перед сохранением видит задание
глазами участника.

**Architecture:** предпросмотр рисуется ТЕМ ЖЕ компонентом, что экран прохождения; разметка
задания приходит с сервера, потому что подсветка и формула живут только там.

**Tech Stack:** TypeScript, React 19, `@skillum/ui-kit`, Vitest.

**Устройство согласовано:**
[docs/specs/2026-09-20-prd57-e12-editor-debts-design.md](../specs/2026-09-20-prd57-e12-editor-debts-design.md).
Требования: FR-09a, FR-24g.

**Границы.** Три режима ввода текста задания (§4.3) не делаются: их не делал ни один этап
трека, и это отдельная работа, а не долг.

---

## Task 1: Вставка разметки

- [ ] **Step 1:** падающие тесты — вставка в позицию курсора, обёртывание выделенного,
      положение курсора после вставки, язык листинга в открывающей строке.
- [ ] **Step 2:** `client/src/features/questions/insert-markup.ts` — чистые функции над
      текстом и положением курсора, без DOM.
- [ ] **Step 3:** `npm test -- tests/insert-markup.test.ts`

## Task 2: Панель в ящике

- [ ] **Step 1:** падающие тесты — три кнопки, меню языка, «Пропуск» только у своего типа.
- [ ] **Step 2:** панель над полем текста задания в ящике вопроса.
- [ ] **Step 3:** `npm test -- client/src/features/questions/__tests__`

## Task 3: Маршрут предпросмотра

- [ ] **Step 1:** падающие тесты — отдаёт подсвеченный листинг и формулу картинкой,
      ничего не пишет, закрыт правом.
- [ ] **Step 2:** `POST /api/questions/preview` поверх существующего `promptHtmlOf`.
- [ ] **Step 3:** `npm test -- tests/routes.question-preview.test.ts`

## Task 4: Окно предпросмотра

- [ ] **Step 1:** падающие тесты — окно открывается кнопкой подвала, рисует экран вопроса,
      ввод ничего не сохраняет.
- [ ] **Step 2:** `question-preview-modal.tsx` на `TemplateQuestionScreen` + кнопка в подвале
      ящика.
- [ ] **Step 3:** `npm test -- client/src/features/questions/__tests__`

## Task 5: Приёмка

- [ ] **Step 1:** затронутые наборы целиком.
- [ ] **Step 2:** живой прогон: кнопки вставляют разметку, предпросмотр показывает
      подсвеченный листинг, формулу и поля пропусков.
