// Heartburst bespoke timing — port of `heartburst-tempo.ts` (+ the `heartFlash` /
// `heartPresence` helpers from the web `index.ts`).
//
// The shape of time is a "lub-dub" double-pulse: the heart swells on a first
// (loud) beat, relaxes, swells again on a second (softer) beat, then on the
// release it BURSTS into a flurry of little hearts that fly outward and fade.
// All pure functions of normalized life, built on the generic `easeOutCubic` /
// `clamp01` primitives — the ONLY timing code that lives in this effect package.

package ai.dopamine.effect.heartburst

import ai.dopamine.core.easeOutCubic
import ai.dopamine.core.tempoClamp01
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.max
import kotlin.math.pow

/** Fraction of life occupied by the lub-dub beat phase before the burst. */
const val HEARTBEAT_PHASE: Double = 0.3

/** A single soft beat pulse centred at `center` with half-width `width`. */
private fun beatPulse(t: Double, center: Double, width: Double): Double {
    val x = (t - center) / width
    if (x <= -1 || x >= 1) return 0.0
    val lobe = 0.5 + 0.5 * cos(x * PI)
    return if (x < 0) lobe.pow(0.7) else lobe.pow(1.4)
}

/** Heart SCALE multiplier over normalized life (resting 1.0 with two beats). */
fun heartbeatScale(life: Double, strength: Double = 1.0, doubleBeat: Double = 1.0): Double {
    val t = tempoClamp01(life)
    val lub = beatPulse(t, 0.1, 0.1)
    val dub = beatPulse(t, 0.21, 0.075) * 0.62 * tempoClamp01(doubleBeat)
    val beat = max(lub, dub)
    val sag = if (t > HEARTBEAT_PHASE) 0.06 * easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE)) else 0.0
    return 1 + beat * 0.42 * strength - sag
}

/** The amplitude/energy envelope (→ uAmp + shadow strength). */
fun heartburstEnvelope(life: Double, strength: Double = 1.0, doubleBeat: Double = 1.0): Double {
    val t = tempoClamp01(life)
    if (t <= 0.0 || t >= 1.0) return 0.0
    val lub = beatPulse(t, 0.1, 0.1)
    val dub = beatPulse(t, 0.21, 0.075) * 0.62 * tempoClamp01(doubleBeat)
    val beats = max(lub, dub) * 0.9 * strength
    val b = burstProgress(life)
    val flare = b * (1 - b).pow(1.1) * 2.4
    return tempoClamp01(max(beats, flare * (0.7 + 0.3 * strength)))
}

/** Burst progress 0..1 over the post-beat phase. */
fun burstProgress(life: Double): Double {
    val t = tempoClamp01(life)
    if (t <= HEARTBEAT_PHASE) return 0.0
    return easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE))
}

/**
 * Overall panel presence over normalized life: a quick snap-in, a proud hold
 * through the beats + burst, then a clean fade at the tail.
 */
fun heartPresence(life: Double): Double {
    val t = if (life < 0) 0.0 else if (life > 1) 1.0 else life
    if (t < 0.04) return t / 0.04
    if (t < 0.8) return 1.0
    val fade = 1 - (t - 0.8) / 0.2
    return max(0.0, fade).pow(1.4)
}

/** The warm beat/burst FLASH amount over normalized life (port of web `heartFlash`). */
fun heartFlash(life: Double, beatStrength: Double, doubleBeat: Double): Double {
    val beat = max(0.0, heartbeatScale(life, beatStrength, doubleBeat) - 1) // 0 at rest
    val b = burstProgress(life)
    val burstSpike = if (b > 0) exp(-((b - 0.06) / 0.12).pow(2)) else 0.0
    return minOf(1.2, beat * 1.6 + burstSpike * 0.8)
}
