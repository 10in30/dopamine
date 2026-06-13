// Confetti Canvas PANEL drawing — the PANEL-DRAW SEAM, ported to
// `android.graphics` (a faithful port of the web `confetti-renderer.ts` / the
// Swift `ConfettiPanel.swift`). This is the ONLY hand-written Kotlin the effect
// ships; the registration shim (`Confetti.kt`) and the GLSL (`ConfettiShader.kt`)
// are GENERATED from confetti.dope.json + the canonical web GLSL, and the
// generated factory wires `drawConfettiPanel` into `dopePanelConfig(draw=)`.
// Everything time-shaped the SHADER consumes (amp) is `tempo.frame` DATA; the
// per-piece poses below are panel GEOMETRY (the ballistic launch-then-fall) —
// code by design.
//
// HYBRID effect: the crisp paper pieces (spinning rectangles + a few petals) are
// NOT procedural in the shader — the web traces them into an offscreen Canvas2D
// ("panel") and the fragment shader (the generated ConfettiShader.kt) samples
// that texture and applies the global gain (amp · exposure), ACES tonemap, the
// cel posterize toward the whimsy end, an ordered dither, and the soft cast
// shadow. The shared `GlPanelRunner` owns the panel Bitmap + per-frame upload +
// light pass; this file supplies ONLY the per-effect draw.
//
// PANEL CHANNEL ENCODING (must match ConfettiShader.kt exactly):
//   RGB = Σ per-piece LIT colour (palette × paper/cel shading), pre-multiplied by
//         the piece's lifetime fade, accumulated ADDITIVELY across pieces.
// The web draws with `globalCompositeOperation = "lighter"` (additive);
// `PorterDuff.Mode.ADD` is the Android equivalent (swift used `.plusLighter`).
//
// COORDINATE FLIP: `GlPanelRunner` pre-flips the Canvas to a y-up store (the web's
// UNPACK_FLIP_Y), so this draws in y-DOWN top-left logical coords (web-identical).

package ai.dopamine.effect.confetti

import ai.dopamine.core.DopeValue
import ai.dopamine.core.RGB
import ai.dopamine.core.mulberry32
import ai.dopamine.core.number
import ai.dopamine.gl.PanelFrameInfo
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RectF
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.cos
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/** Max confetti pieces — the panel loop bound, the single source of truth shared
 * with the `.dope` integer clamp (`render.consts.MAX_PIECES`) + the web/Swift
 * value. Counts above this won't render. */
private const val CONFETTI_MAX_PIECES = 120

private const val TAU: Double = PI * 2

private fun clamp01(x: Double): Double = if (x < 0) 0.0 else if (x > 1) 1.0 else x
private fun mix(a: Double, b: Double, t: Double): Double = a + (b - a) * t
private fun fract(x: Double): Double = x - floor(x)
private fun smoothstep(e0: Double, e1: Double, x: Double): Double {
    val t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
}

/** paletteMix from the look lib: a two-segment lerp across the three stops. */
private fun paletteMix(pal: List<RGB>, tIn: Double): RGB {
    val t = clamp01(tIn)
    if (pal.size < 3) return pal.firstOrNull() ?: RGB(1.0, 1.0, 1.0)
    val c0 = pal[0]; val c1 = pal[1]; val c2 = pal[2]
    return if (t < 0.5) {
        val k = t * 2
        RGB(mix(c0.r, c1.r, k), mix(c0.g, c1.g, k), mix(c0.b, c1.b, k))
    } else {
        val k = (t - 0.5) * 2
        RGB(mix(c1.r, c2.r, k), mix(c1.g, c2.g, k), mix(c1.b, c2.b, k))
    }
}

private fun channel(v: Double): Int = (255.0 * clamp01(v)).roundToInt().coerceIn(0, 255)

/**
 * The per-frame panel draw the GENERATED factory wires into
 * `dopePanelConfig(draw=)`. LIVE pose, redrawn every frame by the host: a flurry
 * of paper pieces launch upward then tumble down under gravity with air-drag
 * flutter + spin, lit by the palette.
 */
