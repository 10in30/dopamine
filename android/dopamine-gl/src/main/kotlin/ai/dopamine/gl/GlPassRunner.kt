// Generic full-screen-pass runner — port of `framework/pass-runner.ts`.
//
// A pure-shader effect (Solarbloom, Verdict, Fail, Lightning, Ripple, Confetti,
// Aurora) is a full-screen triangle running a fragment shader. The web ran it
// twice (light + multiply shadow); the Android `DopamineView` overlay is
// self-contained (light only — see Look.kt's GLSL_LIGHT_OUT note), so this runner
// draws the LIGHT pass. The shadow path stays in the config/shader contract
// (`shadowHeightFrac`, the `uShadow` branch) for portability, just unused by the
// single-surface host.
//
// What stays per-effect: the GLSL + a tiny `frame()` hook computing the genuinely
// time-varying uniforms. Everything else — standard uniforms, the `name →
// u<Name>` scalar auto-binding, the "animate on twos" stepping — is generic.

package ai.dopamine.gl

import ai.dopamine.core.DopeValue
import ai.dopamine.core.RGB
import ai.dopamine.core.number
import ai.dopamine.core.steppedAnimMs
import android.opengl.GLES30

/** Config for one pure-shader effect. The genuinely code-shaped bits live here. */
class PassConfig(
    /** Vertex + fragment GLSL (the per-effect look). */
    val vertex: String,
    val fragment: String,
    /** Every uniform name the shader reads (informational; locations resolve lazily). */
    val uniforms: List<String> = emptyList(),
    /** Whether the shader reads `uOrigin` (anchored radial effects do). */
    val usesOrigin: Boolean = false,
    /** `param name → uniform name` overrides; map to `null` to skip a non-uniform param. */
    val bindings: Map<String, String?> = emptyMap(),
    /** Shadow occluder "height" as a fraction of min canvas dim (kept for portability). */
    val shadowHeightFrac: (Map<String, DopeValue>) -> Double = { 0.7 },
    /** Extra per-pass scalar uniforms depending on the live canvas / density. */
    val passUniforms: ((widthPx: Int, heightPx: Int, params: Map<String, DopeValue>, density: Float) -> Map<String, Float>)? = null,
    /**
     * Compute the genuinely effect-specific TIME-VARYING uniforms for a frame
     * (envelope amp, confirm/draw/stamp progress, …). Returns name → float; the
     * well-known key `amp` feeds the (portable) shadow geometry.
     */
    val frame: (FrameInfo, Map<String, DopeValue>) -> Map<String, Float>,
)

private val STANDARD_PASS = listOf(
    "uOrigin", "uResolution", "uTarget", "uLife", "uTimeS", "uStyle", "uAmp",
    "uC0", "uC1", "uC2", "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
)

/** Build a drawable `EffectInstance` for a pure-shader effect. */
fun createPassInstance(config: PassConfig, params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance {
    val pal = (params["palette"] as? DopeValue.Palette)?.stops ?: emptyList<RGB>()
    val durationMs = params.number("durationMs", 1.0)
    val style = params.number("style")
    val scalarBinds = computeScalarBinds(params, config.bindings)

    var disposed = false

    fun drawPass(isShadow: Boolean, info: FrameInfo, frameUniforms: Map<String, Float>) {
        val gl = ctx.gl
        val prog = gl.program(config.vertex, config.fragment)
        prog.resolve(STANDARD_PASS)
        prog.resolve(config.uniforms)
        GLES30.glUseProgram(prog.id)

        applyFloatMap(prog, config.passUniforms?.invoke(gl.width, gl.height, params, ctx.density))

        prog.uniform("uResolution").let { if (it >= 0) GLES30.glUniform2f(it, gl.width.toFloat(), gl.height.toFloat()) }
        bindTarget(prog, gl.width, gl.height, ctx.targetWidthPx, ctx.targetHeightPx)
        if (config.usesOrigin) {
            // gl_FragCoord origin is bottom-left, so flip the anchor's y. Coords are
            // already device px (no dpr multiply — unlike web's CSS-px anchor).
            prog.uniform("uOrigin").let { if (it >= 0) GLES30.glUniform2f(it, ctx.anchorX, gl.height - ctx.anchorY) }
        }
        setF(prog, "uLife", info.life.toFloat())
        setF(prog, "uTimeS", (info.animMs / 1000.0).toFloat())
        setF(prog, "uStyle", style.toFloat())
        bindPalette(prog, pal)
        bindScalars(prog, params, scalarBinds)
        bindFrameUniforms(prog, frameUniforms)

        setF(prog, "uShadow", if (isShadow) 1f else 0f)
        if (isShadow) {
            val amp = frameUniforms["amp"]?.toDouble() ?: 0.0
            bindShadowGeometry(prog, gl.width, gl.height, config.shadowHeightFrac(params), amp, style)
        }
        drawFullscreenTriangle(gl)
    }

    return object : EffectInstance {
        override val durationMs: Double = durationMs

        override fun renderAt(elapsedMs: Double) {
            if (disposed) return
            val animMs = steppedAnimMs(elapsedMs, style)
            val life = minOf(maxOf(animMs, 0.0) / durationMs, 1.0)
            val info = FrameInfo(animMs = animMs, life = life, elapsedMs = elapsedMs)
            val frameUniforms = config.frame(info, params)
            // Self-contained overlay: light pass only (the shadow pass needs a
            // backdrop the GL surface can't read — see Look.kt / MetalOverlayHost).
            drawPass(isShadow = false, info = info, frameUniforms = frameUniforms)
        }

        override fun dispose() { disposed = true }
    }
}
