/**
 * LEGACY COMIC IMPACT MOOD MAPPING — the TEST-ONLY parity oracle. NOT on the
 * production path.
 *
 * The shipping runtime resolves Comic's numeric/palette params from the bundled
 * `.dope` via the loader, the WORD via the content `pool`, and the TYPOGRAPHY
 * via the content typography resolver. This module is the original hand-written
 * mapping, kept ONLY as the byte-parity REGRESSION ORACLE. Do NOT change its
 * arithmetic (a change here is a parity break), and do NOT import it from
 * production code.
 */

import { buildPalette, mulberry32, resolveMood, type RGB, type Rng } from "@dopamine/core";
import {
  COMIC_GLYPHS,
  type ComicRenderParams,
  type ComicWord,
} from "./comic-params.js";
export {
  COMIC_WORDS,
  COMIC_CHECK,
  COMIC_GLYPHS,
  isCheckmark,
  type ComicWord,
  type ComicRenderParams,
} from "./comic-params.js";

type MoodName = string;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const clampN = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Deterministically pick a glyph (affirmation word or the checkmark) from a
 * seed. Same seed → same glyph (reproducible).
 */
export function pickWord(seed: number): ComicWord {
  const r = mulberry32(seed >>> 0)();
  const idx = Math.min(COMIC_GLYPHS.length - 1, Math.floor(r * COMIC_GLYPHS.length));
  return COMIC_GLYPHS[idx]!;
}

interface ComicBaseline {
  durationMs: number;
  lightness: number;
  chroma: number;
  hueCenter: number;
  hueRange: number;
  scale: number;
  burstPoints: number;
  actionLines: number;
  overshoot: number;
  face: string;
  skew: number;
  tilt: number;
  stretchX: number;
  tracking: number;
  roundness: number;
}

const FALLBACK_STACK = `"Arial Black", "Haettenschweiler", Impact, system-ui, sans-serif`;

const COMIC_BASELINES: Record<string, ComicBaseline> = {
  serene: {
    durationMs: 2400,
    lightness: 0.82,
    chroma: 0.1,
    hueCenter: 230,
    hueRange: 120,
    scale: 0.34,
    burstPoints: 14,
    actionLines: 18,
    overshoot: 0.55,
    face: `"Luckiest Guy"`,
    skew: 0.0,
    tilt: -0.015,
    stretchX: 1.0,
    tracking: 0.04,
    roundness: 1.0,
  },
  celebratory: {
    durationMs: 1900,
    lightness: 0.82,
    chroma: 0.18,
    hueCenter: 50,
    hueRange: 320,
    scale: 0.4,
    burstPoints: 20,
    actionLines: 30,
    overshoot: 1.0,
    face: `"Bangers"`,
    skew: -0.06,
    tilt: -0.05,
    stretchX: 1.0,
    tracking: 0.0,
    roundness: 0.55,
  },
  electric: {
    durationMs: 1500,
    lightness: 0.8,
    chroma: 0.24,
    hueCenter: 35,
    hueRange: 150,
    scale: 0.46,
    burstPoints: 28,
    actionLines: 44,
    overshoot: 1.45,
    face: `"Anton"`,
    skew: -0.26,
    tilt: -0.1,
    stretchX: 0.82,
    tracking: -0.02,
    roundness: 0.1,
  },
};

function comicBaseline(mood: MoodName): ComicBaseline {
  const tuned = COMIC_BASELINES[mood];
  if (tuned) return tuned;
  const m = resolveMood(mood);
  const e = clamp01(m.energy);
  const neutral = COMIC_BASELINES.celebratory!;
  return {
    durationMs: Math.round(lerp(2400, 1500, e)),
    lightness: m.lightness,
    chroma: m.chroma,
    hueCenter: m.hueCenter,
    hueRange: m.hueRange,
    scale: lerp(0.34, 0.46, e),
    burstPoints: Math.round(lerp(14, 28, e)),
    actionLines: Math.round(lerp(18, 44, e)),
    overshoot: lerp(0.55, 1.45, e),
    face: neutral.face,
    skew: lerp(0.0, -0.26, e),
    tilt: lerp(-0.015, -0.1, e),
    stretchX: lerp(1.0, 0.82, e),
    tracking: lerp(0.04, -0.02, e),
    roundness: clampN(lerp(1.0, 0.1, e), 0, 1),
  };
}

