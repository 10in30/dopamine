// Effect registry — port of `framework/registry.ts` (matching swift).
//
// Effects self-register on load. The public play/element surfaces route through
// here. An `EffectFactory` here is the minimal PORTABLE protocol the runtime
// needs: a name + a way to resolve a feeling into the flat param bag. The
// drawable `create()` lives in the Android GL module (`dopamine-gl`), so the
// portable registry stays free of any GPU/Android type — exactly the swift split
// where `create()` sits behind `#if canImport(Metal)`.

package ai.dopamine.core

/**
 * The minimal portable effect contract: a name + a resolver from a feeling to the
 * flat `.dope` param bag. (The Android GL-backed `create()` is added by the
 * `dopamine-gl` module via a `DrawableEffect` sub-interface.)
 */
interface EffectFactory {
    val name: String
    fun resolve(feeling: DopeResolveInput): Map<String, DopeValue>
}

/** Process-global effect registry (mirrors the web module-level Map). */
object EffectRegistry {
    private val effects = LinkedHashMap<String, EffectFactory>()

    fun register(factory: EffectFactory): EffectFactory {
        effects[factory.name] = factory
        return factory
    }

    fun get(name: String): EffectFactory? = effects[name]
    fun has(name: String): Boolean = effects.containsKey(name)
    fun names(): List<String> = effects.keys.toList()
}
