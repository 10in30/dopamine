// Inkstroke (Calligraphic Verdict) as a Dopamine effect on the Android backbone —
// mirror of the web `effect-inkstroke/src/index.ts` + swift's `Inkstroke.swift`.
//
// FULLY DATA-DRIVEN (P2): everything that isn't the GLSL lives in
// inkstroke.dope.json — the mood→params mapping + palette (the loader), AND the
// per-frame logic: `tempo.frame` (the envelope amp + the 360 ms ease-out-cubic
// pen-draw progress, fed the on-twos-snapped `animMs` so the stroke shares the
// cel jitter clock), `render.shadowHeightFrac`, `render.consts` (MAX_DROPS),
// `render.config`, `tempo.reducedMotion` and the uniform `binding` contract.
// `dopePassPlan` + `dopePassConfig` interpret that data through the generic
// pass runner; this module is just the registration shim (the shader Kotlin is
// toolchain-generated from the web GLSL).
//
// The gesture centres on the targeted element (`uOrigin` + `uTarget`) and falls
// back to the canvas when untargeted. The `.dope` bytes are the SAME as the
// web's (byte-parity proven by the 192-case grid).

package ai.dopamine.effect.inkstroke

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

class Inkstroke(context: Context) : DrawableEffect {
    override val name: String = "inkstroke"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("inkstroke.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    // The whole factory (resolve consts/scatter, uniforms/bindings, per-frame
    // amp + draw, shadow height, reduced motion) is data: inkstroke.dope.json
    // interpreted by the core backbone.
    private val plan: DopePassPlan = dopePassPlan(doc)
    private val scatterKey: String =
        plan.scatterKey ?: throw DopeException("dope: ${doc.id} has no binding.scatterKey")
    private val config: PassConfig = dopePassConfig(doc, INKSTROKE_VERTEX_SRC, INKSTROKE_FRAGMENT_SRC, plan)

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        resolveDopeParams(doc, feeling, consts = plan.consts, scatterKey = scatterKey)

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(config, params, ctx)

    override val reducedMotionPeakMs: Double? = plan.reducedMotionPeakMs
    override val reducedMotionHoldMs: Double? = plan.reducedMotionHoldMs

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Inkstroke {
            val fx = Inkstroke(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }
    }
}
