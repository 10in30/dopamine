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

/** Window (ms) over which the bolt cracks in to the strike point. Hard + fast. */
const val STRIKE_MS: Double = 130.0

/** Bolt strike progress (0..1) over elapsed ms — ease-out quint (near-instant crack-in). */
fun strikeProgress(elapsedMs: Double): Double {
    val x = tempoClamp01(elapsedMs / STRIKE_MS)
    return 1.0 - (1.0 - x).pow(5.0)
}

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
