/**
 * Mood mapping — turns the three human-facing knobs (mood / intensity / whimsy)
 * plus a seed into concrete render parameters. This is where the research-backed
 * relationships live:
 *   - intensity → saturation + brightness + bloom + overshoot   (arousal/valence)
 *   - whimsy    → photorealism ↔ non-photorealism (the stylization axis):
 *                 0 = true volumetric light + natural motion; 1 = cel-shaded,
 *                 neon/cyberpunk, hand-drawn "animate on twos" motion
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
  /** 0..1 — strength of the iridescent thin-film shimmer on the bloom shell. */
  iridescence: number;
  /** 0..1 — strength of the chromatic/spectral split at the bloom edge. */
  dispersion: number;
  /** 0..1 — stylization (whimsy): photoreal lighting/motion → cel-shaded, hand-drawn. */
  style: number;
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
  /** Base iridescence/dispersion for the mood (0..1). */
  iridescence: number;
  dispersion: number;
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
    // Serene: dreamy oil-on-water shimmer, almost no hard prismatic fringe.
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
    // Celebratory: balanced — colorful shimmer and a lively spectral rim.
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
    // Electric: hard, hot prismatic edge; less milky shimmer, more raw dispersion.
    iridescence: 0.4,
    dispersion: 0.95,
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

  // whimsy is the STYLIZATION axis now (photoreal → cel/hand-drawn), so motion
  // energy + color variety key off mood/intensity instead.
  const style = w;
  const hueSpread = 0.55;
  const turbulence = base.turbulence * lerp(0.85, 1.2, i);
  const moteCount = Math.min(
    MAX_MOTES,
    Math.round(base.moteCount * lerp(0.85, 1.25, i)),
  );

  // Photoreal light tricks (oil-slick shimmer, refractive split) recede toward
  // the flat cel/cyberpunk end; a little dispersion lingers as a stylized
  // chromatic-aberration accent.
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
    // A stable but seed-derived offset that scatters the mote field.
    moteSeed: rng() * 1000,
  };
}

// ---------------------------------------------------------------------------
// Calligraphic Verdict (ink-stroke effect) parameters.
// ---------------------------------------------------------------------------

export interface InkRenderParams {
  seed: number;
  /** Total afterglow length in milliseconds. */
  durationMs: number;
  /** Three linear-RGB palette stops (ink core → mid → spray accent). */
  palette: [RGB, RGB, RGB];
  /** Overall brightness multiplier. */
  exposure: number;
  /** Held-breath overshoot magnitude for the envelope. */
  overshoot: number;
  /** Stroke length as a fraction of viewport width. */
  scale: number;
  /** Belly thickness multiplier (heavier = bolder gesture). */
  pressure: number;
  /** 0..1 — wet-ink bleed / spread amount. */
  wetness: number;
  /** 0..1 — dry-brush / bristle rake strength. */
  bristle: number;
  /** Number of droplets flung off the flick (integer). */
  droplets: number;
  /** A per-fire hash offset so the stroke wobble + spray differ run to run. */
  inkSeed: number;
  /** 0..1 — stylization (whimsy): wet sumi-e ink → flat cel/neon stroke. */
  style: number;
}

/** Must match `MAX_DROPS` in `engine/inkstroke-shader.ts`. */
export const MAX_DROPS = 64;

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

/**
 * Mood register for the gesture itself:
 *   serene      — a slow, wet, generous stroke; soft bleed, few calm droplets.
 *   celebratory — a confident bold signature; balanced bleed + a lively spray.
 *   electric    — a fast, dry, raking slash; hard bristle, a wide droplet burst.
 * Hue centers mirror Solarbloom (cool → warm with arousal) for brand coherence.
 */
