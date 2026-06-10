// Inkstroke (Calligraphic Verdict) as a Dopamine effect on the Android backbone —
// mirror of the web `effect-inkstroke/src/index.ts` + swift's `Inkstroke.swift`.
//
// Per the generalization mandate, the ONLY per-effect code is {the GLSL shader +
// the bespoke tempo + a tiny config naming its uniforms / bindings / shadow
// height / per-frame timing}. Everything else — the `.dope` mapping, the OKLCH
// golden-angle palette, the registry, the fullscreen-pass runner, the standard
// uniforms, the shadow geometry — is shared backbone. The numeric/palette bag
// comes verbatim from the bundled `.dope` (the SAME bytes as the web), resolved
// by the shared loader (byte-parity proven by the 192-case grid).
//
// PURE-SHADER (not a hybrid): the gesture is a fully analytic, data-driven stroke,
// so there is no Canvas panel and no content glyph — it uses `createPassInstance`
// + `PassConfig` (not the panel runner). The gesture centres on the targeted
// element (uOrigin + uTarget) and falls back to the canvas when untargeted.

package ai.dopamine.effect.inkstroke

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

class Inkstroke(context: Context) : DrawableEffect {
    override val name: String = "inkstroke"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("inkstroke.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        // `MAX_DROPS` is the only const (= the GLSL `#define MAX_DROPS 64`);
        // `inkSeed` is the scatter key — both byte-identical to the web call.
        resolveDopeParams(doc, feeling, consts = mapOf("MAX_DROPS" to 64.0), scatterKey = "inkSeed")

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(CONFIG, params, ctx)

    override val reducedMotionPeakMs: Double = 300.0
    override val reducedMotionHoldMs: Double = 360.0

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Inkstroke {
            val fx = Inkstroke(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }

        private val CONFIG = PassConfig(
            vertex = INKSTROKE_VERTEX_SRC,
            fragment = INKSTROKE_FRAGMENT_SRC,
            // The gesture centres on the targeted element (uOrigin) and scales to its
            // box (uTarget, a standard uniform); both default to the full canvas.
            usesOrigin = true,
            uniforms = listOf(
                "uDraw", "uExposure", "uScale", "uPressure", "uWetness", "uBristle",
                "uDroplets", "uSeed",
            ),
            // inkSeed binds to uSeed (not uInkSeed); overshoot feeds the envelope, not a uniform.
            bindings = mapOf("inkSeed" to "uSeed", "overshoot" to null),
            shadowHeightFrac = { p -> p.number("scale", 0.7) * 0.5 },
            frame = { info, params ->
                mapOf(
                    "amp" to envelope(info.life, params.number("overshoot", 1.0)).toFloat(),
                    // The pen draws on its OWN ~360ms clock (bespoke tempo). The web
                    // `frame()` feeds the "on twos"-snapped `animMs` to `strokeProgress`
                    // (the stroke shares the cel jitter clock), so use `info.animMs` to
                    // match parity — NOT the un-stepped elapsed time (cf. swift).
                    "uDraw" to strokeProgress(info.animMs).toFloat(),
                )
            },
        )
    }
}
