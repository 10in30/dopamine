// Comic Impact bespoke timing — port of `comic-tempo.ts` (cross-checked against
// swift's `ComicTempo.swift`).
//
// The word arrives oversized and slams down past its rest size, recoils (a quick
// spring), holds proud, then eases out at the tail. Deliberately very short
// IMPACT so the word reads as a punch landing, not a tween. Built on the GENERIC
// `easeOutCubic` + `tempoClamp01` primitives from dopamine-core — this bespoke
// slam/recoil + proud-hold-then-fade is the ONLY timing code that lives in the
// effect package (matching the web boundary).

package ai.dopamine.effect.comic

import ai.dopamine.core.easeOutCubic
import ai.dopamine.core.tempoClamp01
import kotlin.math.PI
import kotlin.math.pow
import kotlin.math.sin

/** Window (ms) over which the comic onomatopoeia word SLAMS in. */
const val IMPACT_MS: Double = 200.0

/** Hold (ms) the word sits proud at full size before it begins to settle out. */
const val IMPACT_HOLD_MS: Double = 650.0

/**
 * Comic impact SCALE over elapsed ms. Returns a multiplier on rest size: large
 * at t≈0, slamming to ≈1 by IMPACT_MS (with a small spring), then resting.
 * `overshoot` scales the slam magnitude (driven by intensity).
 */
fun impactScale(elapsedMs: Double, overshoot: Double = 1.0): Double {
    val t = elapsedMs
    if (t <= 0.0) return 1 + 0.85 * overshoot
    if (t < IMPACT_MS) {
        val x = t / IMPACT_MS
        val eased = easeOutCubic(x)
        val big = 1 + 0.85 * overshoot
        val dip = -0.12 * overshoot * sin(x * PI) * (1 - x)
        return big + (1 - big) * eased + dip
    }
    return 1.0
}

/**
 * Comic impact OPACITY/presence over normalized life (0..1). A near-instant
 * appearance, a long proud hold, then a quick fade at the very end so the panel
 * clears. The fade occupies the last ~18%.
 */
fun impactPresence(life: Double): Double {
    val t = tempoClamp01(life)
    if (t < 0.04) return easeOutCubic(t / 0.04) // snap in
    if (t < 0.82) return 1.0
    val fade = tempoClamp01(1 - (t - 0.82) / 0.18)
    return fade.pow(1.4) // quick clean fade
}
