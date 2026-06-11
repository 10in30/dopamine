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
// time-varying uniforms, and (optionally) a `frameArrays` hook that CPU-precomputes
// geometry into uniform ARRAYS (lightning's bolt polyline → uVerts/uBoltMeta) —
// far cheaper than re-deriving it per pixel. Everything else — standard uniforms,
// the `name → u<Name>` scalar auto-binding, the "animate on twos" stepping — is generic.

package ai.dopamine.gl

import ai.dopamine.core.DopeValue
import ai.dopamine.core.RGB
import ai.dopamine.core.number
import ai.dopamine.core.steppedAnimMs
import android.opengl.GLES30

/** A per-frame ARRAY uniform (vec2/3/4 array): `name`, component `size` (2/3/4), flat `data`. */
class UniformArray(val name: String, val size: Int, val data: FloatArray)

/** Live geometry handed to a `frameArrays` hook: canvas px + the gl-coords strike origin. */
data class FrameGeom(
    val widthPx: Int,
    val heightPx: Int,
    val density: Float,
    /** Strike/anchor origin in gl_FragCoord space (device px, y-UP). */
    val originX: Float,
    val originY: Float,
)

/** Config for one pure-shader effect. The genuinely code-shaped bits live here. */
class PassConfig(
    /** Vertex + fragment GLSL (the per-effect look). */
    val vertex: String,
    val fragment: String,
    /** Every uniform name the shader reads (informational; locations resolve lazily). */
    val uniforms: List<String> = emptyList(),
    /** Whether the shader reads `uOrigin` (anchored radial effects do). */
    val usesOrigin: Boolean = false,
    /**
     * The seamless loop period in ms (`tempo.loop.periodMs`) for a CONTINUOUS
     * effect. When set, the runner computes the standard periodic clock
     * uniforms each frame from the snapped clock: `uLoopS` (seconds within the
     * current loop) and `uPhase` (normalized [0, 1)) — so a looping shader
     * needs no per-effect period plumbing. Null for one-shot effects.
     */
    val loopPeriodMs: Double? = null,
    /** `param name → uniform name` overrides; map to `null` to skip a non-uniform param. */
    val bindings: Map<String, String?> = emptyMap(),
    /** Shadow occluder "height" as a fraction of min canvas dim (kept for portability). */
    val shadowHeightFrac: (Map<String, DopeValue>) -> Double = { 0.7 },
    /**
     * Extra per-pass scalar uniforms depending on the live canvas / density /
     * target geometry. `targetWidthPx`/`targetHeightPx` are the targeted
     * element box in device px with the full-canvas fallback already applied
     * (the same box `uTarget` binds).
     */
    val passUniforms: ((widthPx: Int, heightPx: Int, params: Map<String, DopeValue>, density: Float, targetWidthPx: Float, targetHeightPx: Float) -> Map<String, Float>)? = null,
    /**
     * Compute the genuinely effect-specific TIME-VARYING uniforms for a frame
     * (envelope amp, confirm/draw/stamp progress, …). Returns name → float; the
     * well-known key `amp` feeds the (portable) shadow geometry.
     */
    val frame: (FrameInfo, Map<String, DopeValue>) -> Map<String, Float>,
    /**
     * OPTIONAL per-frame ARRAY uniforms (vec2/3/4 arrays) for effects that
     * CPU-precompute geometry each frame and feed it to the shader as a uniform
     * array (lightning's bolt polyline). Computed once per frame; each returned
     * `name` must also be declared `uniform vecN name[...]` in the shader.
     */
    val frameArrays: ((FrameInfo, Map<String, DopeValue>, FrameGeom) -> List<UniformArray>)? = null,
)

private val STANDARD_PASS = listOf(
    "uOrigin", "uResolution", "uTarget", "uLife", "uTimeS", "uLoopS", "uPhase", "uStyle", "uAmp",
    "uC0", "uC1", "uC2", "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
)

