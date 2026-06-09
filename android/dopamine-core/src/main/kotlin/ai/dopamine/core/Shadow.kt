// Shadow-pass geometry — port of `engine/shadow.ts`.
//
// Pure math that turns amplitude, "height" above the page, and stylization into
// the offset / softness / strength of the cast soft shadow. Framework- and
// GPU-free so it is unit-testable and reusable by any effect adopting the
// multiply shadow layer. Device pixels, gl coords where Y is UP.

package ai.dopamine.core

data class ShadowGeometry(
    val offsetX: Double,
    val offsetY: Double,
    val soft: Double,
    val strength: Double,
)

data class ShadowInput(
    val minDim: Double,
    val heightFrac: Double,
    val amp: Double,
    val style: Double,
)

private fun clamp(x: Double, lo: Double, hi: Double): Double = if (x < lo) lo else if (x > hi) hi else x

fun shadowGeometry(input: ShadowInput): ShadowGeometry {
    val height = input.heightFrac * input.minDim
    val off = height * 0.16 * (0.6 + 0.5 * minOf(input.amp, 1.5))
    val soft = input.minDim * 0.014 * (1.0 - 0.6 * input.style) + input.minDim * 0.005
    val strength = clamp(0.6 * (0.8 + 0.45 * input.style), 0.0, 1.0)
    return ShadowGeometry(offsetX = off * 0.55, offsetY = -off, soft = soft, strength = strength)
}
