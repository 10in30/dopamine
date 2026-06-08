/**
 * Inkstroke's bespoke timing — the calligraphic stroke draw window.
 *
 * A confident gesture: a touch longer than a checkmark tick so the pressure
 * belly + flick read, but still inside the ~250–360 ms confirmation band so it
 * lands as "done" immediately rather than as a slow build. Built on the generic
 * `easeOutCubic` primitive from `@dopamine/core`.
 */

import { easeOutCubic } from "@dopamine/core";

/** Window (ms) over which the calligraphic stroke writes itself. */
export const STROKE_DRAW_MS = 360;

/**
 * Calligraphic stroke / pen progress (0..1) over elapsed ms. The pen accelerates
 * into the gesture then eases off the flick — modelled as ease-out cubic so the
 * heavy belly is laid quickly and the exit decelerates into the upward flick.
 */
export function strokeProgress(elapsedMs: number): number {
  return easeOutCubic(elapsedMs / STROKE_DRAW_MS);
}
