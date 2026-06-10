/**
 * LEGACY SOLARBLOOM MOOD MAPPING — the TEST-ONLY parity oracle. NOT on the
 * production path.
 *
 * The shipping runtime resolves Solarbloom's params from the bundled `.dope`
 * document via the data-driven loader. This module is the original hand-written
 * mood→params mapping, kept ONLY as the byte-parity REGRESSION ORACLE: the
 * parity test asserts the `.dope`-driven loader output equals these
 * `resolveParams` / `pickCheckGlyph` functions across a mood × intensity ×
 * whimsy × seed grid. Do NOT change its arithmetic (a change here is a parity
 * break, not a behavior change), and do NOT import it from production code.
 */

import { buildPalette, mulberry32, resolveMood, type RGB, type Rng } from "@dopamine/core";
import type { CheckGlyph, RenderParams } from "./solarbloom-params.js";
// The mote cap is owned by the shader that `#define`s it (single source of truth).
import { MAX_MOTES } from "./solarbloom-shader.js";
export { MAX_MOTES };
export type { CheckGlyph, RenderParams } from "./solarbloom-params.js";

type MoodName = string;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Whimsy bands → (face, char). Ordered low→high whimsy. Both faces ship in
 * check-fonts.ts; "Symbols" carries the calligraphic ✓ and a fat playful ✔,
 * "Sans" carries a clean humanist ✓.
 */
const CHECK_GLYPHS: readonly CheckGlyph[] = [
  { family: "Dopamine Check Symbols", char: "✓" }, // elegant calligraphic ✓
  { family: "Dopamine Check Sans", char: "✔" },    // clean humanist heavy ✔
  { family: "Dopamine Check Symbols", char: "✔" }, // fat playful heavy ✔
];

/**
 * Pick the check glyph for a whimsy value (0..1). Pure + deterministic: the
 * slider is split into equal bands so 0 → refined, 1 → bold/playful.
 */
export function pickCheckGlyph(whimsy: number): CheckGlyph {
  const w = clamp01(whimsy);
  const idx = Math.min(CHECK_GLYPHS.length - 1, Math.floor(w * CHECK_GLYPHS.length));
  return CHECK_GLYPHS[idx]!;
}

interface MoodBaseline {
  durationMs: number;
  lightness: number;
  chroma: number;
  hueCenter: number;
  hueRange: number;
  bloomRadius: number;
  moteCount: number;
  moteSpeed: number;
  turbulence: number;
  overshoot: number;
  iridescence: number;
  dispersion: number;
}

const BASELINES: Record<string, MoodBaseline> = {
  serene: {
    durationMs: 2600,
    lightness: 0.84,
    chroma: 0.09,
    hueCenter: 230,
    hueRange: 120,
    bloomRadius: 0.85,
    moteCount: 22,
    moteSpeed: 0.55,
    turbulence: 0.35,
    overshoot: 0.55,
    iridescence: 0.85,
    dispersion: 0.35,
  },
  celebratory: {
    durationMs: 1800,
    lightness: 0.8,
    chroma: 0.16,
    hueCenter: 50,
    hueRange: 320,
    bloomRadius: 0.7,
    moteCount: 48,
    moteSpeed: 0.85,
    turbulence: 0.6,
    overshoot: 1.0,
    iridescence: 0.6,
    dispersion: 0.6,
  },
  electric: {
    durationMs: 1200,
    lightness: 0.78,
    chroma: 0.23,
    hueCenter: 35,
    hueRange: 150,
    bloomRadius: 0.6,
    moteCount: 72,
    moteSpeed: 1.25,
    turbulence: 0.9,
    overshoot: 1.45,
    iridescence: 0.4,
    dispersion: 0.95,
  },
};

function solarBaseline(mood: MoodName): MoodBaseline {
  const tuned = BASELINES[mood];
  if (tuned) return tuned;
  const m = resolveMood(mood);
  const e = clamp01(m.energy);
  return {
    durationMs: Math.round(lerp(2600, 1200, e)),
    lightness: m.lightness,
    chroma: m.chroma,
    hueCenter: m.hueCenter,
    hueRange: m.hueRange,
    bloomRadius: lerp(0.85, 0.6, e),
    moteCount: Math.round(lerp(22, 72, e)),
    moteSpeed: lerp(0.55, 1.25, e),
    turbulence: lerp(0.35, 0.9, e),
    overshoot: lerp(0.55, 1.45, e),
    iridescence: lerp(0.85, 0.4, e),
    dispersion: lerp(0.35, 0.95, e),
  };
}

export interface ResolveInput {
  mood: MoodName;
  intensity: number;
  whimsy: number;
  seed: number;
}

/** Map the human knobs onto concrete, deterministic render parameters. */
export function resolveParams({ mood, intensity, whimsy, seed }: ResolveInput): RenderParams {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = solarBaseline(mood);
  const rng: Rng = mulberry32(seed);

  const chroma = base.chroma * lerp(0.7, 1.5, i);
  const exposure = lerp(0.75, 1.5, i);
  const bloomRadius = base.bloomRadius * lerp(0.8, 1.15, i);
  const overshoot = base.overshoot * lerp(0.7, 1.25, i);

  const style = w;
  const hueSpread = 0.55;
  const turbulence = base.turbulence * lerp(0.85, 1.2, i);
  const moteCount = Math.min(
    MAX_MOTES,
    Math.round(base.moteCount * lerp(0.85, 1.25, i)),
  );

  const iridescence = clamp01(base.iridescence * lerp(1.0, 0.12, w));
  const dispersion = clamp01(base.dispersion * lerp(1.0, 0.45, w) * lerp(0.85, 1.1, i));

  const palette = buildPalette(rng, {
    lightness: base.lightness,
    chroma,
    hueCenter: base.hueCenter,
    hueRange: base.hueRange,
    hueSpread,
  }) as [RGB, RGB, RGB];

  return {
    seed,
    durationMs: Math.round(base.durationMs * lerp(1.1, 0.9, i)),
    palette,
    exposure,
    bloomRadius,
    moteCount,
    moteSpeed: base.moteSpeed,
    turbulence,
    overshoot,
    iridescence,
    dispersion,
    style,
    moteSeed: rng() * 1000,
    checkGlyph: pickCheckGlyph(w),
  };
}
