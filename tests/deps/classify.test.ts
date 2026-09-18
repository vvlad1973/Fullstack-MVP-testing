import { describe, expect, it } from "vitest";
import { OUTCOME, classify, matchArtifact } from "../../scripts/deps/classify.mjs";

const pkg = { id: "zod@4.4.3", name: "zod", scope: "", version: "4.4.3", dev: false, requiredBy: ["проект"] };

function artifact(version: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    npm: { name: "zod", scope: "", version },
    state: { status, zone: "MAIN", comment: "", ...extra },
    alerts: [],
  };
}

describe("matchArtifact", () => {
  it("не принимает 4.4.30 за 4.4.3", () => {
    expect(matchArtifact([artifact("4.4.30", "PERMITTED")], pkg)).toBeNull();
  });

  it("находит запись со строго той же версией", () => {
    const found = matchArtifact([artifact("4.4.30", "RESTRICTED"), artifact("4.4.3", "PERMITTED")], pkg);
    expect(found?.state.status).toBe("PERMITTED");
  });

  it("различает область", () => {
    const scoped = { ...pkg, scope: "@other" };
    expect(matchArtifact([artifact("4.4.3", "PERMITTED")], scoped)).toBeNull();
  });
});

describe("classify", () => {
  it("разрешённый пакет — норма", () => {
    expect(classify(pkg, [artifact("4.4.3", "PERMITTED")])).toMatchObject({ outcome: OUTCOME.OK, status: "PERMITTED" });
  });

  it("запрещённый пакет — провал", () => {
    expect(classify(pkg, [artifact("4.4.3", "RESTRICTED")])).toMatchObject({ outcome: OUTCOME.BLOCK });
  });

  it("пустой ответ — отсутствие в базе, а не запрет", () => {
    expect(classify(pkg, [])).toMatchObject({ outcome: OUTCOME.BLOCK, status: "ABSENT" });
  });

  it("частичное разрешение — предупреждение с комментарием системы", () => {
    const result = classify(pkg, [artifact("4.4.3", "PARTIALLY_PERMITTED", { comment: "только в изоляции" })]);
    expect(result).toMatchObject({ outcome: OUTCOME.WARN, comment: "только в изоляции" });
  });

  it.each(["REQUESTED", "VERIFICATION", "NOTFOUND", "UNCHECKABLE", "UNDEFINED"])(
    "статус %s — предупреждение",
    (status) => {
      expect(classify(pkg, [artifact("4.4.3", status)]).outcome).toBe(OUTCOME.WARN);
    },
  );

  it("неизвестный статус предупреждает и сохраняет его дословно", () => {
    const result = classify(pkg, [artifact("4.4.3", "SOMETHING_NEW")]);
    expect(result).toMatchObject({ outcome: OUTCOME.WARN, status: "SOMETHING_NEW", known: false });
  });

  it("переносит зону и уязвимости в исход", () => {
    const withAlert = artifact("4.4.3", "PERMITTED", { zone: "ISOLATED" });
    withAlert.alerts = [{ severity: "HIGH", vulnerabilityId: "CVE-2026-1" }];
    expect(classify(pkg, [withAlert])).toMatchObject({ zone: "ISOLATED", alerts: [{ severity: "HIGH" }] });
  });

  it("запись без state — предупреждение, а не падение", () => {
    const bare = { npm: { name: "zod", scope: "", version: "4.4.3" }, alerts: [] };
    expect(classify(pkg, [bare])).toMatchObject({ outcome: OUTCOME.WARN, status: "UNDEFINED", zone: null, comment: "" });
  });

  it("artifacts === null — как пустой ответ", () => {
    expect(classify(pkg, null)).toMatchObject({ outcome: OUTCOME.BLOCK, status: "ABSENT" });
  });

  it("непривязанный пакет находит запись, где scope пришёл как null, а не \"\"", () => {
    const nullScoped = { npm: { name: "zod", scope: null, version: "4.4.3" }, state: { status: "PERMITTED" }, alerts: [] };
    expect(matchArtifact([nullScoped], pkg)).toBe(nullScoped);
  });

  it("несколько записей с одной версией — решает первая по порядку ответа", () => {
    const first = artifact("4.4.3", "PERMITTED");
    const second = artifact("4.4.3", "RESTRICTED");
    expect(classify(pkg, [first, second])).toMatchObject({ outcome: OUTCOME.OK, status: "PERMITTED" });
  });
});
