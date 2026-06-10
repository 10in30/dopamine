// Ripple as a Dopamine effect on the Android backbone — mirror of the web
// `effect-ripple/src/index.ts` + swift's `Ripple.swift`.
//
// Per the generalization mandate, the ONLY per-effect code is {the GLSL water
// shader + a tiny config naming its uniforms / bindings / shadow height / the
// per-frame held-breath envelope timing}. Everything else — the `.dope` mapping,
// the OKLCH golden-angle palette, the registry, the fullscreen-pass runner, the
// standard uniforms (incl. `uOrigin`, since the waves emanate from the fire
// point), the shadow geometry — is shared backbone. The numeric/palette bag comes
// verbatim from the bundled `.dope` (the SAME bytes as the web), resolved by the
// shared loader (byte-parity proven by the 192-case grid).
//
// PURE-SHADER (not a hybrid): no Canvas panel, so it uses `createPassInstance` +
// `PassConfig` (not the panel runner). Anchored at `uOrigin` (usesOrigin = true):
// concentric wavefronts expand from the action point. Distinct from Solarbloom's
// soft radial CORE — Ripple's light lives only on thin, moving ring crests + the
// caustics they refract.

package ai.dopamine.effect.ripple

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

class Ripple(context: Context) : DrawableEffect {
    override val name: String = "ripple"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("ripple.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // The loop-cap consts the loader's clampMax/clampMin nodes reference:
        // `MAX_RINGS` (= the GLSL `#define MAX_RINGS 7`) and `MIN_RINGS`. `rippleSeed`
        // is the scatter key — all three byte-identical to the web call.
        resolveDopeParams(
            doc,
            feeling,
            consts = mapOf("MAX_RINGS" to 7.0, "MIN_RINGS" to 2.0),
            scatterKey = "rippleSeed",
        )

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(CONFIG, params, ctx)

    override val reducedMotionPeakMs: Double = 280.0
    override val reducedMotionHoldMs: Double = 380.0

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Ripple {
            val fx = Ripple(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        private val CONFIG = PassConfig(
            vertex = RIPPLE_VERTEX_SRC,
            fragment = RIPPLE_FRAGMENT_SRC,
            uniforms = listOf(
                "uExposure", "uAmplitude", "uRings", "uWavelength", "uSpeed", "uCaustic", "uSeed",
            ),
            usesOrigin = true,
            // rippleSeed binds to uSeed (the per-fire hash); overshoot feeds the
            // envelope, not a uniform (matches the web `bindings`).
            bindings = mapOf("rippleSeed" to "uSeed", "overshoot" to null),
            // The wave field's outward reach (≈ rings * wavelength) sets the occluder
            // "height" the troughs cast their faint shadow over.
            shadowHeightFrac = { p ->
                min(p.number("wavelength") * p.number("rings") * 0.6 + p.number("amplitude") * 0.3, 1.0)
            },
            frame = { info, params ->
                mapOf(
                    "amp" to rippleEnvelope(info.life, params.number("overshoot", 1.0)).toFloat(),
                )
            },
        )
    }
}