export interface ResolveInput {
  mood: MoodName;
  intensity: number;
  whimsy: number;
  seed: number;
}

/** Map the human knobs onto deterministic comic-impact render parameters. */
export function resolveComicParams({ mood, intensity, whimsy, seed }: ResolveInput): ComicRenderParams {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = comicBaseline(mood);
  const rng: Rng = mulberry32(seed);

  const chroma = base.chroma * lerp(0.7, 1.5, i);
  const exposure = lerp(0.85, 1.5, i);
  const overshoot = base.overshoot * lerp(0.7, 1.3, i);
  const scale = base.scale * lerp(0.85, 1.12, i);
  const burstPoints = Math.round(base.burstPoints * lerp(0.8, 1.2, i));
  const actionLines = Math.round(base.actionLines * lerp(0.7, 1.25, i));

  const style = w;
  const halftone = clamp01(lerp(0.28, 1.0, w));
  const dotSize = lerp(5.0, 11.0, w);
  const saturation = clamp01(lerp(0.18, 1.0, w) * lerp(0.8, 1.1, i));
  const inkWeight = lerp(5.0, 12.0, w) * lerp(0.85, 1.1, i);

  const typo = comicTypography(mood, i, w);

  const palette = buildPalette(rng, {
    lightness: base.lightness,
    chroma,
    hueCenter: base.hueCenter,
    hueRange: base.hueRange,
    hueSpread: 0.55,
  }) as [RGB, RGB, RGB];

  const comicSeed = rng() * 1000;

  return {
    seed,
    durationMs: Math.round(base.durationMs * lerp(1.1, 0.9, i)),
    palette,
    word: pickWord(seed),
    exposure,
    overshoot,
    scale,
    burstPoints,
    actionLines,
    inkWeight,
    halftone,
    dotSize,
    saturation,
    comicSeed,
    style,
    ...typo,
  };
}

/** The typographic fields of `ComicRenderParams` — pure (no rng). */
export type ComicTypography = Pick<
  ComicRenderParams,
  | "fontStack" | "fontSkew" | "fontTilt" | "fontStretchX" | "fontTracking"
  | "outlineLayers" | "extrudeDepth" | "letterRotJitter" | "letterBaselineJitter" | "inkRoundness"
>;

/** Compute Comic's lettering treatment from mood + intensity + whimsy. */
export function comicTypography(mood: MoodName, intensity: number, whimsy: number): ComicTypography {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = comicBaseline(mood);
  const fontStack = `${base.face}, ${FALLBACK_STACK}`;
  const fontStretchX = base.stretchX * lerp(1.0, 1.18, w);
  const fontSkew = base.skew * lerp(1.0, 0.7, w) * lerp(0.9, 1.1, i);
  const fontTilt = base.tilt + lerp(0.0, -0.04, w);
  const fontTracking = base.tracking + lerp(0.0, 0.02, w);
  const outlineLayers = Math.max(1, Math.round(lerp(1, 3, w) * lerp(0.95, 1.05, i)));
  const extrudeDepth = lerp(0.0, 0.13, w) * lerp(0.85, 1.15, i);
  const letterRotJitter = lerp(0.0, 0.16, w);
  const letterBaselineJitter = lerp(0.0, 0.06, w);
  const inkRoundness = clamp01(lerp(base.roundness * 0.6, 1.0, w));
  return {
    fontStack, fontSkew, fontTilt, fontStretchX, fontTracking,
    outlineLayers, extrudeDepth, letterRotJitter, letterBaselineJitter, inkRoundness,
  };
}
