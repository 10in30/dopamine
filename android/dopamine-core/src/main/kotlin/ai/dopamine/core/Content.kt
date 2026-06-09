// `.dope` CONTENT consumers — port of the portable parts of `framework/content.ts`.
//
// The whimsy→band picker (Solarbloom's check-glyph bands) and the seeded list
// picker (Comic's word pool). Reproduces the legacy arithmetic EXACTLY so a
// built-in's output is byte-identical while reskinning becomes a pure `.dope` edit.

package ai.dopamine.core

import kotlin.math.floor

/** Deterministically pick one of `list` from a seed (matches Comic `pickWord`). */
fun <T> pickFromList(list: List<T>, seed: UInt): T {
    val r = mulberry32(seed)()
    val idx = minOf(list.size - 1, floor(r * list.size.toDouble()).toInt())
    return list[idx]
}

/**
 * Pick a band by whimsy (0..1), splitting the slider into equal bands. Matches
 * Solarbloom's `pickCheckGlyph`: `floor(w * n)` clamped to the last band.
 */
fun <T> pickBand(bands: List<T>, whimsy: Double): T {
    val w = if (whimsy < 0) 0.0 else if (whimsy > 1) 1.0 else whimsy
    val idx = minOf(bands.size - 1, floor(w * bands.size.toDouble()).toInt())
    return bands[idx]
}
