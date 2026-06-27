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

import ai.dopamine.core.DopeSdfAux
import ai.dopamine.core.DopeValue
import ai.dopamine.core.RGB
import ai.dopamine.core.decodeDopeSdf
import ai.dopamine.core.number
import ai.dopamine.core.steppedAnimMs
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
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

/**
 * The per-frame Canvas draw for a pass effect's sprite PANEL (y-down, top-left —
 * like Canvas2D / the panel-runner's `PanelDraw`). The generated factory wires a
 * `draw<Name>Panel` of this exact shape into `dopePassConfig(draw=)`.
 *
 * It receives the SAME `PanelFrameInfo` the Canvas-panel runner's `PanelDraw`
 * does — the sprite layer (motes, sparks) needs the bloom CENTRE + the real
 * (un-stepped) seconds clock, not the bare `animMs`/`life` a shader frame hook
 * gets. The runner builds it from the same inputs `GlPanelRunner` uses.
 */
typealias PassPanelDraw = (canvas: Canvas, widthPx: Int, heightPx: Int, params: Map<String, DopeValue>, info: PanelFrameInfo) -> Unit

/**
 * An OPTIONAL dynamic sprite panel for a PASS effect. A full-screen pass whose
 * look is mostly procedural (a bloom, a flash) but which also has a SPARSE
 * element layer (motes, sparks) rasterizes those into an offscreen Canvas once
 * per frame here; the runner uploads it as an RGBA texture bound at `unit` and
 * sets `sampler`. Unlike the panel runner, this COMPOSES with the baked-SDF aux
 * textures (`PassConfig.sdfAux`) — a pass effect can have BOTH together (the
 * pass-runner analogue of the web `PassConfig.panel`).
 */
