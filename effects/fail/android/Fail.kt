// Fail / error as a Dopamine effect on the Android backbone — mirror of the web
// `effect-fail/src/index.ts` + swift's `Fail.swift`.
//
// FULLY DATA-DRIVEN (P2) where data can reach: the params/palette/tempo come
// from fail.dope.json via the loader, AND the per-frame logic that was
// FailTempo.kt — the slam/hold/collapse `amp`, the 170 ms ✗ stamp and the damped
// recoil shake — is `tempo.frame` (stamp/shake run on the REAL un-stepped
// `elapsedMs`, as this port always did; the web aligned to it in P2), with
// `render.shadowHeightFrac` (the bare 0.42), `render.config`,
// `tempo.reducedMotion` and the uniform `binding` contract alongside (`failSeed`
// has no `scatterWeb` and the raw `seed` is excluded — the shader reads no seed
// uniform). What stays CODE (the honest boundary, passed as a hook): the
// canvas-size-dependent ✗ box/stroke pass uniforms the analytic fallback needs.
//
// PURE-SHADER (no Canvas panel): the ✗ is the shader's analytic two-bar cross.
// The shader declares the baked-✗ SDF sampler for portability, but the Android GL
// backbone has no aux-texture support, so uSdfOn stays 0 and the analytic ✗
// renders — the .dope `svgPath` icon path is the web/Metal-only refinement.

package ai.dopamine.effect.fail

import ai.dopamine.core.DopeDoc
import ai.dopamine.core.DopeException
import ai.dopamine.core.DopePassPlan
import ai.dopamine.core.DopeResolveInput
import ai.dopamine.core.DopeValue
import ai.dopamine.core.EffectRegistry
import ai.dopamine.core.dopePassPlan
import ai.dopamine.core.parseDope
import ai.dopamine.core.resolveDopeParams
import ai.dopamine.gl.DrawableEffect
import ai.dopamine.gl.EffectContext
import ai.dopamine.gl.EffectInstance
import ai.dopamine.gl.PassConfig
import ai.dopamine.gl.createPassInstance
import ai.dopamine.gl.dopePassConfig
import android.content.Context
import kotlin.math.min

class Fail(context: Context) : DrawableEffect {
    override val name: String = "fail"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("fail.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    // The factory (resolve consts/scatter, uniforms/bindings, per-frame
    // amp/stamp/shake, shadow height, reduced motion) is data: fail.dope.json
    // interpreted by the core backbone. The hook below carries the genuinely
    // code-shaped ✗ plumbing (canvas-size-dependent).
    private val plan: DopePassPlan = dopePassPlan(doc)
    private val scatterKey: String =
        plan.scatterKey ?: throw DopeException("dope: ${doc.id} has no binding.scatterKey")
    private val config: PassConfig = dopePassConfig(
        doc, FAIL_VERTEX_SRC, FAIL_FRAGMENT_SRC, plan,
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
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        resolveDopeParams(doc, feeling, consts = plan.consts, scatterKey = scatterKey)

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(config, params, ctx)

    override val reducedMotionPeakMs: Double? = plan.reducedMotionPeakMs
    override val reducedMotionHoldMs: Double? = plan.reducedMotionHoldMs

    companion object {
        /** Half-size of the ✗ box as a fraction of min viewport dim. */
        private const val CROSS_BOX_FRAC: Double = 0.15

        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Fail {
            val fx = Fail(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }
    }
}