private fun bindArrays(prog: GlProgram, arrays: List<UniformArray>?) {
    if (arrays == null) return
    for (a in arrays) {
        val loc = prog.uniform(a.name)
        if (loc < 0) continue
        val count = a.data.size / a.size
        when (a.size) {
            2 -> GLES30.glUniform2fv(loc, count, a.data, 0)
            3 -> GLES30.glUniform3fv(loc, count, a.data, 0)
            4 -> GLES30.glUniform4fv(loc, count, a.data, 0)
        }
    }
}

/** Build a drawable `EffectInstance` for a pure-shader effect. */
fun createPassInstance(config: PassConfig, params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance {
    val pal = (params["palette"] as? DopeValue.Palette)?.stops ?: emptyList<RGB>()
    val durationMs = params.number("durationMs", 1.0)
    val style = params.number("style")
    val scalarBinds = computeScalarBinds(params, config.bindings)

    var disposed = false

    fun drawPass(isShadow: Boolean, info: FrameInfo, frameUniforms: Map<String, Float>, frameArrs: List<UniformArray>?) {
        val gl = ctx.gl
        val prog = gl.program(config.vertex, config.fragment)
        prog.resolve(STANDARD_PASS)
        prog.resolve(config.uniforms)
        GLES30.glUseProgram(prog.id)

        // Target box (device px) with the full-canvas fallback — the SAME rule
        // bindTarget applies for the uTarget standard uniform.
        val targetW = if (ctx.targetWidthPx > 0f) ctx.targetWidthPx else gl.width.toFloat()
        val targetH = if (ctx.targetHeightPx > 0f) ctx.targetHeightPx else gl.height.toFloat()
        applyFloatMap(prog, config.passUniforms?.invoke(gl.width, gl.height, params, ctx.density, targetW, targetH))

        prog.uniform("uResolution").let { if (it >= 0) GLES30.glUniform2f(it, gl.width.toFloat(), gl.height.toFloat()) }
        bindTarget(prog, gl.width, gl.height, ctx.targetWidthPx, ctx.targetHeightPx)
        if (config.usesOrigin) {
            // gl_FragCoord origin is bottom-left, so flip the anchor's y. Coords are
            // already device px (no dpr multiply — unlike web's CSS-px anchor).
            prog.uniform("uOrigin").let { if (it >= 0) GLES30.glUniform2f(it, ctx.anchorX, gl.height - ctx.anchorY) }
        }
        setF(prog, "uLife", info.life.toFloat())
        setF(prog, "uTimeS", (info.animMs / 1000.0).toFloat())
        config.loopPeriodMs?.let { p ->
            // Standard periodic clocks for a looping effect, off the SAME snapped
            // clock as uTimeS (so the on-twos seam guarantee carries over).
            val loopMs = info.animMs % p
            setF(prog, "uLoopS", (loopMs / 1000.0).toFloat())
            setF(prog, "uPhase", (loopMs / p).toFloat())
        }
        setF(prog, "uStyle", style.toFloat())
        bindPalette(prog, pal)
        bindScalars(prog, params, scalarBinds)
        bindFrameUniforms(prog, frameUniforms)
        bindArrays(prog, frameArrs)

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
            val gl = ctx.gl
            val animMs = steppedAnimMs(elapsedMs, style)
            val life = minOf(maxOf(animMs, 0.0) / durationMs, 1.0)
            val info = FrameInfo(animMs = animMs, life = life, elapsedMs = elapsedMs)
            val frameUniforms = config.frame(info, params)
            // CPU-precomputed array uniforms (origin in gl coords, y-up — matching web).
            val frameArrs = config.frameArrays?.invoke(
                info, params,
                FrameGeom(gl.width, gl.height, ctx.density, ctx.anchorX, gl.height - ctx.anchorY),
            )
            // Self-contained overlay: light pass only (the shadow pass needs a
            // backdrop the GL surface can't read — see Look.kt / MetalOverlayHost).
            drawPass(isShadow = false, info = info, frameUniforms = frameUniforms, frameArrs = frameArrs)
        }

        override fun dispose() { disposed = true }
    }
}
