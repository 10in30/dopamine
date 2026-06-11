// Halo as a Dopamine effect on the Android backbone — mirror of the web
// `effect-halo/src/index.ts` + swift's `Halo.swift`.
//
// FULLY DATA-DRIVEN (P2): everything that isn't the GLSL lives in
// halo.dope.json — the mood→params mapping + palette (the loader), AND the
// per-frame logic: `tempo.frame` (the steady PERIODIC breathe amp — see below),
// `render.shadowHeightFrac`, `render.config`, `tempo.reducedMotion` and the
// uniform `binding` contract (`haloSeed` feeds the seeded palette only — no
// `scatterWeb`, the shader reads no seed uniform). `dopePassPlan` +
// `dopePassConfig` interpret that data through the generic pass runner; this
// module is just the registration shim (the shader Kotlin is toolchain-
// generated from the web GLSL).
//
// CONTINUOUS / LOOPING. Halo is Dopamine's first continuous effect. The other
// nine are one-shot reward moments gated by the held-breath `envelope` (a 0→peak
// →0 fade that would not loop). Halo's datafied `tempo.frame.amp` is instead a
// periodic sine of `animMs` (the breathe gate, period = the `.dope` `period`
// param, 1.5 s), so it LOOPS SEAMLESSLY: `durationMs = 6000` (= 4 periods), and
// 1.5 s is exactly 18 "animate-on-twos" steps, so the frame at `t == durationMs`
// matches `t == 0` at every whimsy.

package ai.dopamine.effect.halo

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

class Halo(context: Context) : DrawableEffect {
    override val name: String = "halo"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("halo.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    // The whole factory (resolve consts/scatter, uniforms/bindings, the periodic
    // breathe amp, shadow height, reduced motion) is data: halo.dope.json
    // interpreted by the core backbone.
    private val plan: DopePassPlan = dopePassPlan(doc)
    private val scatterKey: String =
        plan.scatterKey ?: throw DopeException("dope: ${doc.id} has no binding.scatterKey")
    private val config: PassConfig = dopePassConfig(doc, HALO_VERTEX_SRC, HALO_FRAGMENT_SRC, plan)

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        resolveDopeParams(doc, feeling, consts = plan.consts, scatterKey = scatterKey)

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(config, params, ctx)

    // A continuous loader has no "peak"; the reduced-motion fallback holds one
    // calm frame briefly (peakMs 0 / holdMs 600, from tempo.reducedMotion).
    override val reducedMotionPeakMs: Double? = plan.reducedMotionPeakMs
    override val reducedMotionHoldMs: Double? = plan.reducedMotionHoldMs

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Halo {
            val fx = Halo(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }
    }
}
