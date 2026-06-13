// Solarbloom drifting-motes SPRITE PANEL — the PANEL-DRAW SEAM, ported to
// `android.graphics` (a faithful port of the web `solarbloom-renderer.ts` / the
// Swift `SolarbloomPanel.swift`). This is the ONLY hand-written Kotlin the
// effect ships; the registration shim (`Solarbloom.kt`) and the GLSL
// (`SolarbloomShader.kt`) are GENERATED from solarbloom.dope.json + the
// canonical web GLSL, and the generated factory wires `drawSolarbloomPanel` into
// `dopePassConfig(draw=)` (the PASS runner's sprite-panel seam).
//
// PASS HYBRID (not a panel-KIND effect): the volumetric bloom + the checkmark
// stay PROCEDURAL in the shader; only the sparse drifting light "motes" are a
// sprite layer — rasterized into an offscreen panel ONCE per frame (pose + lit
// colour + streak + twinkle computed here) and sampled by the shader
// (`uMotePanel`, bound at texture(3) — texture(1) stays the baked-✓ SDF slot).
//
// PANEL CHANNEL ENCODING (must match SolarbloomShader.kt exactly):
//   RGB = Σ(per-mote lit colour × sprite falloff × fade × twinkle), accumulated
//   ADDITIVELY (the shader multiplies by the bloom gain). The web draws with
//   `globalCompositeOperation = "lighter"`; `PorterDuff.Mode.ADD` is the Android
//   equivalent (Swift used `.plusLighter`).
//
// COORDINATE FLIP: `GlPassRunner` pre-flips the Canvas to a y-up store (the web's
// UNPACK_FLIP_Y), so this draws in y-DOWN top-left logical coords (web-identical).

package ai.dopamine.effect.solarbloom

import ai.dopamine.core.DopeValue
import ai.dopamine.core.RGB
import ai.dopamine.core.mulberry32
import ai.dopamine.core.number
import ai.dopamine.gl.PanelFrameInfo
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.RadialGradient
import android.graphics.Shader
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.round
import kotlin.math.sin

private const val TAU = Math.PI * 2

private fun clamp01(x: Double): Double = if (x < 0) 0.0 else if (x > 1) 1.0 else x
private fun mix(a: Double, b: Double, t: Double): Double = a + (b - a) * t
private fun smoothstep01(e0: Double, e1: Double, x: Double): Double {
    val t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
}

/** `paletteMix(t)` over the three RGB stops — the exact web renderer mix. */
private fun paletteMix(pal: List<RGB>, tIn: Double): RGB {
    val t = clamp01(tIn)
    if (pal.size < 3) return pal.firstOrNull() ?: RGB(1.0, 1.0, 1.0)
    val c0 = pal[0]; val c1 = pal[1]; val c2 = pal[2]
    if (t < 0.5) {
        val k = t * 2
        return RGB(mix(c0.r, c1.r, k), mix(c0.g, c1.g, k), mix(c0.b, c1.b, k))
    }
    val k = (t - 0.5) * 2
    return RGB(mix(c1.r, c2.r, k), mix(c1.g, c2.g, k), mix(c1.b, c2.b, k))
}

private fun ch(v: Double): Int = (clamp01(v) * 255.0).roundToIntCompat()
private fun Double.roundToIntCompat(): Int = round(this).toInt()

/**
 * The per-frame sprite-panel draw the GENERATED factory wires into
 * `dopePassConfig(draw=)`. LIVE pose, redrawn every frame by `GlPassRunner`
 * (mirrors the web panel runner): each mote drifts outward + floats up + curls,
 * depth-layered, with a velocity-aligned motion-blur streak and a per-mote
 * twinkle that needs the seconds clock (`info.elapsedMs / 1000`).
 */
