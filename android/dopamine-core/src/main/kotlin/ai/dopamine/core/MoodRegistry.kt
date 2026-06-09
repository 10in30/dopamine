// Mood registry — port of `framework/mood-registry.ts` (matching swift).
//
// A mood describes a *feeling baseline* (warmth, energy, brightness) in
// effect-neutral terms. Every effect reads the same resolved mood, so adding a
// mood lights up across ALL effects at once — no per-effect edits. The registry
// owns the shared color register + a normalized `energy`; each effect's `.dope`
// baseline table keys off the mood NAME.

package ai.dopamine.core

/** Effect-neutral description of a mood's shared color register + energy. */
data class MoodSpec(
    val hueCenter: Double,
    val hueRange: Double,
    val lightness: Double,
    val chroma: Double,
    /** Normalized energy 0..1 (serene → electric). */
    val energy: Double,
)

/** A mood resolved for use: its spec plus the name it was registered under. */
data class ResolvedMood(val name: String, val spec: MoodSpec)

/** The mood used when none is given or an unknown one is requested. */
const val DEFAULT_MOOD = "celebratory"

/** Mood registry. Process-global, like the web module-level Map. */
object MoodRegistry {
    private val builtins: Map<String, MoodSpec> = mapOf(
        "serene" to MoodSpec(hueCenter = 230.0, hueRange = 120.0, lightness = 0.83, chroma = 0.10, energy = 0.0),
        "celebratory" to MoodSpec(hueCenter = 50.0, hueRange = 320.0, lightness = 0.81, chroma = 0.17, energy = 0.5),
        "electric" to MoodSpec(hueCenter = 35.0, hueRange = 150.0, lightness = 0.79, chroma = 0.24, energy = 1.0),
    )
    private val moods = LinkedHashMap(builtins)

    /** Register (or override) a mood. Returns the name so it can be used inline. */
    fun register(name: String, spec: MoodSpec): String {
        moods[name] = spec
        return name
    }

    /** Look up a mood, falling back to the default. Always returns a usable mood. */
    fun resolve(name: String?): ResolvedMood {
        val key = if (name != null && moods.containsKey(name)) name else DEFAULT_MOOD
        return ResolvedMood(key, moods[key]!!)
    }

    fun has(name: String): Boolean = moods.containsKey(name)
    fun names(): List<String> = moods.keys.toList()
}
