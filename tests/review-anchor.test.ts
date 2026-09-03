/**
 * @module tests/review-anchor
 *
 * PRD-52 раздел 7.2: якорь комментария и его резолвер. Резолвер — единственное
 * место, знающее, куда ведёт каждый вид якоря; его зовут все три входа панели
 * (ящик теста, отладчик, ссылка `?review=<id>`), поэтому второй копии правила
 * быть не должно.
 */

import { describe, it, expect } from "vitest";
import { resolveAnchorTarget, isAnchorNavigable, type ReviewAnchor } from "@shared/review/anchor";

describe("resolveAnchorTarget", () => {
  it("вопрос ведёт в редактор вопроса", () => {
    expect(resolveAnchorTarget({ kind: "question", questionId: "q1", topicId: "tp1" }))
      .toEqual({ target: "question-editor", questionId: "q1" });
  });

  it("страница контента ведёт в её редактор", () => {
    expect(resolveAnchorTarget({ kind: "content-page", contentPageId: "p1" }))
      .toEqual({ target: "content-page-editor", contentPageId: "p1" });
  });

  it("тема ведёт в структуру теста и несёт раздел для подсветки", () => {
    expect(resolveAnchorTarget({ kind: "topic", topicId: "tp1" }))
      .toEqual({ target: "test-editor", tab: "structure", topicId: "tp1" });
  });

  it("стартовый экран и итоги ведут в оформление", () => {
    expect(resolveAnchorTarget({ kind: "start" })).toEqual({ target: "test-editor", tab: "design" });
    expect(resolveAnchorTarget({ kind: "results" })).toEqual({ target: "test-editor", tab: "design" });
  });

  it("тест в целом ведёт в ящик теста", () => {
    expect(resolveAnchorTarget({ kind: "test" })).toEqual({ target: "test-editor", tab: "basic" });
  });

  it("якорь на вопрос без идентификатора не ведёт никуда: лучше молчать, чем открыть чужое", () => {
    expect(resolveAnchorTarget({ kind: "question" } as ReviewAnchor)).toBeNull();
    expect(resolveAnchorTarget({ kind: "content-page" } as ReviewAnchor)).toBeNull();
  });
});

describe("isAnchorNavigable", () => {
  it("осиротевший якорь не кликается: объект удалён", () => {
    expect(isAnchorNavigable({ kind: "question", questionId: "q1" }, { orphaned: true })).toBe(false);
  });

  it("живой якорь кликается", () => {
    expect(isAnchorNavigable({ kind: "question", questionId: "q1" }, { orphaned: false })).toBe(true);
  });

  it("тест в целом кликается всегда — удалять там нечего", () => {
    expect(isAnchorNavigable({ kind: "test" }, { orphaned: false })).toBe(true);
  });
});
