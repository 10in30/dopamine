// Animation tempo PRIMITIVES — direct port of `engine/tempo.ts`.
//
// The GENERIC easing + envelope building blocks shared across effects. Each
// effect's BESPOKE envelope (Solarbloom's check-draw, Heartburst's lub-dub, …)
// lives in that effect's own module on top of these, exactly as in the web lib.

package ai.dopamine.core

import kotlin.math.pow

/**
 * Coarse animation step (ms) for the "animate on twos" look at full whimsy
 * (~12 updates/sec). Motion snaps toward this grid as style rises.
 */
const val NPR_TIME_STEP_MS: Double = 1000.0 / 12.0

/** Clamp into [0, 1]. */
fun tempoClamp01(x: Double): Double = if (x < 0) 0.0 else if (x > 1) 1.0 else x

/** Classic ease-out cubic — quick start, gentle settle. */
fun easeOutCubic(x: Double): Double {
    val t = tempoClamp01(x)
    return 1.0 - (1.0 - t).pow(3.0)
}

/** Ease-out "back" — overshoots past 1 then settles to 1 at x=1. */
fun easeOutBack(x: Double, overshoot: Double = 1.0): Double {
    val t = tempoClamp01(x)
    val c1 = 1.70158 * overshoot
    val c3 = c1 + 1.0
    return 1.0 + c3 * (t - 1.0).pow(3.0) + c1 * (t - 1.0).pow(2.0)
}

/**
 * Bloom amplitude over normalized life t ∈ [0, 1]: fast overshooting attack in
 * the first ~18%, then a long decay to zero. envelope(0)==0, envelope(1)==0.
 */
fun envelope(t: Double, overshoot: Double = 1.0): Double {
    if (t <= 0.0 || t >= 1.0) return 0.0
    val attack = 0.18
    if (t < attack) return easeOutBack(t / attack, overshoot)
    val x = (t - attack) / (1.0 - attack)
    return (1.0 - x).pow(1.6)
}

/**
 * The "animate on twos" clock snap, shared by every drawable runner: as `style`
 * (whimsy) rises, the real clock is lerped toward a coarse grid so motion poses
 * on discrete beats. Pure function — the single source of the stepping math.
 */
fun steppedAnimMs(elapsedMs: Double, style: Double): Double {
    val stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS
    return elapsedMs + (stepped - elapsedMs) * style
}
