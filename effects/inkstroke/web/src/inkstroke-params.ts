/**
 * Inkstroke (Calligraphic Verdict) param-SHAPE types — the resolved render
 * params the shader consumes. Values are produced data-driven by the `.dope`
 * loader (see `index.ts`); these pure interfaces just describe the bag's shape.
 */

import type { RGB } from "@dopaminefx/core";

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
