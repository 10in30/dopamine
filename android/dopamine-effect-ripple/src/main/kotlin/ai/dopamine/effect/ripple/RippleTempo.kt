// Ripple's timing — the port of the web `effect-ripple/src/index.ts` frame()
// envelope. UNLIKE Solarbloom (whose checkmark has a bespoke fixed-window draw),
// Ripple has NO bespoke tempo: its global brightness is the GENERIC held-breath
// `envelope` from dopamine-core (a quick overshooting swell then a gentle settle),
// exactly as the web `frame()` and swift's `Ripple.frame()` do — there is no
// separate `ripple-tempo.ts` / `RippleTempo.swift` on the other stacks. This thin
// wrapper names that mapping for the config's `frame()` hook (mirroring the
// per-effect-tempo file convention) and stays on the core primitive.

package ai.dopamine.effect.ripple

import ai.dopamine.core.envelope

/**
 * Ripple's global brightness envelope over normalized life `t` ∈ [0, 1]: the
 * generic held-breath `envelope`, with `overshoot` (an intensity-driven `.dope`
 * param) tuning the attack overshoot. `rippleEnvelope(0) == 0`,
 * `rippleEnvelope(1) == 0`. Gates `uAmp` (and, on platforms that draw it, the
 * trough shadow geometry).
 */
fun rippleEnvelope(life: Double, overshoot: Double): Double = envelope(life, overshoot)
