// Halo as a Dopamine effect on the Android backbone — mirror of the web
// `effect-halo/src/index.ts` + swift's `Halo.swift`.
//
// Per the generalization mandate, the ONLY per-effect code is {the GLSL ring
// shader + a tiny config naming its uniforms / bindings / shadow height / the
// per-frame breathe gate}. Everything else — the `.dope` mapping, the OKLCH
// golden-angle palette, the registry, the fullscreen-pass runner, the standard
// uniforms (incl. `uOrigin`, since the ring is anchored on the fire point), the
// shadow geometry — is shared backbone. The numeric/palette bag comes verbatim
// from the bundled `.dope` (the SAME bytes as the web), resolved by the shared
// loader (byte-parity proven by the 192-case grid).
//
// PURE-SHADER (not a hybrid): no Canvas panel, so it uses `createPassInstance` +
// `PassConfig` (not the panel runner). Anchored at `uOrigin` (usesOrigin = true).
//
// CONTINUOUS / LOOPING. Halo is Dopamine's first continuous effect. The other
// nine are one-shot reward moments gated by the held-breath `envelope` (a 0→peak
// →0 fade that would not loop). Halo instead drives all motion off PERIODIC
// functions of `uTimeS` in the shader and returns a STEADY periodic `amp` from
// `frame()` (haloBreathe), so it LOOPS SEAMLESSLY: the `.dope` sets `period =
// 1.5 s` and `durationMs = 6000` (= 4 periods), and 1.5 s is exactly 18
// "animate-on-twos" steps, so the frame at `t == durationMs` matches `t == 0` at
// every whimsy. A host loops it by re-firing or by a long duration.

package ai.dopamine.effect.halo

import ai.dopamine.core.DopeDoc
import ai.dopamine.core.DopeResolveInput
import ai.dopamine.core.DopeValue
import ai.dopamine.core.EffectRegistry
import ai.dopamine.core.number
import ai.dopamine.core.parseDope
import ai.dopamine.core.resolveDopeParams
import ai.dopamine.gl.DrawableEffect
import ai.dopamine.gl.EffectContext
import ai.dopamine.gl.EffectInstance
import ai.dopamine.gl.PassConfig
import ai.dopamine.gl.createPassInstance
import android.content.Context
import kotlin.math.min

class Halo(context: Context) : DrawableEffect {
    override val name: String = "halo"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("halo.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // Halo references no clamp consts (no loop-cap `#define`); `haloSeed` is the
        // scatter key — both byte-identical to the web call. (The seed only steers
        // the palette; the shader reads no seed uniform — web `bindings: { haloSeed:
        // null }`.)
        resolveDopeParams(
            doc,
            feeling,
            consts = emptyMap(),
            scatterKey = "haloSeed",
        )

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(CONFIG, params, ctx)

    // A continuous loader has no "peak"; the reduced-motion fallback holds one calm
    // frame briefly.
    override val reducedMotionPeakMs: Double = 0.0
    override val reducedMotionHoldMs: Double = 600.0

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Halo {
            val fx = Halo(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        private val CONFIG = PassConfig(
            vertex = HALO_VERTEX_SRC,
            fragment = HALO_FRAGMENT_SRC,
            uniforms = listOf(
                "uExposure", "uRingRadius", "uRingWidth", "uBreathe", "uSweepArc", "uSweepTurns",
                "uGlow", "uPeriod",
            ),
            usesOrigin = true,
            // haloSeed feeds the seeded palette only; the shader reads no seed
            // uniform (matches the web `bindings: { haloSeed: null }`).
            bindings = mapOf("haloSeed" to null),
            // A thin floating loop throws a small shadow; key its occluder "height"
            // to the ring's outer reach (radius + a little width).
            shadowHeightFrac = { p ->
                min(p.number("ringRadius") + p.number("ringWidth") * 2.0, 1.0)
            },
            // CONTINUOUS: a STEADY periodic breathe gate driven off elapsed seconds —
            // NOT `envelope(life)`. `animMs/1000` is the seconds clock the shader also
            // reads as `uTimeS`; haloBreathe is periodic with `period`, so the loop
            // seam is exact. `period` is a resolved `.dope` param (the const 1.5).
            frame = { info, params ->
                mapOf(
                    "amp" to haloBreathe(info.animMs / 1000.0, params.number("period", 1.5)).toFloat(),
                )
            },
        )
    }
}
