/**
 * @module features/analytics/test/__tests__/delivery-tab
 * @description PRD-56 FR-18 - FR-20: блоки вкладки «Выдача».
 *
 * Каждый блок обещает читателю своё. Таблица вариантов говорит, одинаково ли оценивают формы,
 * и обязана назвать, С ЧЕМ сравнивает. Таблица версий не смешивает прохождения до и после
 * правки и честно называет строку «версия не указана», а не прячет её. Профиль банка
 * показывает выработанную голову и мёртвый хвост, свёрнутый в число.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ExposureProfile } from "../exposure-profile";
import { VariantTable } from "../variant-table";
import { VersionTable } from "../version-table";

const VARIANTS = [{
  topicId: "tp-1",
  topicName: "Право и комплаенс",
  rows: [
    {
      formId: "form-a", label: "Форма A", attempts: 131, passRate: 84, avgPercent: 79,
      deltaPoints: 5, deviates: false, lowSample: false,
    },
    {
      formId: "form-c", label: "Форма C", attempts: 118, passRate: 62, avgPercent: 68,
      deltaPoints: -17, deviates: true, lowSample: false,
    },
    {
      formId: "form-d", label: "Форма D", attempts: 8, passRate: null, avgPercent: null,
      deltaPoints: null, deviates: false, lowSample: true,
    },
  ],
}];

describe("VariantTable (FR-18)", () => {
  it("называет расхождение и то, с чем сравнивали", () => {
    render(<VariantTable sections={VARIANTS} />);

    expect(screen.getByText("−17 п.п. к тесту")).toBeTruthy();
    expect(screen.getByText(/расхождение считается к доле сдавших по тесту/i)).toBeTruthy();
  });

  it("небольшой разброс называет «в пределах», а не числом", () => {
    render(<VariantTable sections={VARIANTS} />);

    expect(screen.getByText("в пределах")).toBeTruthy();
  });

  it("у малой выборки печатает счёт, но не долю", () => {
    render(<VariantTable sections={VARIANTS} />);

    expect(screen.getAllByText("мало данных").length).toBeGreaterThan(0);
    expect(screen.getByText("8")).toBeTruthy();
  });

  it("называет раздел, к которому относятся формы", () => {
    // Вариант — свойство раздела: без названия темы строки читаются как формы одного набора.
    render(<VariantTable sections={VARIANTS} />);

    expect(screen.getByText("Право и комплаенс")).toBeTruthy();
  });

  it("у теста без фиксированных вариантов объясняет, почему таблицы нет", () => {
    render(<VariantTable sections={[]} />);

    expect(screen.getByText(/ни один раздел не переведён на фиксированные варианты/i)).toBeTruthy();
  });
});

const VERSIONS = [
  {
    snapshotId: "snap-3", version: 3, publishedAt: "2026-07-01T00:00:00.000Z",
    effectiveTo: null, current: true, attempts: 180, passRate: 84, avgPercent: 79, lowSample: false,
  },
  {
    snapshotId: "snap-2", version: 2, publishedAt: "2026-03-15T00:00:00.000Z",
    effectiveTo: "2026-07-01T00:00:00.000Z", current: false, attempts: 160, passRate: 77,
    avgPercent: 75, lowSample: false,
  },
  {
    snapshotId: null, version: null, publishedAt: null, effectiveTo: null, current: false,
    attempts: 86, passRate: 79, avgPercent: 76, lowSample: false,
  },
];

describe("VersionTable (FR-19, FR-19a)", () => {
  it("помечает текущую версию и печатает период действия прежней", () => {
    render(<VersionTable versions={VERSIONS} />);

    expect(screen.getByText("текущая")).toBeTruthy();
    expect(screen.getByText("15.03.2026 — 01.07.2026")).toBeTruthy();
  });

  it("строку без версии объясняет словами, а не прочерком", () => {
    // «Версия не указана» без объяснения читается как поломка выгрузки.
    render(<VersionTable versions={VERSIONS} />);

    expect(screen.getByText("Версия не указана")).toBeTruthy();
    expect(screen.getByText(/пакет собран до того, как версия стала уезжать в LMS/i)).toBeTruthy();
  });

  it("у неопубликованного теста говорит, что версий нет", () => {
    render(<VersionTable versions={[]} />);

    expect(screen.getByText(/тест ещё не публиковался/i)).toBeTruthy();
  });
});

const PROFILE = {
  topicId: "tp-1",
  topicName: "Право и комплаенс",
  bankSize: 14,
  drawCount: 6,
  attemptsInWindow: 486,
  rows: [
    {
      questionId: "q1", prompt: "Какая мера относится к антикоррупционным?", type: "single",
      tags: ["Антикоррупция"], deliveredCount: 399, sharePercent: 82, excluded: false,
    },
    {
      questionId: "q2", prompt: "Что считается подарком по политике компании?", type: "single",
      tags: [], deliveredCount: 87, sharePercent: 18, excluded: true,
    },
  ],
  neverDelivered: 4,
};

describe("ExposureProfile (FR-20)", () => {
  it("называет объём банка и квоту выдачи", () => {
    render(<ExposureProfile profile={PROFILE} topics={[]} onTopicChange={() => {}} />);

    expect(screen.getByText(/14 вопросов в банке, на прохождение выдаётся 6/)).toBeTruthy();
  });

  it("хвост банка сворачивает в одну строку", () => {
    render(<ExposureProfile profile={PROFILE} topics={[]} onTopicChange={() => {}} />);

    expect(screen.getByText(/Ещё 4 вопроса не выдавались ни разу/)).toBeTruthy();
  });

  it("исключённое задание метит перечёркнутым кругом, а не убирает", () => {
    render(<ExposureProfile profile={PROFILE} topics={[]} onTopicChange={() => {}} />);

    expect(screen.getByText("Что считается подарком по политике компании?")).toBeTruthy();
    expect(screen.getByLabelText("Исключён из выдачи")).toBeTruthy();
  });

  it("смена темы уходит наверх: профиль строится по банку ОДНОЙ темы", async () => {
    const onTopicChange = vi.fn();
    render(
      <ExposureProfile
        profile={PROFILE}
        topics={[
          { topicId: "tp-1", topicName: "Право и комплаенс" },
          { topicId: "tp-2", topicName: "Охрана труда" },
        ]}
        onTopicChange={onTopicChange}
      />,
    );

    await userEvent.click(screen.getByLabelText("Тема"));
    await userEvent.click(screen.getByText("Охрана труда"));

    expect(onTopicChange).toHaveBeenCalledWith("tp-2");
  });
});
