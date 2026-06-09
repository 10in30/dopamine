// Comic Impact as a Dopamine effect on the Android backbone — mirror of the web
// `effect-comic/src/index.ts` + swift's `Comic.swift`.
//
// Per the generalization mandate, the ONLY per-effect code is {the GLSL shader +
// the bespoke tempo + the Canvas panel draw + a tiny config naming its uniforms /
// bindings / frame timing}. Everything else — the `.dope` mapping, the OKLCH
// palette, the registry, the panel runner, the standard uniforms, the shadow
// geometry — is shared backbone. The numeric/palette bag comes verbatim from the
// bundled `.dope` (the SAME bytes as the web), resolved by the shared loader
// (byte-parity proven); the seed-picked SLAMMED word is composed inside the panel
// draw with the shared `pickFromList` (no effect on the numeric/palette parity).
//
// HYBRID: the jagged starburst + hand-lettered word + ink contours are drawn into
// ONE offscreen Canvas panel each frame (ComicPanel.kt); the fragment shader
// (ComicShader.kt) adds the Ben-Day halftone, action lines, flash, noir↔pop
// styling and casts the light. Uses `createPanelInstance` + `PanelConfig` (like
// heartburst), NOT the pure-shader pass runner.

package ai.dopamine.effect.comic

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
import kotlin.math.exp
import kotlin.math.min

class Comic(context: Context) : DrawableEffect {
    override val name: String = "comic"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("comic.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // Comic declares NO consts; `comicSeed` is the scatter key (byte-identical
        // to the web `resolveDopeParams(DOPE, feeling, {}, "comicSeed")`).
        resolveDopeParams(doc, feeling, consts = emptyMap(), scatterKey = "comicSeed")

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPanelInstance(CONFIG, params, ctx)

    // Web factory `reducedMotion: { peakMs: 220, holdMs: 360 }`.
    override val reducedMotionPeakMs: Double = 220.0
    override val reducedMotionHoldMs: Double = 360.0

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Comic {
            val fx = Comic(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        private val CONFIG = PanelConfig(
            vertex = COMIC_VERTEX_SRC,
            fragment = COMIC_FRAGMENT_SRC,
            panelSampler = "uPanel",
            // The shader's non-standard uniforms (the standard half — uCenter,
            // uResolution, uTarget, uLife, uTimeS, uStyle, uAmp, uC0..2, uShadow* —
            // is resolved by the runner). Mirrors the web `index.ts` `uniforms`.
            uniforms = listOf(
                "uPresence", "uFlash", "uExposure", "uHalftone", "uDotSize",
                "uSaturation", "uActionLines", "uInkBoost", "uSeed",
            ),
            // comicSeed drives uSeed; raw seed / overshoot / draw-only geometry
            // (scale, burstPoints, inkWeight) + the dpr-scaled dotSize are NOT
            // auto-bound uniforms (matches the web `bindings`).
            bindings = mapOf(
                "comicSeed" to "uSeed",
                "seed" to null,
                "overshoot" to null,
                "scale" to null,
                "burstPoints" to null,
                "inkWeight" to null,
                "dotSize" to null,
            ),
            // The web `PanelConfig.shadowHeightFrac` is a constant 0.5 (the panel's
            // implied occluder height); no `.dope` param drives it.
            shadowHeightFrac = { 0.5 },
            passUniforms = { _, _, params, density ->
                // dotSize is authored at 1x dpr; multiply by the live density.
                // inkBoost fattens the ink toward the pop end. Both mirror the web
                // `passUniforms` (cross-checked vs swift `packUniforms`).
                mapOf(
                    "uDotSize" to (params.number("dotSize") * density).toFloat(),
                    "uInkBoost" to (1.0 + params.number("style") * 0.4).toFloat(),
                )
            },
            draw = { canvas, w, h, params, info ->
                // Static-at-landed-pose panel (swift simplification): the slam +
                // presence read through the shader uniforms (uPresence/uFlash from
                // frame()); the panel geometry is baked at rest.
                drawComicPanel(
                    canvas, params,
                    info.centerX, info.centerY,
                    info.targetWidthPx, info.targetHeightPx,
                    w, h,
                )
            },
            frame = { info, _ ->
                // Mirror the web `frame()`: presence feeds the shadow geometry amp
                // AND uPresence; the impact flash is the fast spike that throws cast
                // light (clamped as before).
                val presence = impactPresence(info.life)
                val flash =
                    exp(-info.elapsedMs / (IMPACT_MS * 0.55)) +
                        0.25 * exp(-kotlin.math.abs(info.elapsedMs - IMPACT_HOLD_MS * 0.2) / (IMPACT_MS * 0.8))
                mapOf(
                    "amp" to presence.toFloat(),
                    "uPresence" to presence.toFloat(),
                    "uFlash" to min(flash, 1.2).toFloat(),
                )
            },
        )
    }
}
