// Aurora as a Dopamine effect on the Swift backbone — mirror of the web
// `effects/aurora/web/src/index.ts`.
//
// FULLY DATA-DRIVEN (P2): everything that isn't the shader lives in
// aurora.dope.json — the mood→params mapping + OKLCH palette (the loader), AND
// the per-frame logic: `tempo.frame` (the envelope amp + the accumulated
// sideways sweep that used to be hand-written here), `render.shadowHeightFrac`,
// `render.consts` (MAX_CURTAINS), `render.config` and the uniform `binding`
// contract. The generic `DopePassConfig` interprets that data through the
// shared Metal pass runner; this module is just the factory shell + the
// pass-config constructor. (The MSL itself is transpiled from the web GLSL by
// the toolchain; `AuroraUniforms` + `packAuroraUniforms` are generated from the
// `.dope` binding contract.) Aurora is DIRECTIONAL/curtain, so it ignores the
// anchor (`render.config.usesOrigin = false`).

import Foundation
import DopamineCore

/// Aurora: resolves a feeling → the flat `.dope` param bag. A calm, ambient
/// success effect — hanging curtains of polar light. The drawable side is
/// Metal-only (below).
public final class Aurora: EffectFactory {
    public let name = "aurora"
    public let doc: DopeDoc

    public init() throws {
        // Load the bundled `.dope` (the EXACT web bytes) from this package's
        // resource bundle — proving the data spine is shared verbatim.
        self.doc = try DopeResource.loadDope("aurora.dope", bundle: .module)
    }

    /// Resolve via the shared loader. The consts (`MAX_CURTAINS`) and the
    /// scatter key (`auroraSeed`) come from the `.dope` itself
    /// (`render.consts` / `binding.scatterKey`) — byte-identical to the web.
    public func resolve(_ feeling: DopeResolveInput) throws -> [String: DopeValue] {
        try resolveDopeParams(doc, feeling)
    }
}

// MARK: - Metal drawable side (macOS/iOS only).

#if canImport(Metal)
public extension Aurora {
    /// The DATA-DRIVEN pass config: `tempo.frame` (envelope amp + the
    /// accumulated "sweep" extra, read by the generated packer under its
    /// canonical name), `render.shadowHeightFrac` and `render.config` all come
    /// from the bundled `.dope`, evaluated by the shared backbone.
    static func passConfig() throws -> DopePassConfig<AuroraUniforms> {
        try DopePassConfig(
            doc: DopeResource.loadDope("aurora.dope", bundle: .module),
            vertexFunction: "aurora_vertex",
            fragmentFunction: "aurora_fragment",
            packUniforms: packAuroraUniforms
        )
    }
}
#endif