fun drawConfettiPanel(
    canvas: Canvas,
    widthPx: Int,
    heightPx: Int,
    params: Map<String, DopeValue>,
    info: PanelFrameInfo,
) {
    if (widthPx <= 1 || heightPx <= 1) return
    val life = info.life
    if (life <= 0 || life >= 1) return // cleared frame (web early-out)

    val palette: List<RGB> = (params["palette"] as? DopeValue.Palette)?.stops ?: emptyList()

    val seedParam = params.number("pieceSeed")
    val pieceCount = params.number("pieceCount", 60.0)
    val spread = params.number("spread", 0.5)
    val launchSpeed = params.number("launchSpeed", 1.0)
    val gravity = params.number("gravity", 0.9)
    val flutter = params.number("flutter", 0.85)
    val pieceSize = params.number("pieceSize", 1.0)
    val spin = params.number("spin", 1.0)
    val style = params.number("style")

    val minDim = min(widthPx, heightPx).toDouble()
    val count = pieceCount.roundToInt().coerceIn(0, CONFETTI_MAX_PIECES)
    // The web rng seeds from ((pieceSeed * 1000) >>> 0) + 1.
    val rng = mulberry32((seedParam * 1000.0).toLong().toUInt() + 1u)

    val cx = info.centerX.toDouble()
    val cy = info.centerY.toDouble()

    val add = PorterDuffXfermode(PorterDuff.Mode.ADD)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; xfermode = add }
    val rect = RectF()

    for (i in 0 until count) {
        // Five per-piece randoms in a fixed order (≈ the GLSL hash21/hash11 draws).
        val hx = rng(); val hy = rng(); val h2x = rng(); val h2y = rng(); val h3 = rng()

        // Spawn stagger: most pieces fire in the first ~12%, renormalized to a full arc.
        val delay = h2x * 0.12
        val pl = clamp01((life - delay) / (1 - delay))
        if (pl <= 0 || pl >= 1) continue

        // Launch direction (y-up local frame): a mostly-up cone fanned by spread.
        val fan = (hx - 0.5) * 2
        val dlen = hypot(fan * (0.35 + spread), 1.0)
        val dirx = (fan * (0.35 + spread)) / dlen
        val diry = 1.0 / dlen
        val speed = (0.85 + hy * 0.6) * launchSpeed * minDim * 1.15
        val grav = (0.9 + h3 * 0.4) * gravity * minDim * 1.5

        // Ballistic arc: up, then down under gravity (y-up).
        var px = dirx * speed * pl
        val py = diry * speed * pl - grav * pl * pl

        // Air-drag flutter: a growing sideways sway as the piece slows + falls.
        val swayPhase = hx * TAU + h2y * 3.0
        val swayFreq = 3.0 + h2x * 4.0
        val fallT = smoothstep(0.12, 0.7, pl)
        val swayAmp = flutter * minDim * 0.06 * (0.4 + fallT)
        val sway =
            sin(pl * swayFreq + swayPhase) * swayAmp +
                sin(pl * swayFreq * 0.37 + swayPhase * 1.7) * swayAmp * 0.4
        px += sway

        // Spin + face-flash (wide/bright face-on, dim edge-on).
        val spinRate = (3.0 + h3 * 6.0) * spin
        val rot = pl * spinRate * TAU + swayPhase
        val flip = abs(cos(rot * 0.5 + sway * 0.02))
        val face = mix(0.18, 1.0, flip)

        // Paper shape: rectangles + a few petals, foreshortened by the face angle.
        val aspect = mix(0.5, 1.6, h2y)
        val s = minDim * 0.011 * pieceSize * (0.7 + hy * 0.7)
        val fore = mix(1.0, face, 0.65)
        val heX = (s * aspect * fore).coerceAtLeast(0.5)
        val heY = (s * fore).coerceAtLeast(0.5)
        val hue = fract(h2y * 0.9 + h3 * 0.31)
        val petal = h3 >= 0.78

        // Per-piece lit colour (paper shading ↔ flat cel), pre-multiplied by fade.
        val base = paletteMix(palette, hue)
        val shade = mix(0.45, 1.15, face)
        val spec = smoothstep(0.85, 1.0, face) * 0.5
        val celK = if (face >= 0.5) 1.0 else 0.0
        val celShade = mix(0.55, 1.1, celK)
        val fade = (1 - pl.pow(1.4)) * smoothstep(0.0, 0.08, pl)
        fun lit(c: Double): Double {
            val paper = c * shade + spec
            val cel = c * celShade
            return clamp01(mix(paper, cel, style)) * fade
        }
        val r = lit(base.r); val g = lit(base.g); val bl = lit(base.b)
        if (r + g + bl <= 0) continue

        // Place in canvas space (flip y: local y-up → canvas y-down).
        val drawX = cx + px
        val drawY = cy - py

        canvas.save()
        canvas.translate(drawX.toFloat(), drawY.toFloat())
        canvas.rotate(Math.toDegrees(rot).toFloat())
        fill.color = Color.argb(255, channel(r), channel(g), channel(bl))
        if (petal) {
            rect.set((-heX * 1.05).toFloat(), (-heY * 1.05).toFloat(), (heX * 1.05).toFloat(), (heY * 1.05).toFloat())
            canvas.drawOval(rect, fill)
        } else {
            val rad = (min(heX, heY) * 0.5).toFloat()
            rect.set((-heX).toFloat(), (-heY).toFloat(), heX.toFloat(), heY.toFloat())
            canvas.drawRoundRect(rect, rad, rad, fill)
        }
        canvas.restore()
    }
}
