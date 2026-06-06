/**
 * Mood mapping — turns the three human-facing knobs (mood / intensity / whimsy)
 * plus a seed into concrete render parameters. This is where the research-backed
 * relationships live:
 *   - intensity → saturation + brightness + bloom + overshoot   (arousal/valence)
 *   - whimsy    → hue spread + turbulence + mote count jitter    (playfulness)
 *   - mood      → tempo, color register, energy
 */

import type { DopamineMood } from "../types.js";
import { buildPalette, type RGB } from "./color.js";
import { mulberry32, type Rng } from "./seed.js";

export interface RenderParams {
  seed: number;
  /** Total afterglow length in milliseconds. */
  durationMs: number;
  /** Three linear-RGB palette stops. */
  palette: [RGB, RGB, RGB];
  /** Overall brightness multiplier for the bloom + motes. */
  exposure: number;
  /** Bloom radius as a fraction of the smaller viewport dimension. */
  bloomRadius: number;
  /** Number of drifting light motes (integer). */
  moteCount: number;
  /** How fast motes travel outward. */
  moteSpeed: number;
  /** Curl/buoyancy turbulence applied to mote paths. */
  turbulence: number;
  /** Held-breath overshoot magnitude for the envelope. */
  overshoot: number;
  /** A per-fire hash offset so mote layouts differ run to run. */
  moteSeed: number;
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
}

/**
 * Hue centers: arousal rises blue→green→red, so the hotter the mood, the warmer
 * (and narrower) its hue band. `serene` stays cool; `celebratory` roams nearly
 * the whole wheel for maximum novelty; `electric` leans hot.
 */
const BASELINES: Record<DopamineMood, MoodBaseline> = {
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
  },
};

/** Must match `MAX_MOTES` in `engine/shader.ts` — counts above this won't render. */
export const MAX_MOTES = 80;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export interface ResolveInput {
  mood: DopamineMood;
  intensity: number;
  whimsy: number;
  seed: number;
}

/** Map the human knobs onto concrete, deterministic render parameters. */
export function resolveParams({ mood, intensity, whimsy, seed }: ResolveInput): RenderParams {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = BASELINES[mood];
  const rng: Rng = mulberry32(seed);

  // intensity drives saturation + brightness (arousal & positive valence).
  const chroma = base.chroma * lerp(0.7, 1.5, i);
  const exposure = lerp(0.75, 1.5, i);
  const bloomRadius = base.bloomRadius * lerp(0.8, 1.15, i);
  const overshoot = base.overshoot * lerp(0.7, 1.25, i);

  // whimsy drives spread + turbulence + how many motes.
  const hueSpread = clamp01(0.25 + 0.75 * w);
  const turbulence = base.turbulence * lerp(0.6, 1.4, w);
  const moteCount = Math.min(
    MAX_MOTES,
    Math.round(base.moteCount * lerp(0.8, 1.3, w) * lerp(0.85, 1.25, i)),
  );

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
    // A stable but seed-derived offset that scatters the mote field.
    moteSeed: rng() * 1000,
  };
}
