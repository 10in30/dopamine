// Confetti as a Dopamine effect on the Android backbone — mirror of the web
// `effect-confetti/src/index.ts` + swift's `Confetti.swift`.
//
// The quintessential celebration: a burst of paper confetti POPS upward from the
// action then TUMBLES DOWN under gravity with air-drag flutter — spinning
// rectangles + petals in many OKLCH hues. Per the generalization mandate, the
// ONLY per-effect code is {the GLSL shader + the bespoke tempo + a tiny config
// naming its scalar params / bindings / shadow height / the per-frame
// launch-then-fall amplitude}. Everything else — the `.dope` mapping, the OKLCH
// palette, the registry, the fullscreen-pass runner, the standard uniforms — is
// shared backbone. The numeric/palette bag comes verbatim from the bundled
// `.dope` (the SAME bytes as the web), resolved by the shared loader (byte-parity
// proven). Confetti is PURE-SHADER (no panel): `createPassInstance` + `PassConfig`.

package ai.dopamine.effect.confetti

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

/**
 * The single source of truth for the piece cap: BOTH the GLSL `#define MAX_PIECES`
 * and the integer-clamp const the `.dope` references (`clampMax: "MAX_PIECES"`).
 */
const val MAX_PIECES: Double = 120.0

class Confetti(context: Context) : DrawableEffect {
    override val name: String = "confetti"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("confetti.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // `MAX_PIECES` is the only const; `pieceSeed` is the scatter key — both
        // byte-identical to the web `resolveDopeParams(...)` call.
        resolveDopeParams(doc, feeling, consts = mapOf("MAX_PIECES" to MAX_PIECES), scatterKey = "pieceSeed")

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(CONFIG, params, ctx)

    override val reducedMotionPeakMs: Double = 320.0
    override val reducedMotionHoldMs: Double = 420.0

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Confetti {
            val fx = Confetti(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        // The launched + falling cloud spans a good chunk of the viewport; give the
        // shadow a moderate occluder "height". Matches the web SHADOW_HEIGHT_FRAC.
        private const val SHADOW_HEIGHT_FRAC: Double = 0.5

        private val CONFIG = PassConfig(
            vertex = CONFETTI_VERTEX_SRC,
            fragment = CONFETTI_FRAGMENT_SRC,
            uniforms = listOf(
                "uExposure", "uPieceCount", "uSpread", "uLaunchSpeed", "uGravity",
                "uFlutter", "uPieceSize", "uSpin", "uPieceSeed",
            ),
            usesOrigin = true,
            // overshoot feeds the envelope, not a uniform; pieceSeed is the scatter offset.
            bindings = mapOf("overshoot" to null, "pieceSeed" to "uPieceSeed"),
            shadowHeightFrac = { SHADOW_HEIGHT_FRAC },
            frame = { info, params ->
                // The launch-then-fall amplitude `confettiAmp` is Confetti's bespoke
                // timing — a sharp POP attack (overshoot at launch), a long luminous
                // sustain through the fall, then a soft fade as the last pieces settle.
                mapOf("amp" to confettiAmp(info.life, params.number("overshoot", 1.0)).toFloat())
            },
        )
    }
}
