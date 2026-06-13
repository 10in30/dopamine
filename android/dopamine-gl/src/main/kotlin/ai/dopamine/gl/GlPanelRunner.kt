// Generic Canvas "panel" runner — port of `framework/panel-runner.ts`.
//
// The shared backbone for HYBRID effects whose per-frame content is drawn with a
// 2D Canvas (vector / text / shape) and then LIT by a fragment shader (Heartburst's
// hero + burst hearts; Comic's word + starburst + ink). It owns the offscreen
// panel Bitmap, the per-frame draw → texture upload, the standard uniforms, and
// the light pass. What stays per-effect: the GLSL + a small `draw()` (the
// genuinely code-shaped vector/text logic) + a tiny config.
//
// COORDINATE FLIP (the web's `UNPACK_FLIP_Y_WEBGL`): the effect's `draw()` works
// in a y-DOWN, top-left canvas space (identical to Canvas2D / the web renderer),
// and this runner pre-flips the Canvas (translate(0,h); scale(1,-1)) so the STORED
// bitmap is vertically mirrored — making the uploaded GL texel orientation match
// the web (texel v=0 == canvas bottom). Path geometry flips cleanly; a text effect
// flips the glyph block back locally (as the swift comic panel does).

package ai.dopamine.gl

import ai.dopamine.core.DopeValue
import ai.dopamine.core.RGB
import ai.dopamine.core.number
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.opengl.GLES30

/** The per-frame Canvas draw for one hybrid effect (y-down, top-left — like Canvas2D). */
typealias PanelDraw = (canvas: Canvas, widthPx: Int, heightPx: Int, params: Map<String, DopeValue>, info: PanelFrameInfo) -> Unit

/** Config for one Canvas-panel (hybrid) effect. */
class PanelConfig(
    val vertex: String,
    val fragment: String,
    val uniforms: List<String> = emptyList(),
    /** Sampler uniform for the uploaded panel (bound to texture unit 0). */
    val panelSampler: String = "uPanel",
    val bindings: Map<String, String?> = emptyMap(),
    val shadowHeightFrac: (Map<String, DopeValue>) -> Double = { 0.3 },
    /** The per-frame Canvas draw (the genuinely code-shaped vector/text logic). */
    val draw: PanelDraw,
    /** Time-varying uniforms (presence, flash, …); `amp` feeds the shadow geometry. */
    val frame: (PanelFrameInfo, Map<String, DopeValue>) -> Map<String, Float>,
    /**
     * Extra per-pass scalar uniforms depending on the live canvas / density /
     * targeted element box (device px, full-canvas fallback applied).
     */
    val passUniforms: ((widthPx: Int, heightPx: Int, params: Map<String, DopeValue>, density: Float, targetWidthPx: Float, targetHeightPx: Float) -> Map<String, Float>)? = null,
)

// `uOrigin` carries the SAME anchor as `uCenter` so a panel shader may use the
// pass-runner spelling (the single-source GLSL→MSL path maps it onto `origin`).
private val STANDARD_PANEL = listOf(
    "uCenter", "uOrigin", "uResolution", "uTarget", "uLife", "uTimeS", "uStyle", "uAmp",
    "uC0", "uC1", "uC2", "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
)

/** Build a drawable `EffectInstance` for a Canvas-panel effect. */
fun createPanelInstance(config: PanelConfig, params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance {
    val pal = (params["palette"] as? DopeValue.Palette)?.stops ?: emptyList<RGB>()
    val durationMs = params.number("durationMs", 1.0)
    val style = params.number("style")
    val scalarBinds = computeScalarBinds(params, config.bindings)

    var panel: Bitmap? = null
    var panelCanvas: Canvas? = null
    val panelTex = allocTexture()
    var disposed = false

    fun ensurePanel(w: Int, h: Int) {
        if (panel == null || panel!!.width != w || panel!!.height != h) {
            panel?.recycle()
            panel = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            panelCanvas = Canvas(panel!!)
        }
    }

    return object : EffectInstance {
        override val durationMs: Double = durationMs

        override fun renderAt(elapsedMs: Double) {
            if (disposed) return
            val gl = ctx.gl
            val w = gl.width
            val h = gl.height
            ensurePanel(w, h)
            val bmp = panel!!
            val canvas = panelCanvas!!

            val life = minOf(maxOf(elapsedMs, 0.0) / durationMs, 1.0)
            val targetW = if (ctx.targetWidthPx > 0f) ctx.targetWidthPx else w.toFloat()
            val targetH = if (ctx.targetHeightPx > 0f) ctx.targetHeightPx else h.toFloat()
            val info = PanelFrameInfo(
                elapsedMs = elapsedMs, life = life, density = ctx.density,
                // Panel draw is y-down top-left (canvas space): the centre is the anchor.
                centerX = ctx.anchorX, centerY = ctx.anchorY,
                targetWidthPx = targetW, targetHeightPx = targetH,
            )
            val frameUniforms = config.frame(info, params)

            // Draw the panel for this frame. Clear, then pre-flip so the stored
            // bitmap is y-up (the web's UNPACK_FLIP_Y), then draw in y-down logical
            // coords (web-identical effect code).
            bmp.eraseColor(Color.TRANSPARENT)
            canvas.save()
            canvas.translate(0f, h.toFloat())
            canvas.scale(1f, -1f)
            config.draw(canvas, w, h, params, info)
            canvas.restore()

            // Upload + light pass.
            val prog = gl.program(config.vertex, config.fragment)
            prog.resolve(STANDARD_PANEL)
            prog.resolve(config.uniforms)
            GLES30.glUseProgram(prog.id)

            GLES30.glActiveTexture(GLES30.GL_TEXTURE0)
            uploadBitmap(panelTex, bmp)
            prog.uniform(config.panelSampler).let { if (it >= 0) GLES30.glUniform1i(it, 0) }

            applyFloatMap(prog, config.passUniforms?.invoke(w, h, params, ctx.density, targetW, targetH))

            prog.uniform("uResolution").let { if (it >= 0) GLES30.glUniform2f(it, w.toFloat(), h.toFloat()) }
            bindTarget(prog, w, h, ctx.targetWidthPx, ctx.targetHeightPx)
            // uCenter: the impact/heart centre the procedural parts radiate from —
            // matches the anchor, y-flipped to the y-up frag space (web parity).
            prog.uniform("uCenter").let { if (it >= 0) GLES30.glUniform2f(it, ctx.anchorX, h - ctx.anchorY) }
            prog.uniform("uOrigin").let { if (it >= 0) GLES30.glUniform2f(it, ctx.anchorX, h - ctx.anchorY) }
            setF(prog, "uLife", life.toFloat())
            setF(prog, "uTimeS", (elapsedMs / 1000.0).toFloat()) // panels don't step "on twos"
            setF(prog, "uStyle", style.toFloat())
            bindPalette(prog, pal)
            bindScalars(prog, params, scalarBinds)
            bindFrameUniforms(prog, frameUniforms)
            setF(prog, "uShadow", 0f)
            drawFullscreenTriangle(gl)
        }

        override fun dispose() {
            if (disposed) return
            disposed = true
            val ids = intArrayOf(panelTex)
            GLES30.glDeleteTextures(1, ids, 0)
            panel?.recycle()
            panel = null
        }
    }
}
