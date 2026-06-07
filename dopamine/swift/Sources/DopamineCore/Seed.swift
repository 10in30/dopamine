// Deterministic, seedable PRNG so a given `seed` always yields the same look.
//
// Direct port of `engine/seed.ts` (mulberry32). The web JS does all the mixing
// in 32-bit integer space (`| 0`, `>>>`, `Math.imul`) and only the final
// division produces a Double in [0, 1). We reproduce that EXACTLY using
// UInt32/Int32 wrapping arithmetic so a pinned seed gives byte-identical draws
// across web and Swift — the parity anchor the loader depends on.

import Foundation

/// A pull-once PRNG returning Double in [0, 1).
public typealias Rng = () -> Double

/// mulberry32 — tiny, fast, deterministic for a given 32-bit seed.
///
/// JS reference:
/// ```js
/// let a = seed >>> 0;
/// a |= 0; a = (a + 0x6d2b79f5) | 0;
/// let t = Math.imul(a ^ (a >>> 15), 1 | a);
/// t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
/// return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
/// ```
/// `Math.imul` is 32-bit truncating multiply; `>>>` is logical (unsigned)
/// shift; `|` / `^` / `+` are 32-bit. Swift `&+` / `&*` give the same wrapping.
public func mulberry32(_ seed: UInt32) -> Rng {
    var a: UInt32 = seed
    return {
        // a = (a + 0x6d2b79f5) | 0   — wrapping add in 32-bit space.
        a = a &+ 0x6d2b_79f5
        // t = imul(a ^ (a >>> 15), 1 | a)
        var t: UInt32 = (a ^ (a >> 15)) &* (1 | a)
        // t = (t + imul(t ^ (t >>> 7), 61 | t)) ^ t
        t = (t &+ ((t ^ (t >> 7)) &* (61 | t))) ^ t
        // ((t ^ (t >>> 14)) >>> 0) / 4294967296
        let out = t ^ (t >> 14)
        return Double(out) / 4_294_967_296.0
    }
}

/// A fresh 32-bit seed — used when the caller doesn't pin one.
public func randomSeed() -> UInt32 {
    UInt32.random(in: 0 ... UInt32.max)
}
