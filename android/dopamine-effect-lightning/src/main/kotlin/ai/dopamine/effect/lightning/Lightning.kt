// Lightning as a Dopamine effect on the Android backbone — mirror of the reworked
// web `effect-lightning/src/index.ts`.
//
// A PURE-SHADER pass whose bolt polyline is CPU-precomputed (LightningRenderer.kt)
// and fed to the shader as the uVerts/uBoltMeta uniform ARRAYS via the backbone's
// `frameArrays` seam. Numeric/palette bag from the byte-identical `.dope`. All
// three platforms precompute the polyline this way now (the swift/Metal port feeds
// it via DopamineCore's `frameArrays` buffer seam); the `.dope` is unchanged.

package ai.dopamine.effect.lightning

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
import ai.dopamine.gl.UniformArray
import ai.dopamine.gl.createPassInstance
import android.content.Context

class Lightning(context: Context) : DrawableEffect {
    override val name: String = "lightning"

    val doc: DopeDoc = parseDope(
        context.assets.open("lightning.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        resolveDopeParams(doc, feeling, consts = mapOf("MAX_FORKS" to MAX_FORKS.toDouble()), scatterKey = "boltSeed")

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(CONFIG, params, ctx)

    override val reducedMotionPeakMs: Double = 130.0
    override val reducedMotionHoldMs: Double = 300.0

    companion object {
        fun register(context: Context): Lightning {
            val fx = Lightning(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        private val CONFIG = PassConfig(
            vertex = LIGHTNING_VERTEX_SRC,
            fragment = LIGHTNING_FRAGMENT_SRC,
            uniforms = listOf(
                "uStrike", "uFlash", "uThickness", "uFlashBright", "uExposure", "uSeed",
                "uVerts", "uBoltMeta",
            ),
            usesOrigin = true,
            // boltSeed binds to uSeed (halo variation); the geometry params (jagged,
            // branches) drive the CPU precompute, not uniforms; flicker/overshoot feed timing.
            bindings = mapOf(
                "boltSeed" to "uSeed",
                "flicker" to null,
                "overshoot" to null,
                "jagged" to null,
                "branches" to null,
            ),
            shadowHeightFrac = { p -> p.number("thickness", 0.05) * 14.0 + 0.4 },
            frame = { info, params ->
                mapOf(
                    "amp" to envelope(info.life, params.number("overshoot", 1.0)).toFloat(),
                    "uStrike" to strikeProgress(info.animMs).toFloat(),
                    "uFlash" to flashStrobe(info.life, params.number("flicker", 1.0)).toFloat(),
                )
            },
            frameArrays = { info, params, geom ->
                val arr = computeLightningArrays(
                    style = params.number("style"),
                    thickness = params.number("thickness"),
                    jagged = params.number("jagged"),
                    branches = params.number("branches"),
                    boltSeed = params.number("boltSeed"),
                    width = geom.widthPx,
                    height = geom.heightPx,
                    originX = geom.originX.toDouble(),
                    originY = geom.originY.toDouble(),
                    elapsedMs = info.animMs,
                    life = info.life,
                )
                listOf(
                    UniformArray("uVerts", 2, arr.verts),
                    UniformArray("uBoltMeta", 4, arr.meta),
                )
            },
        )
    }
}
