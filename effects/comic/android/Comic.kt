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
import ai.dopamine.core.resolveTypography
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

    // The APK AssetManager — used to load both the `.dope` and (in the panel) the
    // bundled display-face ttf from `assets/fonts/`.
    private val assets = context.assets

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        assets.open("comic.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> {
        // Comic declares NO consts; `comicSeed` is the scatter key (the numeric/
        // palette half is byte-identical to the web `resolveDopeParams(DOPE,
        // feeling, {}, "comicSeed")`). The per-mood TYPOGRAPHY (face + curve
        // fields) is composed on top — ADDITIVE, mirroring the web composeComic,
        // so the parity grid stays green.
        val bag = resolveDopeParams(doc, feeling, consts = emptyMap(), scatterKey = "comicSeed").toMutableMap()
        bag.putAll(resolveTypography(doc, feeling.mood, feeling.intensity, feeling.whimsy))
        return bag
    }

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPanelInstance(config, params, ctx)

    // Web factory `reducedMotion: { peakMs: 220, holdMs: 360 }`.
    override val reducedMotionPeakMs: Double = 220.0
    override val reducedMotionHoldMs: Double = 360.0

    // The panel config is per-INSTANCE (not a static val) so its `draw` lambda can
    // close over the AssetManager and load the bundled display faces.
    private val config = PanelConfig(
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
            // ANIMATED (web parity): redrawn each frame with the LIVE slam scale +
            // presence (recovered from info.elapsedMs / info.life), with the full
            // per-letter typography in the mood-picked bundled face.
            drawComicPanel(
                canvas, assets, params,
                info.elapsedMs, info.life,
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

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Comic {
            val fx = Comic(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }
    }
}