const INK_BASELINES: Record<DopamineMood, InkBaseline> = {
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

/** Map the human knobs onto deterministic ink-stroke render parameters. */
export function resolveInkParams({ mood, intensity, whimsy, seed }: ResolveInput): InkRenderParams {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = INK_BASELINES[mood];
  const rng: Rng = mulberry32(seed);

  // intensity → saturation, brightness, gesture boldness, spray volume.
  const chroma = base.chroma * lerp(0.7, 1.5, i);
  const exposure = lerp(0.8, 1.55, i);
  const pressure = base.pressure * lerp(0.85, 1.2, i);
  const scale = base.scale * lerp(0.9, 1.08, i);
  const overshoot = base.overshoot * lerp(0.7, 1.25, i);
  const droplets = Math.min(MAX_DROPS, Math.round(base.droplets * lerp(0.7, 1.3, i)));

  // whimsy is the stylization axis: toward the cel/neon end the ink dries out
  // (less wet bleed) and rakes harder (more bristle), reading as a flat drawn
  // slash rather than a wet sumi-e mark.
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

// ---------------------------------------------------------------------------
// Comic Impact ("BAM! POW!") parameters.
//
// A Golden/Silver-Age comic fight-panel impact: a hand-lettered onomatopoeia
// word slams in over a jagged starburst, with bold ink outlines, radiating
// action lines and Ben-Day / halftone dot shading. whimsy is the
// PHOTOREAL ↔ NON-PHOTOREAL (here: moody NOIR ↔ full POP-ART) axis:
//   whimsy 0 — high-contrast chiaroscuro inking, near-monochrome with one spot
//              color, restrained/subtle halftone, gritty.
//   whimsy 1 — saturated Ben-Day dots, thick bold ink outlines, screaming
//              color, snappy animate-on-twos motion.
// ---------------------------------------------------------------------------

/**
 * The onomatopoeia set. Picking one per fire (by seed) is the variable-reward /
 * novelty lever — you never quite know which punch you'll get. Kept short and
 * blocky so the simple letterforms read instantly.
 */
export const COMIC_WORDS = ["BAM!", "POW!", "BIFF!", "WHAM!", "ZAP!", "KAPOW!"] as const;
export type ComicWord = (typeof COMIC_WORDS)[number];

/**
 * Deterministically pick an onomatopoeia word from a seed. Same seed → same
 * word (reproducible), but an un-pinned seed scatters across the set for
 * per-fire variety.
 */
export function pickWord(seed: number): ComicWord {
  const r = mulberry32(seed >>> 0)();
  const idx = Math.min(COMIC_WORDS.length - 1, Math.floor(r * COMIC_WORDS.length));
  return COMIC_WORDS[idx]!;
}

export interface ComicRenderParams {
  seed: number;
  /** Total effect length in milliseconds (impact + hold + settle). */
  durationMs: number;
  /** Three linear-RGB palette stops (word fill → secondary → dot/accent). */
  palette: [RGB, RGB, RGB];
  /** The onomatopoeia word slammed into the panel this fire. */
  word: ComicWord;
  /** Overall brightness multiplier (cast-light gain). */
  exposure: number;
  /** Slam overshoot/recoil magnitude (drives the punch). */
  overshoot: number;
  /** Word size as a fraction of viewport min dimension. */
  scale: number;
  /** Number of points on the jagged starburst (integer). */
  burstPoints: number;
  /** Number of radiating action/speed lines (integer). */
  actionLines: number;
  /** Ink outline thickness (px at 1x dpr, scaled in the renderer). */
  inkWeight: number;
  /** 0..1 — Ben-Day halftone dot strength (subtle noir → loud pop-art). */
  halftone: number;
  /** Ben-Day dot cell size in device px (smaller = finer screen). */
  dotSize: number;
  /** 0..1 — color saturation of the panel (near-mono noir → screaming pop). */
  saturation: number;
  /** A per-fire hash offset so burst spikes + line angles differ run to run. */
  comicSeed: number;
  /** 0..1 — stylization (whimsy): noir chiaroscuro → full pop-art. */
  style: number;
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
}

/**
 * Mood register for the punch:
 *   serene      — a softer "thump": fewer spikes, calmer lines, cooler hue, the
 *                 word lands but doesn't scream. (Still a comic, just gentler.)
 *   celebratory — the classic hero hit: bold, warm, lively spike count + lines.
 *   electric    — a savage KAPOW: many spikes, dense action lines, hot hue, the
 *                 hardest slam.
 * Hue centers mirror Solarbloom/Verdict (cool → warm with arousal).
 */
const COMIC_BASELINES: Record<DopamineMood, ComicBaseline> = {
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
  },
};

/** Map the human knobs onto deterministic comic-impact render parameters. */
export function resolveComicParams({ mood, intensity, whimsy, seed }: ResolveInput): ComicRenderParams {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = COMIC_BASELINES[mood];
  const rng: Rng = mulberry32(seed);

  // intensity → saturation/brightness, slam force, word size, spike + line count.
  const chroma = base.chroma * lerp(0.7, 1.5, i);
  const exposure = lerp(0.85, 1.5, i);
  const overshoot = base.overshoot * lerp(0.7, 1.3, i);
  const scale = base.scale * lerp(0.85, 1.12, i);
  const burstPoints = Math.round(base.burstPoints * lerp(0.8, 1.2, i));
  const actionLines = Math.round(base.actionLines * lerp(0.7, 1.25, i));

  // whimsy is the NOIR ↔ POP-ART stylization axis. Toward pop-art the halftone
  // screams (loud, large dots), the ink fattens, and color floods in. Toward
  // noir it's near-monochrome chiaroscuro with a restrained, fine, subtle dot.
  const style = w;
  const halftone = clamp01(lerp(0.28, 1.0, w));
  // Dots get LARGER (louder, more graphic) toward pop-art; finer/subtler at noir.
  const dotSize = lerp(5.0, 11.0, w);
  // Saturation: near-mono one-spot-color noir → screaming pop. Intensity nudges.
  const saturation = clamp01(lerp(0.18, 1.0, w) * lerp(0.8, 1.1, i));
  // Ink outline weight thickens toward the bold pop-art register.
  const inkWeight = lerp(5.0, 12.0, w) * lerp(0.85, 1.1, i);

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
  };
}
