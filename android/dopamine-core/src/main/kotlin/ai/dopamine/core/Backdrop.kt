package ai.dopamine.core

/**
 * Backdrop colour parsing — the Android (pure-JVM) mirror of the web
 * `parseBackdrop` (packages/core/src/engine/color.ts).
 *
 * The overlay composites against a surface colour; its relative luminance drives
 * the light-out saturation/presence boost so effects stay vivid on a light
 * surface. Hosts pass a CSS colour string (`"#ffffff"`, `"rgb(20 24 37)"`); we
 * keep only the luminance (the colour itself isn't a shader input).
 */
private fun parseHex(s: String): Triple<Double, Double, Double>? {
    val m = Regex("^#([0-9a-fA-F]{3,8})$").find(s.trim()) ?: return null
    val h = m.groupValues[1]
    fun dup(c: Char) = Integer.parseInt("$c$c", 16) / 255.0
    return when (h.length) {
        3, 4 -> Triple(dup(h[0]), dup(h[1]), dup(h[2]))
        6, 8 -> Triple(
            Integer.parseInt(h.substring(0, 2), 16) / 255.0,
            Integer.parseInt(h.substring(2, 4), 16) / 255.0,
            Integer.parseInt(h.substring(4, 6), 16) / 255.0,
        )
        else -> null
    }
}

private fun parseRgbFunc(s: String): Triple<Double, Double, Double>? {
    val m = Regex("^rgba?\\(([^)]+)\\)$", RegexOption.IGNORE_CASE).find(s.trim()) ?: return null
    val parts = m.groupValues[1].split(Regex("[\\s,/]+")).filter { it.isNotEmpty() }
    if (parts.size < 3) return null
    fun chan(p: String): Double =
        if (p.endsWith("%")) clamp01(p.dropLast(1).toDouble() / 100.0)
        else clamp01(p.toDouble() / 255.0)
    return Triple(chan(parts[0]), chan(parts[1]), chan(parts[2]))
}

/**
 * Parse a CSS colour string into its Rec.709 relative luminance (0 black .. 1
 * white), or null if it can't be understood. Handles hex and `rgb()/rgba()`
 * (comma- or space-separated, incl. `%`).
 */
fun backdropLuminance(css: String): Double? {
    val rgb = parseHex(css) ?: parseRgbFunc(css) ?: return null
    return 0.2126 * rgb.first + 0.7152 * rgb.second + 0.0722 * rgb.third
}
