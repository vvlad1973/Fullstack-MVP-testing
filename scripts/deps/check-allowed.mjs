/**
 * @module scripts/deps/check-allowed
 * @description `npm run deps:check` — asks the corporate system whether every package in
 * package-lock.json is allowed, and reports what it found.
 *
 * Design: docs/specs/tooling/deps-check.md. The run is deliberately slow (about twelve minutes
 * for a full lockfile) because the pace is chosen not to look like an attack on somebody
 * else's production system; the cache makes every later run cost only what changed.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { classify, failed } from "./classify.mjs";
import { readCached, writeCached } from "./cache.mjs";
import { PACE } from "./pace.mjs";
import { createTokenSource } from "./repo-auth.mjs";
import { createClient } from "./repo-client.mjs";
import { exitCodeFor, renderConsole, renderMarkdown, summarize, toJson } from "./report.mjs";
import { parseLockfile } from "./lockfile.mjs";

const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Validates `--delay`. It exists so a run can be made MORE cautious than the default (a slow
 * corporate network, a first cautious run), never less: the pace in `pace.mjs` is deliberately
 * frozen and tested against the spec (section 5) precisely because "make it a bit faster" is the
 * single most tempting edit to this tool, and the cost of being wrong is a blocked human account,
 * not a slow build. Letting a CLI flag undercut that floor would reopen exactly the door the
 * frozen constant was built to close, so a value below the documented minimum is refused rather
 * than silently clamped — clamping would let a typo like `--delay 5` quietly run at 500ms anyway
 * without ever telling the caller their flag was ignored.
 *
 * @param {string} raw Raw `--delay` value from argv.
 * @returns {{ok: true, value: number}|{ok: false, message: string}}
 */
export function validateDelay(raw) {
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    return { ok: false, message: `--delay: ожидалось число миллисекунд, получено «${raw}»` };
  }
  if (value < PACE.baseDelayMs) {
    return {
      ok: false,
      message:
        `--delay не может быть меньше ${PACE.baseDelayMs} мс — это темп, который защищает учётную запись ` +
        `человека от блокировки корпоративной системой (docs/specs/tooling/deps-check.md §5). Флагом можно ` +
        `только ЗАМЕДЛИТЬ прогон, не ускорить; чтобы пересмотреть сам минимум, правьте scripts/deps/pace.mjs ` +
        `и его тест, который сверяет числа со спекой.`,
    };
  }
  return { ok: true, value };
}

/**
 * Reads and parses `package-lock.json` into the flat package list, turning both a bad path and a
 * bad `lockfileVersion` into one short, readable line instead of a raw stack trace — this is the
 * first thing a person sees when the command was run from the wrong directory or against a
 * lockfile that predates npm 7.
 *
 * @param {string} path
 * @returns {{ok: true, packages: Array<object>}|{ok: false, message: string}}
 */
export function loadPackages(path) {
  const full = resolve(path);
  let lock;
  try {
    lock = JSON.parse(readFileSync(full, "utf8"));
  } catch (error) {
    return { ok: false, message: `Не удалось прочитать lock-файл «${full}»: ${error.message}` };
  }
  try {
    return { ok: true, packages: parseLockfile(lock) };
  } catch (error) {
    return { ok: false, message: `${error.message} (файл: «${full}»)` };
  }
}

/**
 * Parses CLI arguments. Split out from `main()` purely so a targeted test can exercise argument
 * handling (bad `--delay`, `--prod` filtering, …) without touching the network.
 *
 * @param {string[]} argv `process.argv.slice(2)`-shaped arguments.
 */
export function parseCliArgs(argv) {
  return parseArgs({
    args: argv,
    options: {
      lock: { type: "string", default: "package-lock.json" },
      out: { type: "string", default: join("tmp", "deps-report") },
      cache: { type: "string", default: join("tmp", "deps-cache") },
      prod: { type: "boolean", default: false },
      "strict-dev": { type: "boolean", default: false },
      "no-cache": { type: "boolean", default: false },
      delay: { type: "string", default: String(PACE.baseDelayMs) },
    },
  }).values;
}

/**
 * Runs the whole check: reads the lockfile, asks the corporate system about each package at the
 * documented pace, writes the report, and returns the process exit code. Never calls
 * `process.exit()` itself — see the note above the call site in `main()` for why.
 *
 * @param {string[]} argv
 * @returns {Promise<number>} 0 clean, 1 a package is forbidden, 2 the run is incomplete or the
 *   input could not even be read.
 */
