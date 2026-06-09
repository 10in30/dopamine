// Aurora bespoke timing — port of the inline timing helpers in the web
// `effect-aurora/src/index.ts` (aurora has NO separate `-tempo.ts`; its timing
// lives in the config's `frame()`) + swift's `Aurora.swift` frame().
//
// Aurora's envelope is the GENERIC `envelope(life, overshoot)` from dopamine-core
// (brighten -> fade) — it has no bespoke envelope shape. The ONLY effect-specific
// timing is the accumulated sideways SWEEP: a slow, ambient sideways travel of
// the whole curtain band that eases off as the effect settles (so the curtains
// drift IN then settle rather than scrolling forever). Both are pure functions of
// the frame clock — frame-perfect and cheap.

package ai.dopamine.effect.aurora

/** Sideways sweep speed (fraction of width per second). Slow, ambient drift. */
const val SWEEP_SPEED: Double = 0.02

/**
 * Accumulated sideways sweep offset (fraction of width) for the curtain band.
 * Slow ambient travel; the sweep eases (`1 - 0.5*life`) so the curtains drift in
 * then settle rather than scroll forever. `animMs` is the (style-snapped) clock,
 * `life` the normalized progress — exactly the web `frame()`'s `uSweep` expression
 * and swift's `sweep`.
 */
fun auroraSweep(animMs: Double, life: Double): Double =
    SWEEP_SPEED * (animMs / 1000.0) * (1.0 - 0.5 * life)
