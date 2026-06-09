// Inkstroke bespoke timing — port of `inkstroke-tempo.ts` (+ swift's
// `InkstrokeTempo.swift`).
//
// A confident gesture: a touch longer than a checkmark tick so the pressure
// belly + flick read, but still inside the ~250–360 ms confirmation band so it
// lands as "done" immediately rather than as a slow build. Built on the GENERIC
// `easeOutCubic` primitive from dopamine-core — this bespoke window is the ONLY
// timing code that lives in the effect package (matching the web boundary).

package ai.dopamine.effect.inkstroke

import ai.dopamine.core.easeOutCubic

/** Window (ms) over which the calligraphic stroke writes itself. */
const val STROKE_DRAW_MS: Double = 360.0

/**
 * Calligraphic stroke / pen progress (0..1) over elapsed ms. The pen accelerates
 * into the gesture then eases off the flick — modelled as ease-out cubic so the
 * heavy belly is laid quickly and the exit decelerates into the upward flick.
 */
fun strokeProgress(elapsedMs: Double): Double =
    easeOutCubic(elapsedMs / STROKE_DRAW_MS)
