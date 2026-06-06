/**
 * LEGACY MOOD MAPPING — the TEST-ONLY parity oracle. NOT on the production path.
 *
 * This module is the original hand-written mood→params mapping. The shipping
 * runtime no longer calls it: every built-in effect now resolves its params from
 * its bundled `.dope` document via the data-driven loader (framework/loader.ts)
 * + content resolvers (framework/content.ts). What survives here is kept ONLY as
 * the byte-parity REGRESSION ORACLE: the loader.test.ts / content.test.ts suites
 * assert that the `.dope`-driven output equals these `resolve*Params` /
 * `pickWord` / `comicTypography` / `pickCheckGlyph` functions across a
 * mood × intensity × whimsy × seed grid. So this file is the frozen "golden"
 * reference — do NOT change its arithmetic (a change here is a parity break, not
 * a behavior change), and do NOT import it from production code.
 *
 * The only thing production still reads from here are the param-shape TYPES
 * (`RenderParams` / `InkRenderParams` / `ComicRenderParams` / `CheckGlyph` /
 * `ComicWord`) — pure interfaces, no behavior. The integer-clamp caps
 * (`MAX_MOTES` / `MAX_DROPS`) now live with the shaders that `#define` them and
 * are merely re-exported here for the tests' convenience.
 *
 * The research-backed relationships these tables encode:
 *   - intensity → saturation + brightness + bloom + overshoot   (arousal/valence)
 *   - whimsy    → photorealism ↔ non-photorealism (the stylization axis):
 *                 0 = true volumetric light + natural motion; 1 = cel-shaded,
 *                 neon/cyberpunk, hand-drawn "animate on twos" motion
 *   - mood      → tempo, color register, energy
 */

import type { DopamineMood } from "../types.js";
import { buildPalette, type RGB } from "./color.js";
import { mulberry32, type Rng } from "./seed.js";
import { resolveMood } from "../framework/mood-registry.js";

// The mote/drop caps are owned by the shaders that `#define` them (single source
// of truth); imported for the resolvers below and re-exported so the parity
// tests can reference one symbol.
import { MAX_MOTES } from "./shader.js";
import { MAX_DROPS } from "./inkstroke-shader.js";
export { MAX_MOTES, MAX_DROPS };

/** A built-in mood name, or any custom mood registered via `registerMood`. */
type MoodName = DopamineMood | (string & {});

/** clamp helper shared by the baseline derivations below. */
const clampN = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

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
  /**
   * Which bundled check-glyph face + codepoint the checkmark layer renders this
   * fire, chosen by WHIMSY (see `pickCheckGlyph`). Purely whimsy-derived (no rng,
   * no effect on any numeric/palette param), so the `.dope` parity stays intact
   * while the checkmark's SHAPE changes from a refined to a bold/playful glyph.
   */
  checkGlyph: CheckGlyph;
}

// ---------------------------------------------------------------------------
// SOLARBLOOM CHECK GLYPH — selected by WHIMSY.
//
// Solarbloom's checkmark is now a REAL typeface glyph (✓ U+2713 / ✔ U+2714),
// drawn into an offscreen canvas and uploaded as a texture (see
// effects/solarbloom.ts + engine/check-fonts.ts). Whimsy picks the FACE +
// CODEPOINT so the shape reads differently across the slider:
//   low whimsy  — a refined, light, calligraphic check (elegant),
//   mid whimsy  — a clean humanist check (balanced),
//   high whimsy — a fat, bold, playful heavy-check (exuberant).
// The faces are the SIL OFL check-glyph subsets bundled in check-fonts.ts; the
// `family` strings here MUST match `CHECK_FACES[*].family` there.
// ---------------------------------------------------------------------------

