// Ripple as a Dopamine effect on the Swift backbone — mirror of the web
// `effects/ripple/web/src/index.ts`.
//
// FULLY DATA-DRIVEN (P2): everything that isn't the shader lives in
// ripple.dope.json — the mood→params mapping + OKLCH palette (the loader), AND
// the per-frame logic: `tempo.frame` (the held-breath envelope amp),
// `render.shadowHeightFrac` (the wave field's outward reach), `render.consts`
// (MAX_RINGS / MIN_RINGS), `render.config` and the uniform `binding` contract.
// The generic `DopePassConfig` interprets that data through the shared Metal
// pass runner; this module is just the factory shell + the pass-config
// constructor. (The MSL itself is transpiled from the web GLSL by the
// toolchain; `RippleUniforms` + `packRippleUniforms` are generated from the
// `.dope` binding contract.)

import Foundation
import DopamineCore

/// Ripple: resolves a feeling → the flat `.dope` param bag. The drawable side is
/// Metal-only (below).
public final class Ripple: EffectFactory {
    public let name = "ripple"
    public let doc: DopeDoc

    public init() throws {
        // Load the bundled `.dope` (the EXACT web bytes) from this package's
        // resource bundle — proving the data spine is shared verbatim.
        self.doc = try DopeResource.loadDope("ripple.dope", bundle: .module)
    }

    /// Resolve via the shared loader. The consts (`MAX_RINGS` / `MIN_RINGS`)
    /// and the scatter key (`rippleSeed`) come from the `.dope` itself
    /// (`render.consts` / `binding.scatterKey`) — byte-identical to the web.
    public func resolve(_ feeling: DopeResolveInput) throws -> [String: DopeValue] {
        try resolveDopeParams(doc, feeling)
    }
}

// MARK: - Metal drawable side (macOS/iOS only).

#if canImport(Metal)
public extension Ripple {
    /// The DATA-DRIVEN pass config: `tempo.frame` (the envelope amp; no
    /// extras), `render.shadowHeightFrac` and `render.config` all come from
    /// the bundled `.dope`, evaluated by the shared backbone.
    static func passConfig() throws -> DopePassConfig<RippleUniforms> {
        try DopePassConfig(
            doc: DopeResource.loadDope("ripple.dope", bundle: .module),
            vertexFunction: "ripple_vertex",
            fragmentFunction: "ripple_fragment",
            packUniforms: packRippleUniforms
        )
    }
}
#endif
