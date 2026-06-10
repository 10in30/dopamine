// Solarbloom's bespoke timing — port of `solarbloom-tempo.ts`.
//
// The functional confirmation (the checkmark) draws within ~240 ms regardless
// of total duration — fast enough to land near the ~100 ms reward-prediction
// signal and read as an unambiguous "it worked". Built on the GENERIC
// `easeOutCubic` primitive from dopamine-core — this bespoke window is the ONLY
// timing code that lives in the effect package (matching the web/swift boundary).

package ai.dopamine.effect.solarbloom

import ai.dopamine.core.easeOutCubic

/** Window (ms) over which the checkmark draws in, independent of total length. */
const val CHECK_DRAW_MS: Double = 240.0

/** Checkmark draw progress (0..1) given elapsed ms. */
fun checkProgress(elapsedMs: Double): Double = easeOutCubic(elapsedMs / CHECK_DRAW_MS)