export async function run(argv) {
  let values;
  try {
    values = parseCliArgs(argv);
  } catch (error) {
    // node:util's parseArgs already refuses an unknown flag or a missing value with a short,
    // specific message ("Unknown option '--bogus'") — worth keeping verbatim rather than
    // reinventing, just framed so it reads as this command's own refusal, not a bare stack trace.
    process.stderr.write(`Неверные аргументы: ${error.message}\n`);
    return 2;
  }

  const delay = validateDelay(values.delay);
  if (!delay.ok) {
    process.stderr.write(`${delay.message}\n`);
    return 2;
  }

  const loaded = loadPackages(values.lock);
  if (!loaded.ok) {
    process.stderr.write(`${loaded.message}\n`);
    return 2;
  }
  const packages = values.prod ? loaded.packages.filter((p) => !p.dev) : loaded.packages;

  /** Rough runtime: pause plus a typical answer per package, plus a breather every fiftieth. */
  const minutes = Math.ceil(
    (packages.length * (delay.value + 400) + Math.floor(packages.length / PACE.longPauseEvery) * PACE.longPauseMs) /
      60000,
  );
  process.stdout.write(
    `Проверяю ${packages.length} пакетов. Темп щадящий, ожидаемое время — около ${minutes} минут.\n`,
  );

  const client = createClient({ getToken: createTokenSource(), delayMs: delay.value });
  const results = [];
  let fromCache = 0;
  let stoppedEarly = false;
  let stopReason = null;

  for (const [index, pkg] of packages.entries()) {
    const now = Date.now();
    let artifacts = values["no-cache"] ? null : readCached(values.cache, pkg, { now, ttlMs: CACHE_TTL_MS });
    if (artifacts) {
      fromCache += 1;
    } else {
      try {
        artifacts = await client.findArtifacts(pkg);
        writeCached(values.cache, pkg, artifacts, { now });
      } catch (error) {
        results.push(failed(pkg, error));
        // `stopRun` is a flag repo-client.mjs sets on the errors that mean "the corporate system
        // told us to back off, stop asking" (dead login, repeated refusals, a Retry-After past a
        // minute) — checked as a property, not sniffed out of the message text, so a reworded
        // message can never silently turn a required stop into "skip this package and carry on".
        if (error?.stopRun) {
          stoppedEarly = true;
          stopReason = error.message;
          process.stdout.write(`\nОстановка: ${error.message}\n`);
          break;
        }
        continue;
      }
    }
    results.push(classify(pkg, artifacts));
    if ((index + 1) % 25 === 0) {
      process.stdout.write(`  ${index + 1} из ${packages.length}\n`);
    }
  }

  const meta = { checkedAt: new Date().toISOString(), total: results.length };
  mkdirSync(values.out, { recursive: true });

  let markdown = renderMarkdown(results, meta);
  const json = toJson(results, meta);
  if (stoppedEarly) {
    // An incomplete run that LOOKS like a full one is the specific silent-wrong-answer shape a
    // verdict tool cannot afford: "690 checked, none forbidden" and "212 checked before the
    // system asked us to stop, none forbidden so far" call for very different next actions, and
    // `total: results.length` alone does not tell them apart.
    const note =
      `ПРОГОН ОСТАНОВЛЕН ДОСРОЧНО: проверено ${results.length} из ${packages.length} запланированных ` +
      `пакетов. ${stopReason}`;
    markdown = `> ${note}\n\n${markdown}`;
    json.incomplete = true;
    json.plannedTotal = packages.length;
    json.stopReason = stopReason;
  }

  writeFileSync(join(values.out, "report.md"), markdown, "utf8");
  writeFileSync(join(values.out, "report.json"), JSON.stringify(json, null, 2), "utf8");

  const summary = summarize(results);
  process.stdout.write(`\n${renderConsole(summary)}\n\n`);
  if (stoppedEarly) {
    process.stdout.write(
      `ВНИМАНИЕ: прогон неполон — проверено ${results.length} из ${packages.length}. Остаток не спрошен.\n`,
    );
  }
  process.stdout.write(`Из кэша: ${fromCache}. Отчёт: ${join(values.out, "report.md")}\n`);

  return exitCodeFor(summary, { strictDev: values["strict-dev"] });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  // `process.exit()` after writes that just happened can truncate stdout on Windows, where
  // console output is not guaranteed to be flushed synchronously before the process tears down —
  // exactly the report summary this command exists to show. Setting `exitCode` and letting the
  // event loop drain on its own gives Node the chance to flush first; the process still exits
  // with the right code once there is nothing left to do.
  process.exitCode = await run(process.argv.slice(2));
}
