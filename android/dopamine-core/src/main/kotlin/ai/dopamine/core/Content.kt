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

// ---------------------------------------------------------------------------
// TYPOGRAPHY — port of `framework/content.ts` `resolveTypography` (matching swift).
//
// The `.dope` `typography` section declares per-mood typographic baselines (the
// primary display face + skew/tilt/stretchX/tracking/roundness) and a table of
// derived numeric curve fields, each an expression over `control` (intensity /
// whimsy) + the mood `baseline` — evaluated with the SAME grammar evaluator the
// numeric params use. This reproduces the legacy `comicTypography` arithmetic
// byte-for-byte; reskinning the font/feel becomes a `.dope` edit.
// ---------------------------------------------------------------------------

/**
 * Resolve the `.dope` `typography` table for a mood + intensity + whimsy into a
 * bag fragment: `fontStack` + `face` (strings) and each numeric curve field. The
 * `baseline` context is the per-mood typographic baseline so a field expr can
 * reference e.g. `{ "baseline": "stretchX" }`. Returns an EMPTY map if the doc
 * declares no `typography` (additive; the numeric/palette path is untouched).
 */
fun resolveTypography(doc: DopeDoc, mood: String, intensity: Double, whimsy: Double): Map<String, DopeValue> {
    val typo = doc.raw["typography"] ?: return emptyMap()
    val perMood = typo["perMood"]?.asObject ?: return emptyMap()

    // Degrade an undeclared mood to the FIRST declared typography mood (matching
    // the web `typo.perMood[mood] ?? typo.perMood[Object.keys(...)[0]]`).
    val base = perMood.firstOrNull { it.first == mood }?.second ?: perMood.firstOrNull()?.second ?: return emptyMap()

    val face = base["face"]?.asString ?: ""
    val fallback = typo["fallbackStack"]?.asString ?: ""

    // Only the numeric baselines are visible to the grammar (matches the web ctx).
    val baseline = mapOf(
        "skew" to (base["skew"]?.asNumber ?: 0.0),
        "tilt" to (base["tilt"]?.asNumber ?: 0.0),
        "stretchX" to (base["stretchX"]?.asNumber ?: 0.0),
        "tracking" to (base["tracking"]?.asNumber ?: 0.0),
        "roundness" to (base["roundness"]?.asNumber ?: 0.0),
    )
    val ctx = EvalCtx(
        controls = mapOf("intensity" to clamp01(intensity), "whimsy" to clamp01(whimsy)),
        baseline = baseline,
        consts = emptyMap(),
    )

    val out = LinkedHashMap<String, DopeValue>()
    // fontStack = `<face>, <fallback>` (the web's CSS chain); `face` is the bare
    // primary family the host panels map to a bundled ttf.
    out["fontStack"] = DopeValue.Str("$face, $fallback")
    out["face"] = DopeValue.Str(face)
    typo["fields"]?.asObject?.forEach { (name, spec) ->
        val from = spec["from"] ?: return@forEach
        var v = evalExpr(decodeExpr(from), ctx)
        if (spec["round"]?.asBool == true) v = jsRound(v)
        if (spec["clamp01"]?.asBool == true) v = clamp01(v)
        out[name] = DopeValue.Number(v)
    }
    return out
}
