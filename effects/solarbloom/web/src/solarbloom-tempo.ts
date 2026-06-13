/**
 * Solarbloom's bespoke timing — the checkmark draw window.
 *
 * The functional confirmation (the checkmark) draws within ~240 ms regardless
 * of total duration — fast enough to land near the ~100 ms reward-prediction
 * signal and read as an unambiguous "it worked". Built on the generic
 * `easeOutCubic` primitive from `@dopaminefx/core`.
 */

import { easeOutCubic } from "@dopaminefx/core";

/** Window (ms) over which the checkmark draws in, independent of total length. */
export const CHECK_DRAW_MS = 240;

/** Checkmark draw progress (0..1) given elapsed ms. */
export function checkProgress(elapsedMs: number): number {
  return easeOutCubic(elapsedMs / CHECK_DRAW_MS);
}
