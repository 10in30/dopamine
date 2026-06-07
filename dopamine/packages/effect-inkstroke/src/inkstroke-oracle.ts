/**
 * LEGACY INKSTROKE (Calligraphic Verdict) MOOD MAPPING — the TEST-ONLY parity
 * oracle. NOT on the production path.
 *
 * The shipping runtime resolves Inkstroke's params from the bundled `.dope`
 * document via the data-driven loader. This module is the original hand-written
 * mood→params mapping, kept ONLY as the byte-parity REGRESSION ORACLE. Do NOT
 * change its arithmetic (a change here is a parity break), and do NOT import it
 * from production code.
 */

import { buildPalette, mulberry32, resolveMood, type RGB, type Rng } from "@dopamine/core";
import type { InkRenderParams } from "./inkstroke-params.js";
// The droplet cap is owned by the shader that `#define`s it (single source of truth).
import { MAX_DROPS } from "./inkstroke-shader.js";
export { MAX_DROPS };
export type { InkRenderParams } from "./inkstroke-params.js";

type MoodName = string;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

interface InkBaseline {
  durationMs: number;
  lightness: number;
  chroma: number;
  hueCenter: number;
  hueRange: number;
  scale: number;
  pressure: number;
  wetness: number;
  bristle: number;
  droplets: number;
  overshoot: number;
}

const INK_BASELINES: Record<string, InkBaseline> = {
  serene: {
    durationMs: 2600,
    lightness: 0.82,
    chroma: 0.1,
    hueCenter: 230,
    hueRange: 120,
    scale: 0.62,
    pressure: 1.05,
    wetness: 0.95,
    bristle: 0.25,
    droplets: 10,
    overshoot: 0.55,
  },
  celebratory: {
    durationMs: 1900,
    lightness: 0.82,
    chroma: 0.17,
    hueCenter: 50,
    hueRange: 320,
    scale: 0.72,
    pressure: 1.25,
    wetness: 0.65,
    bristle: 0.5,
    droplets: 30,
    overshoot: 1.0,
  },
  electric: {
    durationMs: 1300,
    lightness: 0.8,
    chroma: 0.24,
    hueCenter: 35,
    hueRange: 150,
    scale: 0.82,
    pressure: 1.45,
    wetness: 0.4,
    bristle: 0.9,
    droplets: 52,
    overshoot: 1.45,
  },
};

function inkBaseline(mood: MoodName): InkBaseline {
  const tuned = INK_BASELINES[mood];
  if (tuned) return tuned;
  const m = resolveMood(mood);
  const e = clamp01(m.energy);
  return {
    durationMs: Math.round(lerp(2600, 1300, e)),
    lightness: m.lightness,
    chroma: m.chroma,
    hueCenter: m.hueCenter,
    hueRange: m.hueRange,
    scale: lerp(0.62, 0.82, e),
    pressure: lerp(1.05, 1.45, e),
    wetness: lerp(0.95, 0.4, e),
    bristle: lerp(0.25, 0.9, e),
    droplets: Math.round(lerp(10, 52, e)),
    overshoot: lerp(0.55, 1.45, e),
  };
}

export interface ResolveInput {
  mood: MoodName;
  intensity: number;
  whimsy: number;
  seed: number;
}

/** Map the human knobs onto deterministic ink-stroke render parameters. */
export function resolveInkParams({ mood, intensity, whimsy, seed }: ResolveInput): InkRenderParams {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = inkBaseline(mood);
  const rng: Rng = mulberry32(seed);

  const chroma = base.chroma * lerp(0.7, 1.5, i);
  const exposure = lerp(0.8, 1.55, i);
  const pressure = base.pressure * lerp(0.85, 1.2, i);
  const scale = base.scale * lerp(0.9, 1.08, i);
  const overshoot = base.overshoot * lerp(0.7, 1.25, i);
  const droplets = Math.min(MAX_DROPS, Math.round(base.droplets * lerp(0.7, 1.3, i)));

  const style = w;
  const wetness = clamp01(base.wetness * lerp(1.0, 0.35, w));
  const bristle = clamp01(base.bristle * lerp(0.85, 1.25, w) * lerp(0.9, 1.1, i));

  const palette = buildPalette(rng, {
    lightness: base.lightness,
    chroma,
    hueCenter: base.hueCenter,
    hueRange: base.hueRange,
    hueSpread: 0.55,
  }) as [RGB, RGB, RGB];

  return {
    seed,
    durationMs: Math.round(base.durationMs * lerp(1.1, 0.9, i)),
    palette,
    exposure,
    overshoot,
    scale,
    pressure,
    wetness,
    bristle,
    droplets,
    style,
    inkSeed: rng() * 1000,
  };
}
