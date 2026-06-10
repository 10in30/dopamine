// Confetti's bespoke timing — the launch-then-fall amplitude envelope. Port of
// `confetti-tempo.ts` (cross-checked against swift's `ConfettiTempo.swift`).
//
// Unlike the success effects' held-breath `envelope` (which decays from its
// early peak), confetti stays BRIGHT through the long fall — per-piece
// `particleFade` in the shader handles each piece dimming as it lands. So this
// is a sharp POP attack (overshoot at launch), a near-full sustain while
// everything falls, then a gentle fade only at the very end as the last pieces
// settle. Built on the GENERIC `easeOutBack`/`easeOutCubic` primitives from
// dopamine-core — this bespoke envelope is the ONLY timing code that lives in the
// effect package (matching the web boundary).

package ai.dopamine.effect.confetti

import ai.dopamine.core.easeOutBack
import ai.dopamine.core.easeOutCubic

/** Confetti launch-then-fall amplitude over normalized life. Peak > 1 at launch. */
fun confettiAmp(life: Double, overshoot: Double): Double {
    if (life <= 0.0 || life >= 1.0) return 0.0
    val attack = 0.12
    if (life < attack) {
        // Sharp pop with a little overshoot (the burst leaving the action).
        return easeOutBack(life / attack, overshoot)
    }
    // Long luminous sustain, then a soft fade over the last ~30% as pieces settle.
    val tailStart = 0.7
    if (life < tailStart) return 1.0
    val x = (life - tailStart) / (1.0 - tailStart)
    return 1.0 - easeOutCubic(x) * 0.85
}
