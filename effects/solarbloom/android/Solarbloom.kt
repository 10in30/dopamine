// Solarbloom as a Dopamine effect on the Android backbone — the DATA-DRIVEN
// registration shim (mirror of the web `effect-solarbloom/src/index.ts`).
//
// Solarbloom is a PASS HYBRID on web (a procedural bloom + checkmark + a Canvas2D
// mote SPRITE PANEL). On Android the GL backbone has no Canvas sprite-panel/aux
// support for a PASS effect, so the SHADER stays a hand-written per-platform
// source that renders the motes PROCEDURALLY (the per-pixel mote loop) and the
// checkmark via the ANALYTIC two-segment SDF branch (uSdfOn / uCheckTexOn pinned
// OFF — the fail precedent). But everything around that shader is now DATA:
// `dopePassPlan` + `dopePassConfig` derive the uniforms / bindings / per-frame
// logic (`tempo.frame`) / per-pass uniforms (`render.pass`) / shadow height /
// reduced motion / MAX_MOTES const straight from solarbloom.dope.json — so there
// is no hand-written SolarbloomTempo.kt and no hand frame()/passUniforms here.
// The numeric/palette bag is the SAME bytes as the web (byte-parity proven by
// the 192-case grid). The whimsy-picked check GLYPH band stays a code-shaped
// compose (no rng, no parity effect).

package ai.dopamine.effect.solarbloom

import ai.dopamine.core.DopeDoc
import ai.dopamine.core.DopePassPlan
import ai.dopamine.core.DopeResolveInput
import ai.dopamine.core.DopeValue
import ai.dopamine.core.EffectRegistry
import ai.dopamine.core.dopePassPlan
import ai.dopamine.core.parseDope
import ai.dopamine.core.pickBand
import ai.dopamine.core.resolveDopeParams
import ai.dopamine.gl.DrawableEffect
import ai.dopamine.gl.EffectContext
import ai.dopamine.gl.EffectInstance
import ai.dopamine.gl.PassConfig
import ai.dopamine.gl.createPassInstance
import ai.dopamine.gl.dopePassConfig
import android.content.Context

class Solarbloom(context: Context) : DrawableEffect {
    override val name: String = "solarbloom"

    // Load the bundled `.dope` (the EXACT web bytes) from the merged APK assets —
    // proving the data spine is shared verbatim across platforms.
    val doc: DopeDoc = parseDope(
        context.assets.open("solarbloom.dope.json").bufferedReader(Charsets.UTF_8).use { it.readText() },
    )

    // The whole factory (resolve consts/scatter, uniforms/bindings, the per-frame
    // logic, the per-pass uniforms, shadow height, reduced motion) is data:
    // solarbloom.dope.json interpreted by the core backbone.
    private val plan: DopePassPlan = dopePassPlan(doc)
    private val scatterKey: String =
        plan.scatterKey ?: throw IllegalStateException("dope: ${doc.id} has no binding.scatterKey")

    // The whimsy→check-glyph fallback BANDS live in the `.dope` (content.glyphBands);
    // composed onto the resolved bag as metadata (the canonical icon is the baked SDF).
    private val glyphBands: List<Map<String, String>> =
        doc.raw["content"]?.get("glyphBands")?.asArray?.mapNotNull { b ->
            val fam = b["family"]?.asString
            val ch = b["char"]?.asString
            if (fam != null && ch != null) mapOf("family" to fam, "char" to ch) else null
        } ?: listOf(mapOf("family" to "Dopamine Check Symbols", "char" to "✓"))

    private val config: PassConfig = dopePassConfig(doc, SOLARBLOOM_VERTEX_SRC, SOLARBLOOM_FRAGMENT_SRC, plan)

    override fun resolve(feeling: DopeResolveInput): Map<String, DopeValue> =
        resolveDopeParams(doc, feeling, consts = plan.consts, scatterKey = scatterKey)

    /** The whimsy-picked check glyph (composed metadata for a host glyph-fallback). */
    fun pickCheckGlyph(whimsy: Double): Map<String, String> = pickBand(glyphBands, whimsy)

    override fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance =
        createPassInstance(config, params, ctx)

    override val reducedMotionPeakMs: Double? = plan.reducedMotionPeakMs
    override val reducedMotionHoldMs: Double? = plan.reducedMotionHoldMs

    companion object {
        /** Construct + register the effect (needs a Context for the `.dope` asset). */
        fun register(context: Context): Solarbloom {
            val fx = Solarbloom(context.applicationContext)
            EffectRegistry.register(fx)
            return fx
        }
    }
}
