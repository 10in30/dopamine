/**
 * Solarbloom param-SHAPE types — the resolved render params the shader + check
 * layer consume. The values are produced data-driven by the `.dope` loader (see
 * `index.ts`); these pure interfaces just describe the bag's shape.
 */

import type { RGB } from "@dopamine/core";

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
   * fire, chosen by WHIMSY. Purely whimsy-derived (no rng, no effect on any
   * numeric/palette param), so the `.dope` parity stays intact while the
   * checkmark's SHAPE changes from a refined to a bold/playful glyph.
   */
  checkGlyph: CheckGlyph;
}

/** A concrete check-glyph choice: a bundled face + the codepoint to render. */
export interface CheckGlyph {
  /** CSS font-family — must match a `CHECK_FACES` entry registered at runtime. */
  family: string;
  /** The check character to draw (✓ U+2713 or ✔ U+2714). */
  char: string;
}
