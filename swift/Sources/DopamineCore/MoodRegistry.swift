// Mood registry — port of `framework/mood-registry.ts`.
//
// A mood describes a *feeling baseline* (warmth, energy, brightness) in
// effect-neutral terms. Every effect reads the same resolved mood, so adding a
// mood lights up across ALL effects at once — no per-effect edits. The registry
// owns the shared color register + a normalized `energy`; each effect's `.dope`
// baseline table keys off the mood NAME.

import Foundation

/// Effect-neutral description of a mood's shared color register + energy.
public struct MoodSpec: Equatable {
    public var hueCenter: Double
    public var hueRange: Double
    public var lightness: Double
    public var chroma: Double
    /// Normalized energy 0..1 (serene → electric).
    public var energy: Double
    public init(hueCenter: Double, hueRange: Double, lightness: Double, chroma: Double, energy: Double) {
        self.hueCenter = hueCenter; self.hueRange = hueRange
        self.lightness = lightness; self.chroma = chroma; self.energy = energy
    }
}

/// A mood resolved for use: its spec plus the name it was registered under.
public struct ResolvedMood: Equatable {
    public let name: String
    public let spec: MoodSpec
}

/// The mood used when none is given or an unknown one is requested.
public let DEFAULT_MOOD = "celebratory"

/// The three built-in moods (values mirror the web's `BUILTIN_MOODS`).
private let BUILTIN_MOODS: [String: MoodSpec] = [
    "serene": MoodSpec(hueCenter: 230, hueRange: 120, lightness: 0.83, chroma: 0.1, energy: 0.0),
    "celebratory": MoodSpec(hueCenter: 50, hueRange: 320, lightness: 0.81, chroma: 0.17, energy: 0.5),
    "electric": MoodSpec(hueCenter: 35, hueRange: 150, lightness: 0.79, chroma: 0.24, energy: 1.0),
]

/// Mood registry. A reference type so registration is process-global, like the
/// web module-level Map. Use the shared `MoodRegistry.shared`.
public final class MoodRegistry {
    public static let shared = MoodRegistry()
    private var moods: [String: MoodSpec]
    private init() { moods = BUILTIN_MOODS }

    /// Register (or override) a mood. Returns the name so it can be used inline.
    @discardableResult
    public func register(_ name: String, _ spec: MoodSpec) -> String {
        moods[name] = spec
        return name
    }

    /// Look up a mood, falling back to the default. Always returns a usable mood.
    public func resolve(_ name: String?) -> ResolvedMood {
        let key = (name != nil && moods[name!] != nil) ? name! : DEFAULT_MOOD
        return ResolvedMood(name: key, spec: moods[key]!)
    }

    public func has(_ name: String) -> Bool { moods[name] != nil }
    public func names() -> [String] { Array(moods.keys) }
}
