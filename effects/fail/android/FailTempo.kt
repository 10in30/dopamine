// Fail's bespoke timing — port of `fail-tempo.ts` (cross-checked against swift's
// `FailTempo.swift`).
//
// Where success swells and lingers, failure is a hard NEGATIVE jolt: the ✗ is
// STAMPED in almost instantly, the frame RECOILS with a fast damped SHAKE (a
// "no" head-shake / error buzz), then the whole thing DESATURATES and COLLAPSES
// out quickly. Short and punchy — no afterglow, no celebration. Built on the
// GENERIC `easeOutCubic` / `tempoClamp01` primitives from `dopamine-core` — this
// bespoke timing is the ONLY timing code that lives in the effect package
// (matching the web boundary).

package ai.dopamine.effect.fail

import ai.dopamine.core.easeOutCubic
import ai.dopamine.core.tempoClamp01
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.sin

/** Window (ms) over which the ✗ cross is stamped/slashed in. Hard + fast. */
const val FAIL_STAMP_MS: Double = 170.0

/** Total nominal length the shake + collapse occupy after the stamp. */
const val FAIL_SHAKE_MS: Double = 300.0

/**
 * Stamp progress (0..1) of the ✗ over elapsed ms. Eased so the cross lands hard
 * and immediately (most of the draw happens in the first third), reading as a
 * stamp/slash rather than a gentle write-on.
 */
fun stampProgress(elapsedMs: Double): Double {
    val x = tempoClamp01(elapsedMs / FAIL_STAMP_MS)
    // ease-out quint: very fast in, abrupt settle.
    return 1 - (1 - x).pow(5)
}

/**
 * Fail presence/amplitude over normalized life (0..1): a near-instant slam to
 * full, a brief hold, then a fast collapse. The fade is steeper + earlier than
 * the comic's so the moment reads as curt/negative, not a proud hold.
 */
fun failEnvelope(life: Double): Double {
    val t = tempoClamp01(life)
    if (t < 0.05) return easeOutCubic(t / 0.05) // hard slam in
    if (t < 0.55) return 1.0 // brief, curt hold
    val fade = tempoClamp01(1 - (t - 0.55) / 0.45)
    return fade.pow(1.7) // quick collapse
}

/**
 * Damped recoil SHAKE offset over elapsed ms — a horizontal "no" head-shake that
 * decays fast. Returns a signed multiplier (~-1..1) the renderer scales into px.
 * `amount` (driven by intensity) scales the initial swing. Settles to ~0 quickly
 * so the effect doesn't jitter through its whole life.
 */
fun shakeOffset(elapsedMs: Double, amount: Double = 1.0): Double {
    if (elapsedMs <= 0) return 0.0
    val decay = exp(-elapsedMs / (FAIL_SHAKE_MS * 0.35))
    // ~3.5 oscillations over the shake window.
    val osc = sin((elapsedMs / FAIL_SHAKE_MS) * PI * 7.0)
    return osc * decay * amount
}
