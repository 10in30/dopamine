// Fail / error as a Dopamine effect on the Android backbone — mirror of the web
// `effect-fail/src/index.ts` + swift's `Fail.swift`.
//
// Per the generalization mandate, the ONLY per-effect code is {the GLSL shader +
// the bespoke tempo + a tiny config naming its uniforms / bindings / frame
// timing}. Everything else — the `.dope` mapping, the error-band OKLCH palette,
// the registry, the pass runner, the standard uniforms — is shared backbone. The
// numeric/palette bag comes verbatim from the bundled `.dope` (the SAME bytes as
// the web), resolved by the shared loader (byte-parity proven).
//
// PURE-SHADER (no Canvas panel): the ✗ is the shader's analytic two-bar cross.
// The shader declares the baked-✗ SDF sampler for portability, but the Android GL
// backbone has no aux-texture support, so uSdfOn stays 0 and the analytic ✗
// renders — the .dope `svgPath` icon path is the web/Metal-only refinement.

package ai.dopamine.effect.fail

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

class Fail(context: Context) : DrawableEffect {
    override val name: String = "fail"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("fail.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // Fail declares NO consts (web `consts: {}`); `failSeed` is the scatter key.
        resolveDopeParams(doc, feeling, consts = emptyMap(), scatterKey = "failSeed")

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(CONFIG, params, ctx)

    // Matches the web factory's reducedMotion { peakMs: 200, holdMs: 320 }.
    override val reducedMotionPeakMs: Double = 200.0
    override val reducedMotionHoldMs: Double = 320.0

    companion object {
        /** Half-size of the ✗ box as a fraction of min viewport dim. */
        private const val CROSS_BOX_FRAC: Double = 0.15

        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Fail {
            val fx = Fail(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        private val CONFIG = PassConfig(
            vertex = FAIL_VERTEX_SRC,
            fragment = FAIL_FRAGMENT_SRC,
            uniforms = listOf(
                "uStamp", "uShake", "uExposure", "uSeverity",
                "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx", "uBoxPx",
            ),
            usesOrigin = true,
            // shakeAmount feeds the shake math (frame), not a uniform; failSeed +
            // seed are unused. exposure/severity auto-bind to uExposure/uSeverity;
            // style is bound to uStyle by the runner. (Mirrors the web `bindings`.)
            bindings = mapOf("shakeAmount" to null, "failSeed" to null, "seed" to null),
            // Constant in the web (`shadowHeightFrac: 0.42`): the error casts a
            // tight, compact shadow — not a wide celebratory bloom. (Kept for
            // portability; the single-surface overlay renders light only.)
            shadowHeightFrac = { 0.42 },
            // The ✗ box + stroke px are needed even in the analytic (SDF-less)
            // fallback. We also pin uSdfOn off (no aux-texture support) so the
            // shader takes its analytic two-bar ✗ branch with no texture binding.
            // Sized to the canvas exactly like the web `passUniforms` (min(w, h)).
            passUniforms = { widthPx, heightPx, _, _ ->
                val px = CROSS_BOX_FRAC * min(widthPx, heightPx).toDouble()
                mapOf(
                    "uBoxPx" to px.toFloat(),
                    "uSdfStrokePx" to (px * 0.13).toFloat(),
                    "uSdfOn" to 0f,
                )
            },
            // Per-frame: the hard-jolt envelope (→ uAmp), the ✗ stamp progress, and
            // the signed recoil shake (pre-scaled by intensity-driven shakeAmount).
            // The stamp + shake run on the REAL elapsed time (not the "animate on
            // twos" stepped clock) so the slam/recoil read as punchy even at high
            // whimsy — matching swift's `stampProgress(info.elapsedMs)` /
            // `shakeOffset(info.elapsedMs, …)`.
            frame = { info, params ->
                mapOf(
                    "amp" to failEnvelope(info.life).toFloat(),
                    "uStamp" to stampProgress(info.elapsedMs).toFloat(),
                    "uShake" to shakeOffset(info.elapsedMs, params.number("shakeAmount", 1.0)).toFloat(),
                )
            },
        )
    }
}
