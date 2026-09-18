/**
 * @module scripts/deps/report
 * @description Renders verdicts: a console summary, a Markdown report and raw JSON.
 *
 * Only findings are printed. A list of six hundred permitted packages buries the four that
 * matter, and the whole point of the tool is to make those four impossible to miss.
 */

import { OUTCOME } from "./classify.mjs";

/**
 * @typedef {import("./classify.mjs").Verdict} Verdict
 */

/**
 * @typedef {Object} Summary
 * @property {Verdict[]} results All verdicts, unfiltered.
 * @property {{ok: number, warn: number, block: number, error: number}} counts Outcome counts.
 * @property {Verdict[]} blockedProd `block` outcomes in the production graph (`dev === false`).
 * @property {Verdict[]} blockedDev `block` outcomes that are dev-only.
 * @property {Verdict[]} warnings `warn` outcomes.
 * @property {Verdict[]} errors `error` outcomes (the system was never asked, or never answered).
 */

/**
 * Groups results by outcome and counts them. The prod/dev split on `block` exists because the
 * two have different consequences for the exit code and for what a human does next: a
 * production finding blocks a build, a dev-only one is reported but does not.
 *
 * @param {Verdict[]} results
 * @returns {Summary}
 */
export function summarize(results) {
  const counts = { ok: 0, warn: 0, block: 0, error: 0 };
  for (const r of results) {
    counts[r.outcome] += 1;
  }
  const blocked = results.filter((r) => r.outcome === OUTCOME.BLOCK);
  return {
    results,
    counts,
    blockedProd: blocked.filter((r) => !r.dev),
    blockedDev: blocked.filter((r) => r.dev),
    warnings: results.filter((r) => r.outcome === OUTCOME.WARN),
    errors: results.filter((r) => r.outcome === OUTCOME.ERROR),
  };
}

/**
 * Decides the process exit code from a summary.
 *
 * `0` — everything is permitted. `1` — there is a finding. `2` — the run is incomplete (some
 * packages could not be asked about). A finding outranks incompleteness: if something is already
 * forbidden, the fact that three other packages timed out does not make that answer any less
 * final, so a run with both a block and an error still exits `1`, not `2`.
 *
 * @param {Summary} summary
 * @param {{strictDev?: boolean}} [options] `strictDev` folds dev-only findings into the
 *   production ones (spec §7: `--strict-dev`).
 * @returns {number} 0, 1 or 2.
 */
export function exitCodeFor(summary, { strictDev = false } = {}) {
  const blocking = strictDev ? summary.blockedProd.length + summary.blockedDev.length : summary.blockedProd.length;
  if (blocking > 0) {
    return 1;
  }
  if (summary.errors.length > 0) {
    return 2;
  }
  return 0;
}

/**
 * Formats a package identity with its scope, e.g. "@electric-sql/pglite" or "express".
 *
 * @param {Verdict} r
 * @returns {string}
 */
function packageLabel(r) {
  return r.scope ? `${r.scope}/${r.name}` : r.name;
}

/**
 * One console line about a package: what it is and who pulls it in. The chain is capped at
 * three links on the console (the full chain belongs in the Markdown table) because the
 * terminal summary is meant to be scanned, not read line by line.
 *
 * @param {Verdict} r
 * @returns {string}
 */
function consoleLine(r) {
  const chain = r.requiredBy.length ? ` <- ${r.requiredBy.slice(0, 3).join(", ")}` : "";
  const zone = r.zone && r.zone !== "MAIN" ? ` [${r.zone}]` : "";
  const dev = r.dev ? " (dev)" : "";
  return `  ${packageLabel(r)}@${r.version} — ${r.status}${zone}${dev}${chain}`;
}

/**
 * Console text: the outcome summary, then every non-permitted package grouped by section.
 * Permitted packages are never listed — see the module description for why.
 *
 * @param {Summary} summary
 * @returns {string}
 */
