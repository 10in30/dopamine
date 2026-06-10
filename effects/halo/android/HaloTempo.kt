// Halo's timing — the port of the web `effect-halo/src/halo-tempo.ts` breathe
// gate (and the mirror of swift's `haloBreathe` in Halo.swift).
//
// Halo is Dopamine's first CONTINUOUS effect, so UNLIKE the nine one-shot reward
// effects it does NOT use the held-breath `envelope` (a 0→peak→0 fade that would
// not loop). Its `amp` is instead a STEADY, gently PERIODIC "breathe" gate driven
// off elapsed seconds: a slow sine of the loop period swinging ~0.7..1.0. Because
// it is periodic in `timeS` with the SAME period the `.dope` makes
// `tempo.durationMs` an integer multiple of, `haloBreathe(0) == haloBreathe(N·
// period)` — the loop seam is exact at every whimsy (the on-twos snap is itself
// periodic; see HaloShader.kt). This thin tempo file names that mapping for the
// config's `frame()` hook (mirroring the per-effect-tempo file convention).

package ai.dopamine.effect.halo

import kotlin.math.PI
import kotlin.math.sin

/**
 * Halo's steady breathe gate at elapsed seconds `timeS` for loop period
 * `periodS` (seconds). Returns ~0.7..1.0; `haloBreathe(0) == 0.85` and the
 * function is periodic with period `periodS`, so the loop is seamless. NOT a
 * life-based fade — there is no attack/decay, so re-firing (or a long duration)
 * loops with no visible seam.
 */
fun haloBreathe(timeS: Double, periodS: Double): Double {
    val ph = (2.0 * PI * timeS) / maxOf(periodS, 1e-3)
    return 0.85 + 0.15 * sin(ph)
}
