// Solarbloom as a Dopamine effect on the Android backbone — mirror of the web
// `effect-solarbloom/src/index.ts` + swift's `Solarbloom.swift`.
//
// Per the generalization mandate, the ONLY per-effect code is {the GLSL shader +
// the bespoke tempo + a tiny config naming its uniforms / bindings / shadow
// height / per-frame timing}. Everything else — the `.dope` mapping, the OKLCH
// golden-angle palette, the registry, the fullscreen-pass runner, the standard
// uniforms, the shadow geometry — is shared backbone. The numeric/palette bag
// comes verbatim from the bundled `.dope` (the SAME bytes as the web), resolved
// by the shared loader (byte-parity proven by the 192-case grid).
//
// PURE-SHADER (not a hybrid): no Canvas panel, so it uses `createPassInstance` +
// `PassConfig` (not the panel runner). The checkmark renders via the shader's
// ANALYTIC two-segment SDF branch: the GL backbone has no aux-texture support, so
// we keep uSdfOn / uCheckTexOn at 0 (the samplers uSdfTex / uCheckTex are then
// never sampled, so leaving them unbound is fine).

package ai.dopamine.effect.solarbloom

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
import kotlin.math.min

class Solarbloom(context: Context) : DrawableEffect {
    override val name: String = "solarbloom"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("solarbloom.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // `MAX_MOTES` is the only const (= the GLSL `#define MAX_MOTES 80`);
        // `moteSeed` is the scatter key — both byte-identical to the web call.
        resolveDopeParams(doc, feeling, consts = mapOf("MAX_MOTES" to 80.0), scatterKey = "moteSeed")

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(CONFIG, params, ctx)

    override val reducedMotionPeakMs: Double = 260.0
    override val reducedMotionHoldMs: Double = 360.0

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Solarbloom {
            val fx = Solarbloom(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        /** Half-size of the checkmark glyph box as a fraction of min viewport dim. */
        private const val CHECK_BOX_FRAC: Double = 0.16

        private val CONFIG = PassConfig(
            vertex = SOLARBLOOM_VERTEX_SRC,
            fragment = SOLARBLOOM_FRAGMENT_SRC,
            uniforms = listOf(
                "uCheck", "uExposure", "uBloomRadius", "uTurbulence", "uMoteSpeed",
                "uMoteCount", "uMoteSeed", "uIridescence", "uDispersion",
                "uCheckTex", "uCheckTexOn", "uCheckBox",
                "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx",
            ),
            usesOrigin = true,
            // overshoot feeds the envelope, not a uniform; moteSeed drives uMoteSeed.
            bindings = mapOf("overshoot" to null, "moteSeed" to "uMoteSeed"),
            shadowHeightFrac = { p -> p.number("bloomRadius", 0.7) },
            // The checkmark box + SDF stroke px (needed by the analytic checkmark
            // path here, and the SDF path on platforms that bind it). Sized to the
            // canvas exactly like the web `passUniforms` (Math.min(w, h)). With no
            // aux-texture support we also pin uCheckTexOn / uSdfOn off so the shader
            // takes its analytic two-segment SDF branch.
            passUniforms = { widthPx, heightPx, _, _ ->
                val box = CHECK_BOX_FRAC * min(widthPx, heightPx).toDouble()
                mapOf(
                    "uCheckBox" to box.toFloat(),
                    "uSdfStrokePx" to (box * 0.11).toFloat(),
                    "uCheckTexOn" to 0f,
                    "uSdfOn" to 0f,
                )
            },
            frame = { info, params ->
                mapOf(
                    "amp" to envelope(info.life, params.number("overshoot", 1.0)).toFloat(),
                    // The check draws on its OWN ~240ms clock using the REAL elapsed
                    // time (not the "animate on twos" stepped clock) so it stays smooth
                    // even at high whimsy — matching swift's `checkProgress(info.elapsedMs)`.
                    "uCheck" to checkProgress(info.elapsedMs).toFloat(),
                )
            },
        )
    }
}
