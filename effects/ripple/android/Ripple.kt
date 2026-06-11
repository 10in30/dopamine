// Ripple as a Dopamine effect on the Android backbone — mirror of the web
// `effect-ripple/src/index.ts` + swift's `Ripple.swift`.
//
// FULLY DATA-DRIVEN (P2): everything that isn't the GLSL lives in
// ripple.dope.json — the mood→params mapping + palette (the loader), AND the
// per-frame logic: `tempo.frame` (the held-breath envelope amp),
// `render.shadowHeightFrac`, `render.consts` (MAX_RINGS / MIN_RINGS),
// `render.config`, `tempo.reducedMotion` and the uniform `binding` contract.
// `dopePassPlan` + `dopePassConfig` interpret that data through the generic
// pass runner; this module is just the registration shim (the shader Kotlin is
// toolchain-generated from the web GLSL).
//
// Anchored at `uOrigin` (`render.config.usesOrigin = true`): concentric
// wavefronts expand from the action point. The `.dope` bytes are the SAME as
// the web's (byte-parity proven by the 192-case grid).

package ai.dopamine.effect.ripple

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

class Ripple(context: Context) : DrawableEffect {
    override val name: String = "ripple"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("ripple.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    // The whole factory (resolve consts/scatter, uniforms/bindings, per-frame
    // amp, shadow height, reduced motion) is data: ripple.dope.json interpreted
    // by the core backbone.
    private val plan: DopePassPlan = dopePassPlan(doc)
    private val scatterKey: String =
        plan.scatterKey ?: throw DopeException("dope: ${doc.id} has no binding.scatterKey")
    private val config: PassConfig = dopePassConfig(doc, RIPPLE_VERTEX_SRC, RIPPLE_FRAGMENT_SRC, plan)

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        resolveDopeParams(doc, feeling, consts = plan.consts, scatterKey = scatterKey)

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(config, params, ctx)

    override val reducedMotionPeakMs: Double? = plan.reducedMotionPeakMs
    override val reducedMotionHoldMs: Double? = plan.reducedMotionHoldMs

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Ripple {
            val fx = Ripple(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }
    }
}
