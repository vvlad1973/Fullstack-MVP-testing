/**
 * @module shared/template/bar-fill
 *
 * How the bar of a breakdown row (a sub-topic of a topic, or a row of the test-scope
 * summary block) is coloured — and, in the «by share» mode, the ready CSS fill of it.
 *
 * Three modes, chosen by the author in the design params (`breakdownBarFill`):
 * - `verdict` — the bar speaks the row's verdict through `passClass` (`is-pass` /
 *   `is-fail`), coloured by the template's CSS. The historical behaviour, and what an
 *   absent param means.
 * - `share` — the colour encodes the SHARE, not the verdict: under the fill lies the
 *   «unfavourable → favourable» ramp across the whole track, and the fill shows its left
 *   part up to the value. The row then carries no verdict class — two signals on one bar
 *   would contradict each other at every value between the threshold and the ramp's middle.
 * - `neutral` — no colour signal at all: no verdict class, no fill; the template's
 *   neutral bar colour stays.
 *
 * WHY THE FILL IS COMPUTED HERE. The earlier form lived in one template's report CSS:
 * a full-width gradient stretched back over the fill with
 * `background-size: calc(100% * 100 / var(--tb-bar-percent))`, hard-coded colours and the
 * share handed over by the layout. Every template and every surface (screen, report) would
 * need its own copy of that trick, and the colours could not follow the test's level
 * scheme. Here the fill is a plain `linear-gradient` from the ramp's unfavourable end to the
 * ramp's colour AT THE VALUE — for a bar of width `p` that is exactly the left part of the
 * full-track ramp, with no division by the share and no reliance on `background-size`. When
 * the ramp bends (a midpoint, or the hue arc of the HSL interpolation), intermediate stops
 * follow it, so the fill never drifts from the level colours the same ramp paints elsewhere.
 *
 * The ramp is the test's LEVEL ramp ({@link module:shared/template/level-ramp
 * rampFromParams}): one «bad → good» palette paints the level zones, the analytics bands and
 * these bars.
 *
 * Output uses the comma form `hsl(h, s%, l%)`: the SCORM package renders inside whatever
 * engine the LMS embeds, and the PDF rasterizer parses colours itself — the legacy form is
 * the one every consumer reads.
 *
 * Pure — no DOM, no Node.
 */

import { LEVEL_SCHEMES, parseHsl, rampColor, rampFromParams, type LevelRamp } from "./level-ramp";

/** Design-param key the author's choice is stored under (manifest `params[]`). */
export const BAR_FILL_PARAM = "breakdownBarFill";

/** The three colouring modes of a breakdown bar. */
export const BAR_FILL_MODES = ["verdict", "share", "neutral"] as const;

export type BarFillMode = (typeof BAR_FILL_MODES)[number];

/**
 * The resolved colouring of breakdown bars, as the results builder takes it
 * (`ResultContextOptions.barFill`). Absent means `verdict` — the byte-identical context of a
 * test built before the setting existed.
 */
export interface BarFillSetting {
  mode: Exclude<BarFillMode, "verdict">;
  ramp: LevelRamp;
}

/**
 * Step of the intermediate stops along the ramp, in share units. Eight segments over the
 * full track keep the HSL arc visually exact while the gradient stays short.
 */
const STOP_STEP = 0.125;

/**
 * The bar colouring of a test, from its design params.
 *
 * `null` for the `verdict` mode — the caller then passes nothing and the context stays
 * byte-identical to the one built before this setting. An unknown value reads as `verdict`
 * too: a typo in stored settings must not silently recolour a screen.
 *
 * @param params The test's design params, already resolved against the manifest defaults
 *   ({@link module:shared/template/params-css withParamDefaults}) — the template decides
 *   what an untouched test looks like.
 * @returns The setting for the builder, or `null`.
 */
export function barFillFromParams(params: Record<string, unknown> | null | undefined): BarFillSetting | null {
  const source = params ?? {};
  const raw = source[BAR_FILL_PARAM];
  if (raw !== "share" && raw !== "neutral") return null;
  return { mode: raw, ramp: rampFromParams(source) };
}

/**
 * The ramp with every end guaranteed to be a parseable triple.
 *
 * The custom scheme carries the author's own values, and the fill ends up inside a `style`
 * attribute: anything that is not a triple is replaced by the traffic scheme's end rather
 * than printed. A broken midpoint is dropped — a two-point ramp is still a ramp.
 */
function safeRamp(ramp: LevelRamp): LevelRamp {
  return {
    favorable: parseHsl(ramp.favorable) ? ramp.favorable : LEVEL_SCHEMES.traffic.favorable,
    mid: ramp.mid && parseHsl(ramp.mid) ? ramp.mid : null,
    unfavorable: parseHsl(ramp.unfavorable) ? ramp.unfavorable : LEVEL_SCHEMES.traffic.unfavorable,
  };
}

/** Round to one decimal — enough for a colour stop, short in the markup. */
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** A ramp triple as the comma form of `hsl()`; the triple is known to parse. */
function hslCss(triple: string): string {
  const c = parseHsl(triple)!;
  return `hsl(${round1(c.h)}, ${round1(c.s)}%, ${round1(c.l)}%)`;
}

/**
 * The CSS fill of a bar filled to `percent` in the «by share» mode.
 *
 * Positions are relative to the FILL, not to the track: the fill's right edge is the value,
 * so a ramp point at share `t` lands at `t / p` of the fill's width.
 *
 * @param ramp The level ramp to paint with.
 * @param percent The bar's width, 0-100.
 * @returns A `linear-gradient(...)` value, or `""` for an empty bar — there is no fill to
 *   paint, and the field is left out of the row.
 */
export function barFillCss(ramp: LevelRamp, percent: number): string {
  const p = Number.isFinite(percent) ? Math.min(Math.max(percent, 0), 100) / 100 : 0;
  if (p <= 0) return "";
  const safe = safeRamp(ramp);
  // The step divides 0.5, so a ramp with a midpoint always gets a stop exactly at its bend.
  const points: number[] = [0];
  for (let t = STOP_STEP; t < p - 1e-9; t += STOP_STEP) points.push(t);
  points.push(p);
  const stops = points.map((t) => `${hslCss(rampColor(safe, t))} ${round1((t / p) * 100)}%`);
  return `linear-gradient(90deg, ${stops.join(", ")})`;
}
