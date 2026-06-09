// Deterministic, seedable PRNG so a given `seed` always yields the same look.
//
// Direct port of `engine/seed.ts` (mulberry32), matching the swift port. The web
// JS does all the mixing in 32-bit integer space (`| 0`, `>>>`, `Math.imul`) and
// only the final division produces a Double in [0, 1). Kotlin's `UInt` is modular
// 32-bit arithmetic with a LOGICAL (unsigned) `shr`, so it reproduces the JS
// mixing EXACTLY — the parity anchor the loader depends on.

package ai.dopamine.core

/** A pull-once PRNG returning Double in [0, 1). */
typealias Rng = () -> Double

/**
 * mulberry32 — tiny, fast, deterministic for a given 32-bit seed.
 *
 * JS reference:
 * ```js
 * let a = seed >>> 0;
 * a |= 0; a = (a + 0x6d2b79f5) | 0;
 * let t = Math.imul(a ^ (a >>> 15), 1 | a);
 * t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
 * return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
 * ```
 * `Math.imul` is 32-bit truncating multiply; `>>>` is logical shift. Kotlin `UInt`
 * `+`/`*` wrap mod 2^32 and `shr` is unsigned — identical results.
 */
fun mulberry32(seed: UInt): Rng {
    var a: UInt = seed
    return {
        // a = (a + 0x6d2b79f5) | 0   — wrapping add in 32-bit space.
        a += 0x6d2b79f5u
        // t = imul(a ^ (a >>> 15), 1 | a)
        var t: UInt = (a xor (a shr 15)) * (1u or a)
        // t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t
        t = (t + ((t xor (t shr 7)) * (61u or t))) xor t
        // ((t ^ (t >>> 14)) >>> 0) / 4294967296
        (t xor (t shr 14)).toDouble() / 4_294_967_296.0
    }
}

/** A fresh 32-bit seed — used when the caller doesn't pin one. */
fun randomSeed(): UInt = (Math.random() * 4_294_967_295.0).toLong().toUInt()
