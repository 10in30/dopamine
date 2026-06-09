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
// The starburst + check PATHS flip cleanly under that global flip; TEXT does not —
// glyph rasters would render upside-down — so the word block re-flips y LOCALLY
// (mirroring swift's `scaleBy(x:1, y:-1)` for the text), exactly as the README's
// panel-flip note prescribes.
//
// STATIC-SNAPSHOT SIMPLIFICATION (mirror swift): the web redraws the panel every
// frame with the live slam `scale` + `presence`; here we bake it at the
// fully-landed slam (slamScale = 1, presence = 1). The shader still animates the
// slam-in / flash / halftone via its uniforms (uPresence drives the fade), so the
// motion reads; only the panel GEOMETRY is frozen at its rest pose (which is what
// is on screen for the long proud hold anyway). dpr = 1 because the runner already
// rasterizes the panel at the device size.
//
// TYPOGRAPHY SIMPLIFICATION (mirror swift): the web resolves a mood-picked bundled
// display face (Bangers / Anton / Luckiest Guy) plus per-letter skew/stretch/tilt/
// bounce. That embedded-font pipeline does not port without bundling woff2, so the
// word is drawn with a bold SYSTEM Typeface sized to fit the burst, as a filled
// body (R) + a stroked ink contour (G). The word itself is still the SAME
// seed-picked token the effect would choose (`pickFromList(pool, seed)`), so the
// content matches the web; the checkmark sentinel "✓" is a VECTOR path.

package ai.dopamine.effect.comic

import ai.dopamine.core.DopeValue
import ai.dopamine.core.mulberry32
import ai.dopamine.core.number
import ai.dopamine.core.pickFromList
import android.graphics.Canvas
import android.graphics.Color
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

private fun channel(v: Double): Int = (255.0 * v).roundToInt().coerceIn(0, 255)

/**
 * Draw the offscreen panel for this frame: a jagged starburst balloon (B fill +
 * G outline), then the onomatopoeia word (R fill + G ink contour) or a vector
 * checkmark, baked at the fully-landed slam pose. Channel encoding:
 *   R = word fill · G = ink (contours) · B = starburst fill.
 */
fun drawComicPanel(
    canvas: Canvas,
    params: Map<String, DopeValue>,
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

    // STATIC snapshot at the fully-landed slam (swift simplification).
    val presence = 1.0
    val slamScale = 1.0f
    val dpr = 1.0f // the runner already rasterizes the panel at the device size.

    // Position + size the word/starburst to the targeted element (defaults to the
    // canvas centre + full canvas, reproducing the old screen-centred pose).
    val cx = centerX
    val cy = centerY
    // The word + starburst read at ~150% of the targeted element, clamped to the
    // canvas so a full-page fire (target == canvas) keeps its original size. Sync
    // w/ the web (COMIC_TARGET_FILL).
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
    // A classic many-pointed jagged star: alternating long/short radii with
    // per-point jitter. Filled into BLUE; its bold outline into GREEN.
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
    val fillA = channel(presence) // 0..1 channel value at full presence -> 255.

    // Burst FILL -> BLUE.
    fill.color = Color.argb(255, 0, 0, fillA)
    canvas.drawPath(burstPath, fill)

    // Burst OUTLINE -> GREEN (ink). Thick bold contour.
    stroke.strokeWidth = ink * 1.3f
    stroke.color = Color.argb(255, 0, fillA, 0)
    canvas.drawPath(burstPath, stroke)

    // ---------- WORD / CHECKMARK ---------------------------------------------
    // The seed-picked token. The web picks with the RAW fire seed
    // (`pickFromList(pool, feeling.seed)`), NOT the scatter offset; the pool is the
    // comic.dope `content.pool` mirrored above so the panel content matches the
    // effect's word.
    val word = pickFromList(WORD_POOL, rawSeed.toLong().toUInt())
    val inkColor = Color.argb(255, 0, fillA, 0)
    val fillColor = Color.argb(255, fillA, 0, 0)

    canvas.save()
    canvas.translate(cx, cy)
    if (tilt != 0f) canvas.rotate(Math.toDegrees(tilt.toDouble()).toFloat())

    if (word == "✓") {
        // ----- VECTOR CHECKMARK (web isCheckmark path) ------------------------
        val span = innerR * 1.25f
        val strokeW = span * 0.24f * 0.85f
        val checkPath = Path().apply {
            moveTo(-span * 0.42f, span * 0.02f)
            lineTo(-span * 0.12f, span * 0.34f)
            lineTo(span * 0.46f, -span * 0.36f)
        }
        // Bold ink contour, then bright fill body (both stroked) — swift order.
        // The `stroke` Paint keeps its MITER join (swift's check inherits `.miter`).
        stroke.strokeWidth = strokeW + ink * 1.2f
        stroke.color = inkColor
        canvas.drawPath(checkPath, stroke)
        stroke.strokeWidth = strokeW
        stroke.color = fillColor
        canvas.drawPath(checkPath, stroke)
        canvas.restore()
        return
    }

    // ----- WORD RUN (bold system Typeface, shrink-to-fit) ---------------------
    // A reliable bold system face stands in for the web's mood-picked bundled
    // display faces (documented simplification). Target size then shrink so longer
    // words never spill the burst.
    var fontPx = minDim * scaleParam.toFloat() * 0.92f * slamScale
    val maxW = innerR * 1.7f
    val bold = Typeface.create(Typeface.DEFAULT, Typeface.BOLD)

    val textFill = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = add
        typeface = bold
        textAlign = Paint.Align.CENTER
        style = Paint.Style.FILL
        textSize = fontPx
    }
    var measured = textFill.measureText(word)
    if (measured > maxW && measured > 0f) {
        fontPx *= maxW / measured
        textFill.textSize = fontPx
        measured = textFill.measureText(word)
    }
    val inkLine = ink * 1.3f

    val textInk = Paint(Paint.ANTI_ALIAS_FLAG).apply {
        xfermode = add
        typeface = bold
        textAlign = Paint.Align.CENTER
        style = Paint.Style.STROKE
        strokeJoin = Paint.Join.ROUND
        textSize = fontPx
        strokeWidth = inkLine
    }

    // The runner flipped the Canvas to a y-up store; glyph rasters would render
    // upside-down, so flip y back LOCALLY for the text block (swift's local
    // `scaleBy(1,-1)`) — then glyphs draw right-side-up. Vertical-centre via the
    // font metrics: the standard centred-baseline offset places the line's visual
    // middle at the local origin regardless of the flip (a centred block mirrored
    // about its own centre stays centred).
    canvas.save()
    canvas.scale(1f, -1f)
    val fm = textFill.fontMetrics
    val baselineY = -(fm.ascent + fm.descent) / 2f

    // INK contour under the fill (-> GREEN), then bright FILL body (-> RED).
    textInk.color = inkColor
    canvas.drawText(word, 0f, baselineY, textInk)
    textFill.color = fillColor
    canvas.drawText(word, 0f, baselineY, textFill)
    canvas.restore() // undo the local y-flip for the text block.

    canvas.restore()
}