export function renderConsole(summary) {
  const { counts } = summary;
  const parts = [
    `Разрешено: ${counts.ok}   Предупреждений: ${counts.warn}   Запрещено: ${counts.block}   Ошибок: ${counts.error}`,
  ];
  const section = (title, rows) => {
    if (!rows.length) {
      return;
    }
    parts.push("", `${title} (${rows.length}):`, ...rows.map(consoleLine));
  };
  section("Запрещено или нет в базе — продакшен", summary.blockedProd);
  section("Запрещено или нет в базе — только dev", summary.blockedDev);
  section("Требует внимания", summary.warnings);
  section("Не удалось спросить", summary.errors);
  return parts.join("\n");
}

/**
 * Escapes characters that would break a Markdown table cell: `|` ends the cell early, and a
 * literal newline (the system's `comment` field is free text, so nothing rules one out) would
 * split the row across lines.
 *
 * @param {string} text
 * @returns {string}
 */
function escapeCell(text) {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

/**
 * Markdown table rows for one section. Unlike the console, the full `requiredBy` chain is
 * printed here: this is the file a human opens specifically to decide what to do about a
 * transitive dependency, and truncating the chain would hide exactly the information that
 * decision needs.
 *
 * @param {Verdict[]} rows
 * @returns {string[]}
 */
function markdownRows(rows) {
  return rows.map((r) => {
    const chain = r.requiredBy.length ? escapeCell(r.requiredBy.join(", ")) : "—";
    const note = r.comment ? escapeCell(r.comment) : "—";
    return `| ${packageLabel(r)} | ${r.version} | ${r.status} | ${r.zone ?? "—"} | ${r.dev ? "dev" : "прод"} | ${chain} | ${note} |`;
  });
}

/**
 * Full Markdown report for a human to read or forward: a heading, a totals line, then one
 * table per non-empty section (production findings, dev-only findings, warnings, errors).
 *
 * @param {Verdict[]} results All verdicts, not just findings — `summarize` does the filtering.
 * @param {{checkedAt: string, total: number}} meta `checkedAt` is an ISO timestamp, `total` is
 *   the count of packages the run covered.
 * @returns {string} Markdown text ending in a trailing newline.
 */
export function renderMarkdown(results, { checkedAt, total }) {
  const summary = summarize(results);
  const head = "| Пакет | Версия | Статус | Зона | Граф | Кто тянет | Комментарий системы |";
  const sep = "| --- | --- | --- | --- | --- | --- | --- |";
  const out = [
    "# Отчёт о допустимости зависимостей",
    "",
    `Проверено пакетов: ${total}. Дата проверки: ${checkedAt}.`,
    "",
    `Разрешено: ${summary.counts.ok}. Предупреждений: ${summary.counts.warn}. ` +
      `Запрещено: ${summary.counts.block}. Ошибок: ${summary.counts.error}.`,
  ];
  const section = (title, rows) => {
    if (!rows.length) {
      return;
    }
    out.push("", `## ${title}`, "", head, sep, ...markdownRows(rows));
  };
  section("Запрещено или нет в базе — продакшен", summary.blockedProd);
  section("Запрещено или нет в базе — только dev", summary.blockedDev);
  section("Требует внимания", summary.warnings);
  section("Не удалось спросить", summary.errors);
  if (!summary.counts.block && !summary.counts.warn && !summary.counts.error) {
    out.push("", "Все проверенные пакеты разрешены.");
  }
  out.push("");
  return out.join("\n");
}

/**
 * Raw data for a later comparison of two runs: every result, not only findings — the report's
 * "only findings" rule is about what a human reads, not about what gets persisted.
 *
 * @param {Verdict[]} results
 * @param {{checkedAt: string, total: number}} meta
 * @returns {{checkedAt: string, total: number, summary: {ok: number, warn: number, block:
 *   number, error: number}, results: Verdict[]}}
 */
export function toJson(results, { checkedAt, total }) {
  return { checkedAt, total, summary: summarize(results).counts, results };
}
