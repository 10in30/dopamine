// Heartburst Canvas PANEL drawing — port of `heartburst-renderer.ts`.
//
// The crisp vector hearts (the big swelling HERO heart + the flurry of little
// BURST hearts) are drawn into the offscreen panel each frame; the shader then
// adds the warm bloom / gloss / halftone / beat flash / cast light. Both the hero
// and the little hearts are the classic parametric `16 sin³t` heart curve.
//
// PANEL CHANNEL ENCODING (must match HeartburstShader exactly):
//   R = hero heart FILL · G = INK (outline) + gloss seed · B = burst hearts FILL
//
// The web uses `globalCompositeOperation = "lighter"` so the R/G/B channel masks
// accumulate INDEPENDENTLY (a red fill must not zero an overlapping blue burst).
// `PorterDuff.Mode.ADD` is the Android equivalent (swift used `.plusLighter`).
// The runner pre-flips the Canvas to a y-up store, so this draws in y-DOWN
// top-left logical coords — identical to the web Canvas2D renderer.

package ai.dopamine.effect.heartburst

import ai.dopamine.core.DopeValue
import ai.dopamine.core.mulberry32
import ai.dopamine.core.number
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Shader
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt
import kotlin.math.sin

/** Hero-heart size relative to the targeted element box (≈1.5×). Sync w/ web + swift. */
private const val HEARTBURST_TARGET_FILL: Float = 3.6f

/** Trace the parametric heart of half-size `s`, rotated by `rot`, centred at origin. */
private fun heartPath(s: Float, rot: Float): Path {
    val steps = 48
    val path = Path()
    for (i in 0..steps) {
        val t = (i.toFloat() / steps) * Math.PI.toFloat() * 2f
        val x = 16f * sin(t.toDouble()).pow(3.0).toFloat()
        val y = (13f * cos(t.toDouble()).toFloat()
            - 5f * cos(2.0 * t).toFloat()
            - 2f * cos(3.0 * t).toFloat()
            - cos(4.0 * t).toFloat())
        val nx = (x / 17f) * s
        val ny = (-y / 17f) * s // flip Y so lobes are at the top (canvas y-down)
        val cx = nx * cos(rot.toDouble()).toFloat() - ny * sin(rot.toDouble()).toFloat()
        val cy = nx * sin(rot.toDouble()).toFloat() + ny * cos(rot.toDouble()).toFloat()
        if (i == 0) path.moveTo(cx, cy) else path.lineTo(cx, cy)
    }
    path.close()
    return path
}

private fun channel(v: Double): Int = (255.0 * v).roundToInt().coerceIn(0, 255)

/**
 * Draw the offscreen panel for this frame: the hero heart (fill→R, outline+gloss→G)
 * at the current beat scale, and the little burst hearts (fill→B) flying outward.
 */
fun drawHeartburstPanel(
    canvas: Canvas,
    params: Map<String, DopeValue>,
    heartScaleMul: Double,
    life: Double,
    presence: Double,
    density: Float,
    centerX: Float,
    centerY: Float,
    span: Float,
    canvasW: Int,
    canvasH: Int,
) {
    if (presence <= 0.001) return

    val seedParam = params.number("heartburstSeed")
    val heartScale = params.number("heartScale", 0.22)
    val burstCount = params.number("burstCount", 14.0)
    val burstSpread = params.number("burstSpread", 0.4)
    val inkWeight = params.number("inkWeight", 3.0)

    // Size the hearts to the targeted element box (clamped to the canvas so a
    // full-page fire keeps its original size). Sync w/ web + swift.
    val minDim = min(span * HEARTBURST_TARGET_FILL, min(canvasW, canvasH).toFloat())
    // The web rng seeds from (heartburstSeed * 1000) >>> 0.
    val rng = mulberry32((seedParam * 1000.0).toLong().toUInt())

    val ink = max(1f, inkWeight.toFloat() * density)

    val add = PorterDuffXfermode(PorterDuff.Mode.ADD)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; xfermode = add }
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeJoin = Paint.Join.ROUND; xfermode = add
    }

    // ---------- HERO HEART (R fill, G outline + gloss seed) ------------------
    val heroS = (minDim * heartScale.toFloat() * heartScaleMul.toFloat())
    val tilt = ((seedParam % 1.0) - 0.5).toFloat() * 0.12f
    // As the burst takes over, the hero shrinks/cracks a touch (web heroPresence).
    val b = burstProgress(life)
    val heroPresence = presence * (1 - 0.65 * b)

    canvas.save()
    canvas.translate(centerX, centerY)
    if (heroPresence > 0.002) {
        val heroFillA = channel(heroPresence)
        // FILL -> RED.
        fill.color = Color.argb(255, heroFillA, 0, 0)
        canvas.drawPath(heartPath(heroS, tilt), fill)
        // OUTLINE -> GREEN.
        stroke.strokeWidth = ink * 1.6f
        stroke.color = Color.argb(255, 0, heroFillA, 0)
        canvas.drawPath(heartPath(heroS, tilt), stroke)
        // GLOSS SEED -> GREEN, clipped to the heart (upper-left lobe). The shader
        // reads ink∩fill as the specular highlight.
        canvas.save()
        canvas.clipPath(heartPath(heroS, tilt))
        val gx = -heroS * 0.34f
        val gy = -heroS * 0.42f
        val gr = heroS * 0.42f
        val gloss = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            xfermode = add
            shader = RadialGradient(
                gx, gy, max(1f, gr),
                Color.argb(255, 0, heroFillA, 0), Color.argb(0, 0, 0, 0),
                Shader.TileMode.CLAMP,
            )
        }
        canvas.drawCircle(gx, gy, gr, gloss)
        canvas.restore()
    }
    canvas.restore()

    // ---------- BURST HEARTS (B fill) ----------------------------------------
    if (b > 0.001) {
        val count = max(0, burstCount.roundToInt())
        val maxDist = minDim * burstSpread.toFloat()
        for (i in 0 until count) {
            // deterministic per-heart launch params (web rng pull order MUST match).
            val ang = (i.toFloat() / max(1, count)) * Math.PI.toFloat() * 2f + (rng() - 0.5).toFloat() * 0.9f
            val speed = 0.55f + rng().toFloat() * 0.45f
            val spin = (rng() - 0.5).toFloat() * 2.0f
            val littleS = minDim * (0.035f + rng().toFloat() * 0.04f) * heartScale.toFloat() * 1.6f
            val stagger = rng().toFloat() * 0.25f
            val lp = max(0f, min(1f, (b.toFloat() - stagger) / (1f - stagger)))
            if (lp <= 0f) continue
            val dist = maxDist * speed * lp
            val arc = minDim * 0.10f * speed * (lp - lp * lp) * 4.0f
            val px = centerX + cos(ang.toDouble()).toFloat() * dist
            val py = centerY + sin(ang.toDouble()).toFloat() * dist - arc
            val fade = 1f - lp.toDouble().pow(2.2).toFloat()
            if (fade <= 0.01f) continue
            val a = channel(presence * fade)
            val s = littleS * (0.6f + 0.4f * (1f - lp))
            canvas.save()
            canvas.translate(px, py)
            fill.color = Color.argb(255, 0, 0, a)
            canvas.drawPath(heartPath(s, spin * lp * Math.PI.toFloat()), fill)
            canvas.restore()
        }
    }
}
