// Algorithmic color in OKLCH — direct port of `engine/color.ts` (matching swift).
//
// OKLCH is perceptually uniform, so walking hue by the golden angle (137.5°)
// yields harmonious-but-never-repeating palettes. We hand the shader *linear*
// sRGB (light sums in linear space). The math (Björn Ottosson's OKLab matrices,
// the golden-angle palette builder, the gamut clamp) is reproduced constant-for-
// constant so a pinned seed matches the web byte-for-byte.

package ai.dopamine.core

import kotlin.math.cos
import kotlin.math.sin

/** Linear sRGB, nominally 0..1 (may exceed before clamping). */
data class RGB(val r: Double, val g: Double, val b: Double)

/** OKLCH: perceptual lightness L (0..1), chroma C (~0..0.4), hue h (degrees). */
data class OKLCH(val L: Double, val C: Double, val h: Double)

const val GOLDEN_ANGLE_DEG: Double = 137.50776405003785

internal fun clamp01(x: Double): Double = if (x < 0) 0.0 else if (x > 1) 1.0 else x

/** Positive modulo into [0, 360). */
fun wrapHue(h: Double): Double = ((h % 360.0) + 360.0) % 360.0

/** OKLCH → linear sRGB (OKLab matrices). Gamut-clamped to [0, 1] per channel. */
fun oklchToLinearSrgb(c: OKLCH): RGB {
    val hr = c.h * Math.PI / 180.0
    val a = c.C * cos(hr)
    val b = c.C * sin(hr)

    val l_ = c.L + 0.3963377774 * a + 0.2158037573 * b
    val m_ = c.L - 0.1055613458 * a - 0.0638541728 * b
    val s_ = c.L - 0.0894841775 * a - 1.291485548 * b

    val l = l_ * l_ * l_
    val m = m_ * m_ * m_
    val s = s_ * s_ * s_

    return RGB(
        r = clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        g = clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        b = clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    )
}

/** Parameters for the 3-stop golden-angle palette. */
data class PaletteParams(
    val lightness: Double,
    val chroma: Double,
    val hueCenter: Double,
    val hueRange: Double,
    /** 0..1 — how far the golden-angle stops fan out from the base hue. */
    val hueSpread: Double,
)

/**
 * Build a 3-stop linear-RGB palette. The base hue is drawn from `rng` FIRST (the
 * parity anchor — exactly one pull here), biased toward the mood's range;
 * successive stops step by the golden angle scaled by hueSpread.
 */
fun buildPalette(rng: Rng, p: PaletteParams): List<RGB> {
    val baseHue = wrapHue(p.hueCenter + (rng() - 0.5) * p.hueRange)
    val step = GOLDEN_ANGLE_DEG * (0.35 + 0.65 * p.hueSpread)
    val lightSteps = doubleArrayOf(0.0, 0.06, -0.05)
    val chromaSteps = doubleArrayOf(0.0, 0.02, -0.01)

    return (0..2).map { i ->
        oklchToLinearSrgb(
            OKLCH(
                L = clamp01(p.lightness + lightSteps[i]),
                C = maxOf(0.0, p.chroma + chromaSteps[i]),
                h = wrapHue(baseHue + step * i.toDouble()),
            ),
        )
    }
}
