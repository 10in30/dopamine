// Comic Impact Canvas PANEL drawing — port of swift's `ComicPanel.swift` (itself a
// faithful port of the web `comic-renderer.ts`), to `android.graphics`.
//
// HYBRID effect: the crisp vector forms (the jagged starburst balloon, the blocky
// onomatopoeia word, the bold ink contours) are NOT procedural in the shader — the
// web draws them into an offscreen Canvas2D ("panel") and the fragment shader
// (ComicShader.kt) samples that texture and adds the Ben-Day halftone / action
// lines / flash / pop-art look on top. The shared `GlPanelRunner` owns the panel
// Bitmap + per-frame upload + light pass; this file supplies ONLY the per-effect
// draw.
//
// PANEL CHANNEL ENCODING (must match ComicShader.kt exactly):
//   R = word FILL mask · G = INK mask (all black contours) · B = burst FILL mask.
// The web draws every layer with `globalCompositeOperation = "lighter"` (additive)
// so the R/G/B channel masks accumulate INDEPENDENTLY — a red word fill must not
// zero the blue burst it overlaps. `PorterDuff.Mode.ADD` is the Android equivalent
// (swift used `.plusLighter`); set on every Paint.
//
// COORDINATE FLIP: `GlPanelRunner` pre-flips the Canvas to a y-up store (the web's
// UNPACK_FLIP_Y), so this draws in y-DOWN top-left logical coords (web-identical).
// The starburst + check PATHS flip cleanly under that global flip; TEXT also draws
// upright because `Canvas.drawText` honors the canvas matrix (unlike swift/CoreText
// glyph rasters, which needed a manual counter-flip).
//
// ANIMATED (leveled up to web parity): the panel is redrawn EVERY frame with the
// LIVE slam scale + presence — `GlPanelRunner` passes `info.elapsedMs` + `.life`
// per frame — so the word slams in / recoils / fades exactly like the web. dpr = 1
// because the runner already rasterizes at the device size.
//
// TYPOGRAPHY (leveled up to web parity): the mood-picked bundled display face
// (Bangers / Anton / Luckiest Guy) is loaded from `assets/fonts/` (ttf converted
// from the shared woff2 by the toolchain) and laid out per-letter with the full
// skew / stretch / tilt / per-letter rotation + baseline jitter / 3D extrude /
// stacked outline / inkRoundness treatment, from the typography fields the loader
// composes into the resolved bag. Falls back to a bold system face if unavailable.

package ai.dopamine.effect.comic

import ai.dopamine.core.DopeValue
import ai.dopamine.core.mulberry32
import ai.dopamine.core.number
import ai.dopamine.core.pickFromList
import ai.dopamine.core.string
import android.content.res.AssetManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PorterDuff
import android.graphics.PorterDuffXfermode
import android.graphics.Typeface
import kotlin.math.cos
import kotlin.math.max
import kotlin.math.min
import kotlin.math.roundToInt
import kotlin.math.sin

/** How big the starburst + word read relative to the targeted element box (the
 * burst diameter ≈ 0.88·basis, so a comic ≈ 1.5× the element). Sync w/ web + swift. */
private const val COMIC_TARGET_FILL: Float = 1.7f

/** The per-fire SLAMMED token pool — the comic.dope `content.pool` (the seven
 * affirmations + the checkmark sentinel, equal odds). Kept in sync with the
 * `.dope`; reskinning the word list is a `.dope` edit on the `Comic` factory (this
 * static mirror only feeds the host-side panel draw — same as swift). */
private val WORD_POOL: List<String> =
    listOf("YES!", "DONE!", "NICE!", "OKAY!", "WIN!", "GREAT!", "WOO!", "✓")

/** Bundled display faces, mapped family → ttf basename in `assets/fonts/`. The
 * `.dope` per-mood `face` is a CSS family (quoted); the quotes are stripped to look
 * it up. Kept in sync with `effects/comic/fonts` + the toolchain. */
private val COMIC_FONT_FILES: Map<String, String> = mapOf(
    "Bangers" to "Bangers-Regular",
    "Anton" to "Anton-Regular",
    "Luckiest Guy" to "LuckiestGuy-Regular",
)

