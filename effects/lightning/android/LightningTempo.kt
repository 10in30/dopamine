// Lightning's bespoke timing — port of `lightning-tempo.ts`.
//
// The bolt cracks in almost instantly with a hard FLASH on contact, then a brief
// FLICKER AFTERGLOW strobes and decays. Pure functions of time.

package ai.dopamine.effect.lightning

import ai.dopamine.core.tempoClamp01
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.pow
import kotlin.math.sin

// NOTE: STRIKE_MS + strikeProgress now live in the GENERATED LightningRenderer.kt
// (same package) — the bolt precompute keys off the strike clock, so they ride
// the single transpiled web source (lightning-logic.ts). Only the flash/strobe
// shape below remains hand-written here.

/** FLASH / STROBE amplitude (0..1+) over normalized life — the signature electric hit. */
fun flashStrobe(life: Double, flicker: Double = 1.0): Double {
    val t = tempoClamp01(life)
    val primary = exp(-t / 0.035)
    val beats = 6.0
    val phase = t * beats * Math.PI * 2.0
    val spike = max(0.0, sin(phase))
    val sharp = spike.pow(8.0)
    val tail = (1.0 - t).pow(2.2) * 0.28 * flicker
    return primary + sharp * tail
}
