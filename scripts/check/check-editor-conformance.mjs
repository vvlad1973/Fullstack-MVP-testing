#!/usr/bin/env node
/**
 * @module scripts/check/check-editor-conformance
 * @description Guard: the test-editor drawer must keep the spacing contract of the approved
 * wireframe.
 *
 * Why this exists. The 2026-09-03 acceptance of the editor restructure checked the plan's
 * checklist — "seven tabs, rails in the right order" — and not the drawing, and 219
 * divergences shipped with it. Six of the wireframe's spacing overrides had simply never been
 * ported to the project layer, and nobody could see it because nobody was measuring. This
 * guard re-derives the contract from the wireframe on every run (see `expectations.mjs`) and
 * measures the live drawer against it, so that class of miss cannot survive a commit again.
 *
 * What it does NOT cover, deliberately: modal dialogs and states that need interaction
 * (unsaved draft, blocking validation, the changes popover, close and conflict dialogs). Those
 * are checked by hand against the acceptance report. Pretending otherwise would be worse than
 * the gap.
 *
 * Usage: `npm run check:editor-ui`, with `npm run dev` already running.
 *   EDITOR_UI_BASE     — dev origin, default http://localhost:8081
 *   EDITOR_UI_TEST_ID  — test whose drawer is measured
 *   EDITOR_UI_PORT     — CDP port, default 9222
 */

import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { launch, sessionCookie, splitCookie } from "./editor-conformance/cdp.mjs";
import { readExpectations } from "./editor-conformance/expectations.mjs";
import { startStaticServer } from "./editor-conformance/static-server.mjs";

const REPO_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const WIREFRAME = join(REPO_ROOT, "docs", "wireframes", "editor-settings-target.html");
const DEV = process.env.EDITOR_UI_BASE ?? "http://localhost:8081";
const TEST_ID = process.env.EDITOR_UI_TEST_ID ?? "6e10d1e6-0fc9-4e5a-a498-41662c663633";
const CDP_PORT = Number(process.env.EDITOR_UI_PORT ?? 9222);

/**
 * Measures every expectation against whatever the page currently shows.
 *
 * Elements are looked up INSIDE the drawer: the contract belongs to the editor drawer, and the
 * page behind it carries the same design-system classes (the tests list has its own selects
 * and buttons). Measuring the first match in the document would report the page behind the
 * backdrop as if it were the drawer.
 */
const measureSource = (rows) => `() => {
  const rows = ${JSON.stringify(rows)};
  const out = {};
  for (const r of rows) {
    const el = [...document.querySelectorAll(r.selector)].find((e) => e.closest(".ou-drawer"));
    if (!el) continue;
    const cs = getComputedStyle(el);
    const prop = r.property === "padding-inline" ? "paddingLeft" : r.property;
    out[r.selector + "|" + r.property] = cs[prop];
  }
  return out;
}`;

const { expectations, contradictions } = readExpectations(WIREFRAME);
if (!expectations.length) {
  console.error("Из эскиза не вычитано ни одной перебивки — сверять нечего. Проверьте блок <style>.");
  process.exit(1);
}

const server = await startStaticServer(0);
let browser;
const failures = [];
const measured = new Map();

try {
  browser = await launch({ port: CDP_PORT });
  const { name, value } = splitCookie(await sessionCookie(DEV));
  await browser.send("Network.setCookie", { name, value, domain: new URL(DEV).hostname, path: "/" });

  await browser.goto(`${DEV}/author/tests`, 4500);
  await browser.clickSelector(`[data-testid="test-edit-${TEST_ID}"]`, 3500);
  const opened = await browser.evaluate('() => document.querySelectorAll(".ou-drawer").length === 1');
  if (!opened) throw new Error("Ящик редактора не открылся — проверьте EDITOR_UI_TEST_ID и права учётной записи.");

  // Walk every tab and every rail item: a selector that lives on one subsection only would
  // otherwise never be measured, and an unmeasured rule is an unprotected rule.
  const tabIds = await browser.evaluate('() => [...document.querySelectorAll(".ou-tabs__tab")].map((t) => t.id)');
  for (const tabId of tabIds) {
    await browser.clickSelector(`#${tabId}`, 1200);
    const railCount = await browser.evaluate('() => document.querySelectorAll(".ou-drawer__rail-item").length');
    for (let r = 0; r < Math.max(railCount, 1); r += 1) {
      if (railCount) {
        await browser.evaluate(`() => {
          const item = document.querySelectorAll(".ou-drawer__rail-item")[${r}];
          if (item) item.click();
          return true;
        }`);
        await new Promise((wait) => setTimeout(wait, 800));
      }
      for (const [key, actual] of Object.entries(await browser.evaluate(measureSource(expectations)))) {
        if (!measured.has(key)) measured.set(key, actual);
      }
    }
  }
} finally {
  if (browser) await browser.close();
  await server.close();
}

for (const row of expectations) {
  const key = `${row.selector}|${row.property}`;
  const actual = measured.get(key);
  if (actual !== undefined && actual !== row.expected) failures.push({ ...row, actual });
}
const notSeen = expectations.filter((r) => !measured.has(`${r.selector}|${r.property}`));

if (contradictions.length) {
  console.warn(`Эскиз противоречит сам себе, эти правила из контракта исключены: ${contradictions.length}`);
  for (const c of contradictions) {
    console.warn(`  ${c.selector} { ${c.property} }: токен даёт ${c.token}px, комментарий обещает ${c.stated}px`);
  }
}
if (notSeen.length) {
  console.warn(`Не встретились на экране, не проверено: ${notSeen.map((r) => r.selector).join(", ")}`);
}

if (failures.length) {
  console.error(`Отступы ящика редактора разошлись с эскизом: ${failures.length} из ${expectations.length}`);
  for (const f of failures) {
    console.error(`  ${f.selector} { ${f.property} } = ${f.actual}, эскиз требует ${f.expected}`);
  }
  console.error("");
  console.error(
    "Правило 4/16/24 задаёт эскиз docs/wireframes/editor-settings-target.html. Переносите перебивку " +
      "в client/src/styles/tb-components.css — не правьте эскиз и не ослабляйте проверку.",
  );
  process.exit(1);
}

console.log(`OK: проверено отступов ${expectations.length - notSeen.length} из ${expectations.length}, расхождений нет.`);