/** Loaded-Typeface cache (keyed by ttf basename) so each face is decoded once. */
private val typefaceCache = HashMap<String, Typeface?>()

private fun loadFace(assets: AssetManager, face: String): Typeface {
    val family = face.trim('"')
    val file = COMIC_FONT_FILES[family]
    if (file != null) {
        val tf = typefaceCache.getOrPut(file) {
            runCatching { Typeface.createFromAsset(assets, "fonts/$file.ttf") }.getOrNull()
        }
        if (tf != null) return tf
    }
    // Robust fallback so the word still reads if the bundled face is unavailable.
    return Typeface.create(Typeface.DEFAULT, Typeface.BOLD)
}

private fun channel(v: Double): Int = (255.0 * v).roundToInt().coerceIn(0, 255)

/**
 * Draw the offscreen panel for this frame: a jagged starburst balloon (B fill +
 * G outline), then the onomatopoeia word (R fill + G ink contour, full per-letter
 * typography in the mood face) or a vector checkmark, at the LIVE slam pose.
 * Channel encoding: R = word fill · G = ink (contours) · B = starburst fill.
 */
fun drawComicPanel(
    canvas: Canvas,
    assets: AssetManager,
    params: Map<String, DopeValue>,
    elapsedMs: Double,
    life: Double,
    centerX: Float,
    centerY: Float,
    targetWidthPx: Float,
    targetHeightPx: Float,
    canvasW: Int,
    canvasH: Int,
) {
    if (canvasW <= 1 || canvasH <= 1) return

    // Resolved-bag scalars (defaults mirror comic.dope authored ranges + swift).
    val comicSeed = params.number("comicSeed", 0.0) // the per-fire scatter offset
    val rawSeed = params.number("seed", 0.0)        // the raw fire seed (word pick uses this)
    val scaleParam = params.number("scale", 0.34)
    val burstPoints = params.number("burstPoints", 14.0)
    val inkWeight = params.number("inkWeight", 3.0)
    val overshoot = params.number("overshoot", 1.0)

    // LIVE slam: presence over life, scale over elapsedMs (web parity).
    val presence = impactPresence(life)
    if (presence <= 0.001) return
    val slamScale = impactScale(elapsedMs, overshoot).toFloat()
    val dpr = 1.0f // the runner already rasterizes the panel at the device size.

    // Position + size the word/starburst to the targeted element (defaults to the
    // canvas centre + full canvas, reproducing the old screen-centred pose).
    val cx = centerX
    val cy = centerY
    val minDim = min(min(targetWidthPx, targetHeightPx) * COMIC_TARGET_FILL, min(canvasW, canvasH).toFloat())
    // The web rng seeds the burst jitter from (comicSeed * 1000) >>> 0.
    val rng = mulberry32((comicSeed * 1000.0).toLong().toUInt())

    // Per-fire tilt, hand-placed feel (~±5deg) — web `(comicSeed % 1 - 0.5)*0.18`.
    val tilt = ((comicSeed % 1.0) - 0.5).toFloat() * 0.18f

    // The web draws every layer additively ("lighter"); ADD is the Android analog.
    val add = PorterDuffXfermode(PorterDuff.Mode.ADD)
    val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.FILL; xfermode = add }
    val stroke = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        style = Paint.Style.STROKE; strokeJoin = Paint.Join.MITER; strokeMiter = 2f; xfermode = add
    }

    // ---------- STARBURST BALLOON (B fill + G outline) -----------------------
    val points = max(8, burstPoints.roundToInt())
    val outerR = minDim * scaleParam.toFloat() * 1.3f * slamScale
    val innerR = outerR * 0.64f
    val burstPath = Path()
    for (i in 0 until points * 2) {
        val t = i.toFloat() / (points * 2).toFloat()
        val a = t * Math.PI.toFloat() * 2f - Math.PI.toFloat() / 2f + tilt
        val even = (i % 2 == 0)
        val jitter = 0.82f + rng().toFloat() * 0.36f
        val r = (if (even) outerR else innerR) * jitter
        val x = cx + cos(a.toDouble()).toFloat() * r
        val y = cy + sin(a.toDouble()).toFloat() * r
        if (i == 0) burstPath.moveTo(x, y) else burstPath.lineTo(x, y)
    }
    burstPath.close()

    val ink = inkWeight.toFloat() * dpr * slamScale
    val fillA = channel(presence) // presence-scaled channel value (web `255*presence`).

    // Burst FILL -> BLUE.
    fill.color = Color.argb(255, 0, 0, fillA)
    canvas.drawPath(burstPath, fill)

    // Burst OUTLINE -> GREEN (ink). Thick bold contour.
    stroke.strokeWidth = ink * 1.3f
    stroke.color = Color.argb(255, 0, fillA, 0)
    canvas.drawPath(burstPath, stroke)

    // ---------- WORD / CHECKMARK ---------------------------------------------
    // The seed-picked token (raw fire seed, like the web `pickFromList(pool, seed)`).
    val word = pickFromList(WORD_POOL, rawSeed.toLong().toUInt())
    val inkColor = Color.argb(255, 0, fillA, 0)
    val fillColor = Color.argb(255, fillA, 0, 0)

    // Typography knobs (composed into the bag by the loader; web parity defaults).
    val fontSkew = params.number("fontSkew", 0.0).toFloat()
    val fontTilt = params.number("fontTilt", 0.0).toFloat()
    val fontStretchX = params.number("fontStretchX", 1.0).toFloat()
    val fontTracking = params.number("fontTracking", 0.0).toFloat()
    val outlineLayers = max(1, params.number("outlineLayers", 1.0).roundToInt())
    val extrudeDepth = params.number("extrudeDepth", 0.0).toFloat()
    val letterRotJitter = params.number("letterRotJitter", 0.0)
    val letterBaselineJitter = params.number("letterBaselineJitter", 0.0)
    val round = params.number("inkRoundness", 0.0)

    canvas.save()
    canvas.translate(cx, cy)
    canvas.rotate(Math.toDegrees((tilt + fontTilt).toDouble()).toFloat())
    // Italic lean + non-uniform stretch as a shared transform on the whole word:
    // web matrix [a=stretchX, b=0, c=skew, d=1] → Android 3x3 with MSCALE_X=stretchX,
    // MSKEW_X=skew, MSCALE_Y=1 (x' = stretchX·x + skew·y, y' = y).
    canvas.concat(
        Matrix().apply {
            setValues(floatArrayOf(fontStretchX, fontSkew, 0f, 0f, 1f, 0f, 0f, 0f, 1f))
        },
    )
    val joinRound = round > 0.5

    if (word == "✓") {
        // ----- VECTOR CHECKMARK (web isCheckmark path) ------------------------
        val span = innerR * 1.25f
        val strokeW = span * 0.24f * (0.85f + round.toFloat() * 0.25f)
        val extrude = span * extrudeDepth
        fun checkPath(): Path = Path().apply {
            moveTo(-span * 0.42f, span * 0.02f)
            lineTo(-span * 0.12f, span * 0.34f)
            lineTo(span * 0.46f, -span * 0.36f)
        }
        stroke.strokeJoin = if (joinRound) Paint.Join.ROUND else Paint.Join.MITER
        stroke.strokeCap = if (joinRound) Paint.Cap.ROUND else Paint.Cap.BUTT
        // 3D extrude: stacked ink copies stepping down-right (pop-art only).
        if (extrude > 0.5f) {
            for (s in 8 downTo 1) {
                val d = extrude * s / 8f
                canvas.save()
                canvas.translate(d, d)
                stroke.strokeWidth = strokeW
                stroke.color = inkColor
                canvas.drawPath(checkPath(), stroke)
                canvas.restore()
            }
        }
        // Bold ink contour (heavier toward pop-art via outlineLayers).
        stroke.strokeWidth = strokeW + ink * (1.2f + outlineLayers * 0.5f)
        stroke.color = inkColor
        canvas.drawPath(checkPath(), stroke)
        // Bright fill body.
        stroke.strokeWidth = strokeW
        stroke.color = fillColor
        canvas.drawPath(checkPath(), stroke)
        canvas.restore()
        return
    }

    // ----- WORD RUN (mood face, full per-letter typography) -------------------
    val typeface = loadFace(assets, params.string("face", ""))
    val chars = word.map { it.toString() }

    // Target size, then SHRINK-TO-FIT so longer words never spill the burst.
    var fontPx = minDim * scaleParam.toFloat() * 0.92f * slamScale
    if (fontPx < 1f) { canvas.restore(); return }

    val measurePaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        this.typeface = typeface
        textAlign = Paint.Align.CENTER
        textSize = fontPx
    }
    fun trackPx(px: Float): Float = px * fontTracking
    fun runWidth(px: Float): Float {
        measurePaint.textSize = px
        var total = 0f
        for (ch in chars) total += measurePaint.measureText(ch) + trackPx(px)
        return max(1f, total - trackPx(px))
    }
    val maxW = (innerR * 1.7f) / max(0.6f, fontStretchX)
    var measured = runWidth(fontPx)
    if (measured > maxW) {
        fontPx *= maxW / measured
        measured = runWidth(fontPx)
    }

    val extrude = fontPx * extrudeDepth
    val inkLine = ink * (1.3f + (outlineLayers - 1) * 0.7f)

    val textFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = add; this.typeface = typeface; textAlign = Paint.Align.CENTER
        style = Paint.Style.FILL; textSize = fontPx
    }
    val textInk = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = add; this.typeface = typeface; textAlign = Paint.Align.CENTER
        style = Paint.Style.STROKE
        strokeJoin = if (joinRound) Paint.Join.ROUND else Paint.Join.MITER
        strokeCap = if (joinRound) Paint.Cap.ROUND else Paint.Cap.BUTT
        strokeMiter = 2f; textSize = fontPx
    }
    // Vertical "middle" baseline (Canvas2D textBaseline = "middle"): centre the line
    // on the origin via the standard centred-baseline metric offset.
    val fm = textFill.fontMetrics
    val baselineY = -(fm.ascent + fm.descent) / 2f

    // Per-letter / per-shape deterministic jitter (web `mulberry32((comicSeed *
    // 2654435761) >>> 0)`).
    val jrng = mulberry32((comicSeed * 2654435761.0).toLong().toUInt())

    // Lay out letters individually so we can apply per-letter rotation/baseline
    // jitter (the pop-art bounce). Start at the left edge of the centred run.
    class Letter(val ch: String, val x: Float, val rot: Float, val dy: Float)
    var penX = -measured / 2f
    val letters = ArrayList<Letter>(chars.size)
    for (ch in chars) {
        val wpx = textFill.measureText(ch)
        val x = penX + wpx / 2f
        penX += wpx + trackPx(fontPx)
        val rot = ((jrng() - 0.5) * 2 * letterRotJitter).toFloat()
        val dy = ((jrng() - 0.5) * 2 * letterBaselineJitter).toFloat() * fontPx
        jrng() // web draws a third rng() per letter (`wgt`); keep the stream aligned.
        letters.add(Letter(ch, x, rot, dy))
    }

    // Draw one letter centred at its origin, offset by (dx,dy), with `paint`. The
    // per-letter translate/rotate is the canvas matrix; drawText is CENTER-aligned
    // so the glyph centres on x=0, and baselineY puts its visual middle on y=0.
    fun drawLetter(l: Letter, dx: Float, dy: Float, paint: Paint) {
        canvas.save()
        canvas.translate(l.x, l.dy)
        canvas.rotate(Math.toDegrees(l.rot.toDouble()).toFloat())
        canvas.drawText(l.ch, dx, baselineY + dy, paint)
        canvas.restore()
    }

    // 3D extrude / drop: stacked ink copies stepping down-right (pop-art pops).
    if (extrude > 0.5f) {
        textFill.color = inkColor
        for (s in 8 downTo 1) {
            val d = extrude * s / 8f
            for (l in letters) drawLetter(l, d, d, textFill)
        }
    }

    // Bold INK contour under the fill — outlineLayers stacks fattening passes.
    textInk.color = inkColor
    for (layer in outlineLayers downTo 1) {
        textInk.strokeWidth = inkLine * (1f + (layer - 1) * 0.5f)
        for (l in letters) drawLetter(l, 0f, 0f, textInk)
    }

    // Bright FILL body on top.
    textFill.color = fillColor
    for (l in letters) drawLetter(l, 0f, 0f, textFill)

    canvas.restore()
}
