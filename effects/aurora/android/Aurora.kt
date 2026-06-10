// Aurora as a Dopamine effect on the Android backbone — mirror of the web
// `effect-aurora/src/index.ts` + swift's `Aurora.swift`.
//
// Per the generalization mandate, the ONLY per-effect code is {the GLSL shader +
// the bespoke timing (the accumulated sideways SWEEP) + a tiny config naming its
// uniforms / bindings / shadow height / per-frame envelope}. Everything else —
// the `.dope` mapping, the OKLCH palette, the registry, the pass runner, the
// standard uniforms, the shadow geometry — is shared backbone. The numeric/palette
// bag comes verbatim from the bundled `.dope` (the SAME bytes as the web),
// resolved by the shared loader (byte-parity proven).
//
// Aurora is DIRECTIONAL/curtain: it composes across the whole upper surface and
// IGNORES the anchor (no origin) — unlike the radial Solarbloom. It is a
// PURE-SHADER effect (no Canvas panel), so it uses createPassInstance + PassConfig.

package ai.dopamine.effect.aurora

import ai.dopamine.core.DopeDoc
import ai.dopamine.core.DopeResolveInput
import ai.dopamine.core.DopeValue
import ai.dopamine.core.EffectRegistry
import ai.dopamine.core.envelope
import ai.dopamine.core.number
import ai.dopamine.core.parseDope
import ai.dopamine.core.resolveDopeParams
import ai.dopamine.gl.DrawableEffect
import ai.dopamine.gl.EffectContext
import ai.dopamine.gl.EffectInstance
import ai.dopamine.gl.PassConfig
import ai.dopamine.gl.createPassInstance
import android.content.Context

/**
 * The single source of truth for the curtain count: BOTH the GLSL
 * `#define CURTAINS` (a literal `7` in AuroraShader.kt) and the integer-clamp
 * const the `.dope` mapping references (passed to the loader as `MAX_CURTAINS`).
 * Byte-identical to the web `MAX_CURTAINS` and swift's `MAX_CURTAINS`.
 */
const val MAX_CURTAINS: Double = 7.0

class Aurora(context: Context) : DrawableEffect {
    override val name: String = "aurora"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("aurora.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // `MAX_CURTAINS` is the only const; `auroraSeed` is the scatter key —
        // both byte-identical to the web + swift resolve calls.
        resolveDopeParams(doc, feeling, consts = mapOf("MAX_CURTAINS" to MAX_CURTAINS), scatterKey = "auroraSeed")

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(CONFIG, params, ctx)

    // A long, gentle ambient effect: hold the calm frame a touch longer.
    override val reducedMotionPeakMs: Double = 520.0
    override val reducedMotionHoldMs: Double = 520.0

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Aurora {
            val fx = Aurora(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        private val CONFIG = PassConfig(
            vertex = AURORA_VERTEX_SRC,
            fragment = AURORA_FRAGMENT_SRC,
            uniforms = listOf(
                "uExposure", "uCoverage", "uBandY", "uBandHeight", "uSway",
                "uSweep", "uStriation", "uRays", "uSeed",
            ),
            // Aurora is directional/curtain: it composes across the whole upper
            // surface and ignores the anchor, so it does NOT read uOrigin (the web
            // CONFIG sets no usesOrigin → false).
            usesOrigin = false,
            // auroraSeed binds to uSeed (not uAuroraSeed); overshoot feeds the
            // envelope and is NOT its own uniform (matches the web `bindings`).
            bindings = mapOf("auroraSeed" to "uSeed", "overshoot" to null),
            // A real aurora barely occludes; the shader scales the cast shadow down
            // hard, so a modest height keeps the faint floating read without a heavy
            // silhouette. (Kept for portability; the single-surface host is light-only.)
            shadowHeightFrac = { p -> p.number("bandHeight", 0.6) * 0.6 },
            frame = { info, params ->
                val overshoot = params.number("overshoot", 1.0)
                mapOf(
                    "amp" to envelope(info.life, overshoot).toFloat(),
                    // Accumulated sideways sweep (fraction of width). Slow ambient
                    // travel; the sweep eases so the curtains drift in then settle
                    // rather than scroll forever.
                    "uSweep" to auroraSweep(info.animMs, info.life).toFloat(),
                )
            },
        )
    }
}