fun drawSolarbloomPanel(
    canvas: Canvas,
    widthPx: Int,
    heightPx: Int,
    params: Map<String, DopeValue>,
    info: PanelFrameInfo,
) {
    val w = widthPx.toDouble()
    val h = heightPx.toDouble()
    if (w <= 1 || h <= 1) return

    val palette: List<RGB> = (params["palette"] as? DopeValue.Palette)?.stops ?: emptyList()
    val bloomRadius = params.number("bloomRadius", 0.7)
    val turbulence = params.number("turbulence", 0.6)
    val moteSpeed = params.number("moteSpeed", 0.85)
    val moteCount = params.number("moteCount", 48.0)
    val moteSeed = params.number("moteSeed", 0.0)

    val life = info.life
    val timeS = info.elapsedMs / 1000.0

    val minDim = min(w, h)
    val r = bloomRadius * minDim
    val count = maxOf(0, round(moteCount).toInt())
    // The web rng seeds from ((moteSeed * 1000) >>> 0) + 7 — match it byte-for-byte.
    val rng = mulberry32((moteSeed * 1000.0).toLong().toUInt() + 7u)

    val cx = info.centerX.toDouble()
    val cy = info.centerY.toDouble()

    val add = PorterDuffXfermode(PorterDuff.Mode.ADD)
    val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply { xfermode = add }

    for (i in 0 until count) {
        val hx = rng(); val hy = rng(); val h2x = rng(); val h2y = rng(); val delayR = rng()
        val a0 = hx * TAU
        val spd = 0.5 + hy
        val delay = delayR * 0.15
        val ml = clamp01((life - delay) / (1 - delay))
        if (ml <= 0) continue

        val near = if (h2x >= 0.66) 1.0 else 0.0
        val depth = mix(0.7, 1.4, near)
        val dirx = cos(a0); val diry = sin(a0)
        val travel = ml * spd * moteSpeed * r * 1.3 * depth
        // y-up local frame (buoyancy floats upward = +y).
        var px = dirx * travel
        var py = diry * travel + ml * ml * r * 0.5
        val t1 = a0 * 3.0 + ml * TAU * spd
        px += sin(t1) * turbulence * r * 0.3 * ml
        py += cos(t1 * 0.8 + a0) * turbulence * r * 0.3 * ml

        // Velocity → motion-blur streak direction + amount (matches the shader).
        val velx = dirx * spd * moteSpeed * 1.3 * depth + cos(t1) * turbulence * 0.3
        val vely = diry * spd * moteSpeed * 1.3 * depth + 2.0 * ml * 0.5 - sin(t1 * 0.8 + a0) * turbulence * 0.3
        val vlen = maxOf(1e-4, hypot(velx, vely))
        val streak = clamp01(vlen * 0.12) * smoothstep01(0.0, 0.25, ml) * 0.65

        val size = minDim * 0.006 * (0.6 + hx * 0.8) * depth
        val twinkle = 0.75 + 0.25 * sin(timeS * (6.0 + h2y * 10.0) + hx * TAU)
        val fade = (1 - ml.pow(1.3)) * smoothstep01(0.0, 0.08, ml)
        val amp = fade * twinkle * 1.2 * mix(0.9, 1.3, near)
        if (amp <= 0.001) continue
        val base = paletteMix(palette, hy)
        val cr = ch(base.r * amp); val cg = ch(base.g * amp); val cb = ch(base.b * amp)
        if (cr + cg + cb <= 0) continue

        // Canvas position (flip y-up → y-down).
        val pcx = cx + px
        val pcy = cy - py
        val ang = atan2(vely, velx)
        val stretch = 1 / (1 - streak)
        val rad = maxOf(size * 3, 1.5)

        // 3-stop radial sprite: solid core → 35% mid → transparent rim (the web's
        // createRadialGradient). RadialGradient is centred at origin; we translate
        // + rotate + stretch the canvas to mimic the motion-blur streak.
        val solid = (0xFF shl 24) or (cr shl 16) or (cg shl 8) or cb
        val midA = (0.35 * 255).toInt()
        val mid = (midA shl 24) or (cr shl 16) or (cg shl 8) or cb
        val clear = (cr shl 16) or (cg shl 8) or cb // alpha 0
        canvas.save()
        canvas.translate(pcx.toFloat(), pcy.toFloat())
        canvas.rotate(Math.toDegrees(ang).toFloat())
        canvas.scale(stretch.toFloat(), 1f)
        paint.shader = RadialGradient(
            0f, 0f, rad.toFloat(),
            intArrayOf(solid, mid, clear),
            floatArrayOf(0f, 0.4f, 1f),
            Shader.TileMode.CLAMP,
        )
        canvas.drawCircle(0f, 0f, rad.toFloat(), paint)
        paint.shader = null
        canvas.restore()
    }
}
