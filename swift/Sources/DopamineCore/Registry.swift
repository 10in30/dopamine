// Effect registry — port of `framework/registry.ts`.
//
// Effects self-register on load, keeping the lookup tree-shakeable in spirit.
// The public play/element surfaces route through here. A `EffectFactory` here is
// the minimal protocol the runtime needs: a name + a way to resolve a feeling
// into the flat param bag. The drawable `create()` lives platform-side
// (Metal-only), so the portable registry stays free of any GPU type.

import Foundation

/// The minimal portable effect contract: a name + a resolver from a feeling to
/// the flat `.dope` param bag. (The Metal-backed `create()` is added by the
/// platform layer behind `#if canImport(Metal)`.)
public protocol EffectFactory {
    var name: String { get }
    func resolve(_ feeling: DopeResolveInput) throws -> [String: DopeValue]
}

/// Process-global effect registry (mirrors the web module-level Map).
public final class EffectRegistry {
    public static let shared = EffectRegistry()
    private var effects: [String: EffectFactory] = [:]
    private init() {}

    @discardableResult
    public func register(_ factory: EffectFactory) -> EffectFactory {
        effects[factory.name] = factory
        return factory
    }

    public func get(_ name: String) -> EffectFactory? { effects[name] }
    public func has(_ name: String) -> Bool { effects[name] != nil }
    public func names() -> [String] { Array(effects.keys) }
}
