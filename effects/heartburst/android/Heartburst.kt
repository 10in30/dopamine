// Heartburst as a Dopamine effect on the Android backbone — mirror of the web
// `effect-heartburst/src/index.ts` + swift's `Heartburst.swift`.
//
// Per the generalization mandate, the ONLY per-effect code is {the GLSL shader +
// the bespoke tempo + the Canvas panel draw + a tiny config naming its uniforms /
// bindings / frame timing}. Everything else — the `.dope` mapping, the warm OKLCH
// palette, the registry, the panel runner, the standard uniforms — is shared
// backbone. The numeric/palette bag comes verbatim from the bundled `.dope` (the
// SAME bytes as the web), resolved by the shared loader (byte-parity proven).

package ai.dopamine.effect.heartburst

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
import ai.dopamine.gl.PanelConfig
import ai.dopamine.gl.createPanelInstance
import android.content.Context
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt

class Heartburst(context: Context) : DrawableEffect {
    override val name: String = "heartburst"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("heartburst.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // Heartburst declares NO consts; `heartburstSeed` is the scatter key.
        resolveDopeParams(doc, feeling, consts = emptyMap(), scatterKey = "heartburstSeed")

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPanelInstance(CONFIG, params, ctx)

    override val reducedMotionPeakMs: Double = (HEARTBEAT_PHASE * 600).roundToInt().toDouble()
    override val reducedMotionHoldMs: Double = 360.0

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Heartburst {
            val fx = Heartburst(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        private val CONFIG = PanelConfig(
            vertex = HEARTBURST_VERTEX_SRC,
            fragment = HEARTBURST_FRAGMENT_SRC,
            panelSampler = "uPanel",
            uniforms = listOf(
                "uPresence", "uBeat", "uBurst", "uFlash", "uExposure",
                "uGlow", "uGloss", "uHalftone", "uDotSize", "uSaturation", "uSeed",
            ),
            // heartburstSeed drives uSeed; the draw-only geometry + dpr-scaled dotSize
            // are not auto-bound uniforms (matches the web `bindings`).
            bindings = mapOf(
                "heartburstSeed" to "uSeed",
                "seed" to null,
                "heartScale" to null,
                "burstCount" to null,
                "burstSpread" to null,
                "inkWeight" to null,
                "beatStrength" to null,
                "doubleBeat" to null,
                "dotSize" to null,
            ),
            shadowHeightFrac = { p -> p.number("heartScale", 0.3) * 1.1 },
            passUniforms = { _, _, params, density ->
                mapOf("uDotSize" to (params.number("dotSize") * density).toFloat())
            },
            draw = { canvas, w, h, params, info ->
                val beatStrength = params.number("beatStrength", 1.0)
                val doubleBeat = params.number("doubleBeat", 1.0)
                val scale = heartbeatScale(info.life, beatStrength, doubleBeat)
                val presence = heartPresence(info.life)
                val span = min(info.targetWidthPx, info.targetHeightPx)
                drawHeartburstPanel(
                    canvas, params, scale, info.life, presence, info.density,
                    info.centerX, info.centerY, span, w, h,
                )
            },
            frame = { info, params ->
                val beatStrength = params.number("beatStrength", 1.0)
                val doubleBeat = params.number("doubleBeat", 1.0)
                val beat = max(0.0, heartbeatScale(info.life, beatStrength, doubleBeat) - 1)
                mapOf(
                    "amp" to heartburstEnvelope(info.life, beatStrength, doubleBeat).toFloat(),
                    "uPresence" to heartPresence(info.life).toFloat(),
                    "uBeat" to min(1.0, beat * 2.2).toFloat(),
                    "uBurst" to burstProgress(info.life).toFloat(),
                    "uFlash" to heartFlash(info.life, beatStrength, doubleBeat).toFloat(),
                )
            },
        )
    }
}
