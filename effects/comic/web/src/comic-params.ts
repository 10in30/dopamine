/**
 * Comic Impact param-SHAPE types + content tokens.
 *
 * The resolved render params the panel + shader consume (produced data-driven
 * by the `.dope` loader + content resolver), plus the affirmation/checkmark
 * token pool. The numeric/palette fields come from the loader; the WORD and the
 * TYPOGRAPHY are composed on top (see `index.ts`).
 */

import type { RGB } from "@dopamine/core";

/**
 * The SUCCESS-AFFIRMATION set — this is a successful-completion effect, so the
 * word that slams in celebrates the win. Kept short + blocky so the simple
 * letterforms read instantly even when slammed across the frame.
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

/** Sentinel for the CHECKMARK render mode — the renderer draws a vector check. */
export const COMIC_CHECK = "✓" as const;
export type ComicCheck = typeof COMIC_CHECK;

/** What gets slammed into the panel: an affirmation word OR the checkmark. */
export type ComicWord = ComicAffirmation | ComicCheck;

/** The full per-fire selection pool: every affirmation plus the checkmark. */
export const COMIC_GLYPHS = [...COMIC_WORDS, COMIC_CHECK] as const;

/** True when the picked glyph is the vector checkmark rather than a word. */
export function isCheckmark(glyph: ComicWord): glyph is ComicCheck {
  return glyph === COMIC_CHECK;
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
  /** Ordered CSS font-family stack for the lettering. */
  fontStack: string;
  /** Horizontal skew (radians) for an italic dynamic lean. */
  fontSkew: number;
  /** Whole-word rotation tilt (radians). */
  fontTilt: number;
  /** Non-uniform x-scale: <1 condenses, >1 widens/inflates. */
  fontStretchX: number;
  /** Letter-spacing as a fraction of font size (negative = tighter). */
  fontTracking: number;
  /** Number of stacked ink-outline passes. */
  outlineLayers: number;
  /** 3D extrude / drop depth as a fraction of font size. */
  extrudeDepth: number;
  /** Per-letter rotation jitter amplitude (radians). */
  letterRotJitter: number;
  /** Per-letter baseline jitter amplitude as a fraction of font size. */
  letterBaselineJitter: number;
  /** Round vs miter ink joins: 0 = sharp inked corners, 1 = inflated balloon. */
  inkRoundness: number;
}