/** A concrete check-glyph choice: a bundled face + the codepoint to render. */
export interface CheckGlyph {
  /** CSS font-family — must match a `CHECK_FACES` entry registered at runtime. */
  family: string;
  /** The check character to draw (✓ U+2713 or ✔ U+2714). */
  char: string;
}

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
 * slider is split into equal bands so 0 → refined, 1 → bold/playful. Returned by
 * `resolveParams` and consumed by the Solarbloom renderer to pick the face it
 * rasterizes into the glyph texture.
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

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * Solarbloom baseline for a mood. Built-in moods return their exact tuned table
 * (so output stays byte-identical to the legacy engine); a custom mood
 * registered via `registerMood` derives a sensible baseline from its register +
 * energy, so a new mood lights up Solarbloom without a code edit.
 */
function solarBaseline(mood: MoodName): MoodBaseline {
  const tuned = (BASELINES as Record<string, MoodBaseline>)[mood];
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
    // Whimsy-derived check glyph (face + char); no rng, so palette/moteSeed
    // ordering and every numeric param above are unchanged (`.dope` parity holds).
    checkGlyph: pickCheckGlyph(w),
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

/**
 * Calligraphic Verdict baseline for a mood. Built-in moods return their exact
 * tuned table; a custom mood derives from its register + energy.
 */
function inkBaseline(mood: MoodName): InkBaseline {
  const tuned = (INK_BASELINES as Record<string, InkBaseline>)[mood];
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

/** Map the human knobs onto deterministic ink-stroke render parameters. */
export function resolveInkParams({ mood, intensity, whimsy, seed }: ResolveInput): InkRenderParams {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = inkBaseline(mood);
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
 * The SUCCESS-AFFIRMATION set. This is a *successful-completion* effect, not a
 * fight panel, so the word that slams in celebrates the win rather than throwing
 * a punch. Picking one per fire (by seed) is the variable-reward / novelty lever
 * — you never quite know which cheer you'll get. Kept short and blocky so the
 * simple letterforms read instantly even when slammed across the frame.
 */
export const COMIC_WORDS = [
  "YES!",
  "DONE!",
  "NICE!",
  "OKAY!",
  "WIN!",
  "GREAT!",
  "WOO!",
] as const;
export type ComicAffirmation = (typeof COMIC_WORDS)[number];

/**
 * Sentinel for the CHECKMARK render mode. The owner wants a big bold ✓ as an
 * option that can be selected exactly like a word. The renderer special-cases
 * this value and draws a *vector* check path (not a font glyph, so it's reliable
 * across every platform) where it would otherwise lay out letters.
 */
export const COMIC_CHECK = "✓" as const; // "✓"
export type ComicCheck = typeof COMIC_CHECK;

/** What gets slammed into the panel: an affirmation word OR the checkmark. */
export type ComicWord = ComicAffirmation | ComicCheck;

/**
 * The full per-fire selection pool: every affirmation plus the checkmark, so a
 * fire can land on any cheer or the big ✓. The checkmark is one entry among the
 * words, giving it the same odds as any single affirmation.
 */
export const COMIC_GLYPHS = [...COMIC_WORDS, COMIC_CHECK] as const;

/** True when the picked glyph is the vector checkmark rather than a word. */
export function isCheckmark(glyph: ComicWord): glyph is ComicCheck {
  return glyph === COMIC_CHECK;
}

/**
 * Deterministically pick a glyph (affirmation word or the checkmark) from a
 * seed. Same seed → same glyph (reproducible), but an un-pinned seed scatters
 * across the whole pool for per-fire variety.
 */
export function pickWord(seed: number): ComicWord {
  const r = mulberry32(seed >>> 0)();
  const idx = Math.min(COMIC_GLYPHS.length - 1, Math.floor(r * COMIC_GLYPHS.length));
  return COMIC_GLYPHS[idx]!;
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

  // ---- LETTERING / TYPOGRAPHY (varies by MOOD and by WHIMSY) -------------
  /**
   * Ordered CSS font-family stack for the lettering. Mood selects the *primary*
   * bundled display face (electric = Anton, condensed/aggressive; celebratory =
   * Bangers, classic exuberant comic; serene = Luckiest Guy, calmer/rounded),
   * always followed by a robust fallback chain so type still reads if a face
   * failed to load.
   */
  fontStack: string;
  /** Horizontal skew (radians) for an italic dynamic lean. Electric tilts hard. */
  fontSkew: number;
  /** Whole-word rotation tilt (radians); mood sets a base, whimsy adds bounce. */
  fontTilt: number;
  /** Non-uniform x-scale: <1 condenses (electric), >1 widens/inflates (pop-art). */
  fontStretchX: number;
  /** Letter-spacing as a fraction of font size (negative = tighter, condensed). */
  fontTracking: number;
  /** Number of stacked ink-outline passes (1 = clean inked caps, 3 = fat balloon). */
  outlineLayers: number;
  /** 3D extrude / drop depth as a fraction of font size (0 = flat, pop-art pops). */
  extrudeDepth: number;
  /** Per-letter rotation jitter amplitude (radians) — bouncier toward pop-art. */
  letterRotJitter: number;
  /** Per-letter baseline jitter amplitude as a fraction of font size. */
  letterBaselineJitter: number;
  /** Round vs miter ink joins: 0 = sharp inked corners, 1 = inflated balloon. */
  inkRoundness: number;
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

  // ---- Typographic character of the mood --------------------------------
  /** Primary bundled display face (always followed by a fallback chain). */
  face: string;
  /** Italic skew lean in radians (electric = aggressive forward tilt). */
  skew: number;
  /** Base whole-word rotation in radians. */
  tilt: number;
  /** Non-uniform horizontal scale (condensed < 1 < wide). */
  stretchX: number;
  /** Base letter-spacing as a fraction of font size. */
  tracking: number;
  /** How round the ink joins read at this mood (0 sharp → 1 soft/rounded). */
  roundness: number;
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
// A robust fallback stack appended after each mood's primary bundled face, so
// the lettering still reads (and still differentiates via the procedural
// treatment below) if a FontFace failed to load.
const FALLBACK_STACK = `"Arial Black", "Haettenschweiler", Impact, system-ui, sans-serif`;

const COMIC_BASELINES: Record<DopamineMood, ComicBaseline> = {
  // Serene: a calmer landing — rounded, softer, upright. Luckiest Guy is a
  // fat-but-friendly rounded comic face; we keep it near-upright with airy
  // tracking so it reads gentle, not shouty.
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
  // Celebratory: the classic exuberant comic shout — Bangers, lively positive
  // tilt, normal width, a touch of bounce baked in.
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
  // Electric: aggressive, sharp, condensed and hard-italic with a dynamic
  // forward tilt — Anton is a heavy condensed grotesque that reads as a fast,
  // edgy slam.
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

/**
 * Comic Impact baseline for a mood. Built-in moods return their exact tuned
 * table; a custom mood derives its slam/spike feel from energy and borrows the
 * neutral celebratory typographic character (Bangers) — the procedural treatment
 * still differentiates it via mood color + whimsy.
 */
function comicBaseline(mood: MoodName): ComicBaseline {
  const tuned = (COMIC_BASELINES as Record<string, ComicBaseline>)[mood];
  if (tuned) return tuned;
  const m = resolveMood(mood);
  const e = clamp01(m.energy);
  const neutral = COMIC_BASELINES.celebratory;
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

/** Map the human knobs onto deterministic comic-impact render parameters. */
export function resolveComicParams({ mood, intensity, whimsy, seed }: ResolveInput): ComicRenderParams {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = comicBaseline(mood);
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

/**
 * Compute Comic's lettering treatment from mood + intensity + whimsy. The
 * comic effect is data-driven for its numeric panel + palette params (via the
 * `.dope` loader); the TYPOGRAPHY (font stacks, skew/stretch curves, ink
 * stacking) is genuinely code-shaped, so it stays here and is composed on top.
 * Pure function, no randomness — same inputs → same lettering.
 */
export function comicTypography(mood: MoodName, intensity: number, whimsy: number): ComicTypography {
  const i = clamp01(intensity);
  const w = clamp01(whimsy);
  const base = comicBaseline(mood);
  // Mood gives the face + character, whimsy shifts the treatment (noir =
  // restrained inked caps → pop-art = fat, inflated, balloon lettering).
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