class PassPanel(
    /** Texture unit to bind the panel on (distinct from any sdfAux unit). */
    val unit: Int,
    /** Sampler uniform name the shader reads the panel from. */
    val sampler: String,
    /** Draw one frame of the sprite layer into the offscreen Canvas (y-down). */
    val draw: PassPanelDraw,
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
    /**
     * OPTIONAL dynamic sprite panel (the pass-runner analogue of the panel
     * runner): an `android.graphics.Canvas` draw rasterized once per frame,
     * uploaded as an RGBA texture, bound at its `unit`, sampler set. Composes
     * with `sdfAux`. Null for effects with no sprite layer.
     */
    val panel: PassPanel? = null,
    /**
     * OPTIONAL baked-SDF aux textures (icon outlines): decoded + uploaded once as
     * single-channel R8 textures, bound each pass at their declared units with
     * their `on` flags raised to 1. Empty for effects with no SDF aux.
     */
    val sdfAux: List<DopeSdfAux> = emptyList(),
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

/** A decoded + uploaded SDF aux texture: its allocated texture id + the spec. */
private class BoundSdf(val texId: Int, val aux: DopeSdfAux)

/** Build a drawable `EffectInstance` for a pure-shader effect. */
fun createPassInstance(config: PassConfig, params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance {
    val pal = (params["palette"] as? DopeValue.Palette)?.stops ?: emptyList<RGB>()
    val durationMs = params.number("durationMs", 1.0)
    val style = params.number("style")
    val scalarBinds = computeScalarBinds(params, config.bindings)

    var disposed = false

    // --- Static baked-SDF aux textures (decode + upload once, up front) -------
    // Mirror the web's `UNPACK_FLIP_Y_WEBGL=true`: the field is stored top-row
    // first, so pre-flip the rows (bottom-row-first) before the R8 upload — GL
    // has no FLIP_Y. Each entry gets its own texture, bound at its declared unit.
    val boundSdfs: List<BoundSdf> = config.sdfAux.mapNotNull { aux ->
        val decoded = decodeDopeSdf(aux.dataURI) ?: return@mapNotNull null
        val tex = allocTexture()
        uploadR8(tex, decoded.size, flipRows(decoded.bytes, decoded.size))
        BoundSdf(tex, aux)
    }

    // --- Optional dynamic sprite panel (allocated lazily at the live size) ----
    val panelCfg = config.panel
    val panelTex: Int = if (panelCfg != null) allocTexture() else 0
    var panelBmp: Bitmap? = null
    var panelCanvas: Canvas? = null

    fun ensurePanel(w: Int, h: Int) {
        if (panelBmp == null || panelBmp!!.width != w || panelBmp!!.height != h) {
            panelBmp?.recycle()
            panelBmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            panelCanvas = Canvas(panelBmp!!)
        }
    }

    fun drawPass(isShadow: Boolean, info: FrameInfo, frameUniforms: Map<String, Float>, frameArrs: List<UniformArray>?) {
        val gl = ctx.gl
        val prog = gl.program(config.vertex, config.fragment)
        prog.resolve(STANDARD_PASS)
        prog.resolve(config.uniforms)
        GLES30.glUseProgram(prog.id)

        // Bind the static SDF aux textures (each at its declared unit, sampler set).
        for (b in boundSdfs) {
            GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + b.aux.unit)
            GLES30.glBindTexture(GLES30.GL_TEXTURE_2D, b.texId)
            prog.uniform(b.aux.sampler).let { if (it >= 0) GLES30.glUniform1i(it, b.aux.unit) }
        }
        // Bind the dynamic sprite panel (drawn + uploaded this frame in renderAt).
        if (panelCfg != null && panelBmp != null) {
            GLES30.glActiveTexture(GLES30.GL_TEXTURE0 + panelCfg.unit)
            uploadBitmap(panelTex, panelBmp!!)
            prog.uniform(panelCfg.sampler).let { if (it >= 0) GLES30.glUniform1i(it, panelCfg.unit) }
        }

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
        // Backdrop luminance drives the light-out boost (no-op at 0 ⇒ dark look
        // unchanged); a no-op uniform-set if the shader optimised it out.
        setF(prog, "uBackdropLum", ctx.backdropLum)
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
            // Redraw the dynamic sprite panel for this frame: clear, pre-flip
            // (web's UNPACK_FLIP_Y — see GlPanelRunner), draw in y-down logical
            // coords, then drawPass uploads + binds it.
            if (panelCfg != null) {
                ensurePanel(gl.width, gl.height)
                val bmp = panelBmp!!
                val canvas = panelCanvas!!
                // The sprite-panel draw needs the bloom CENTRE + the real seconds
                // clock (mote twinkle must stay smooth), so it gets the SAME
                // PanelFrameInfo the Canvas-panel runner builds — NOT the bare,
                // on-twos-snapped FrameInfo a shader frame hook gets. Use the
                // un-stepped `elapsedMs` (not the snapped animMs) for the clock,
                // the anchor as the centre, and the same target box as uTarget.
                val targetW = if (ctx.targetWidthPx > 0f) ctx.targetWidthPx else gl.width.toFloat()
                val targetH = if (ctx.targetHeightPx > 0f) ctx.targetHeightPx else gl.height.toFloat()
                val panelInfo = PanelFrameInfo(
                    elapsedMs = info.elapsedMs, life = info.life, density = ctx.density,
                    centerX = ctx.anchorX, centerY = ctx.anchorY,
                    targetWidthPx = targetW, targetHeightPx = targetH,
                    assets = ctx.assets,
                )
                bmp.eraseColor(Color.TRANSPARENT)
                canvas.save()
                canvas.translate(0f, gl.height.toFloat())
                canvas.scale(1f, -1f)
                panelCfg.draw(canvas, gl.width, gl.height, params, panelInfo)
                canvas.restore()
            }
            // Drop-shadow (single-surface, like MetalOverlayHost): render the shadow
            // pass into an off-screen FBO and composite it as premultiplied black
            // BEHIND the glow. Then re-arm the additive light blend and draw the glow
            // ON TOP. (No backdrop read needed — the shadow is encoded as source-over
            // black-alpha that darkens the live backdrop when the surface composites.)
            ctx.gl.withShadowComposite {
                drawPass(isShadow = true, info = info, frameUniforms = frameUniforms, frameArrs = frameArrs)
            }
            GLES30.glEnable(GLES30.GL_BLEND)
            GLES30.glBlendEquation(GLES30.GL_FUNC_ADD)
            GLES30.glBlendFunc(GLES30.GL_ONE, GLES30.GL_ONE)
            drawPass(isShadow = false, info = info, frameUniforms = frameUniforms, frameArrs = frameArrs)
        }

        override fun dispose() {
            if (disposed) return
            disposed = true
            val texIds = (boundSdfs.map { it.texId } + (if (panelCfg != null) listOf(panelTex) else emptyList())).toIntArray()
            if (texIds.isNotEmpty()) GLES30.glDeleteTextures(texIds.size, texIds, 0)
            panelBmp?.recycle()
            panelBmp = null
        }
    }
}

/**
 * Flip a square single-channel field's rows (bottom-row-first) so an R8 upload
 * matches the web's `UNPACK_FLIP_Y_WEBGL=true` (GL ES has no such pixel-store).
 */
private fun flipRows(bytes: ByteArray, size: Int): ByteArray {
    val out = ByteArray(bytes.size)
    for (row in 0 until size) {
        System.arraycopy(bytes, row * size, out, (size - 1 - row) * size, size)
    }
    return out
}
