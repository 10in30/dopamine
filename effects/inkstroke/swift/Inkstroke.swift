// Inkstroke (Calligraphic Verdict) as a Dopamine effect on the Swift backbone —
// mirror of the web `effects/inkstroke/web/src/index.ts`.
//
// FULLY DATA-DRIVEN (P2): everything that isn't the shader lives in
// inkstroke.dope.json — the mood→params mapping + OKLCH palette (the loader),
// AND the per-frame logic: `tempo.frame` (the envelope amp + the ~360 ms pen
// "draw" progress that used to be InkstrokeTempo.swift),
// `render.shadowHeightFrac`, `render.consts` (MAX_DROPS), `render.config` and
// the uniform `binding` contract. The generic `DopePassConfig` interprets that
// data through the shared Metal pass runner; this module is just the factory
// shell + the pass-config constructor. (The MSL itself is transpiled from the
// web GLSL by the toolchain; `InkstrokeUniforms` + `packInkstrokeUniforms` are
// generated from the `.dope` binding contract.) The verdict is a fully
// analytic, data-driven stroke — no content glyph, no texture plumbing.

import Foundation
import DopamineCore

/// Inkstroke: resolves a feeling → the flat `.dope` param bag. The drawable side
/// is Metal-only (below).
public final class Inkstroke: EffectFactory {
    public let name = "inkstroke"
    public let doc: DopeDoc

    public init() throws {
        // Load the bundled `.dope` (the EXACT web bytes) from this package's
        // resource bundle — proving the data spine is shared verbatim.
        self.doc = try DopeResource.loadDope("inkstroke.dope", bundle: .module)
    }

    /// Resolve via the shared loader. The consts (`MAX_DROPS`) and the scatter
    /// key (`inkSeed`) come from the `.dope` itself (`render.consts` /
    /// `binding.scatterKey`) — byte-identical to the web.
    public func resolve(_ feeling: DopeResolveInput) throws -> [String: DopeValue] {
        try resolveDopeParams(doc, feeling)
    }
}

// MARK: - Metal drawable side (macOS/iOS only).

#if canImport(Metal)
public extension Inkstroke {
    /// The DATA-DRIVEN pass config: `tempo.frame` (the envelope amp + the pen
    /// "draw" extra — `easeOutCubic(animMs / 360)`, on the on-twos clock so the
    /// stroke shares the cel jitter, read by the generated packer under its
    /// canonical name), `render.shadowHeightFrac` and `render.config` all come
    /// from the bundled `.dope`, evaluated by the shared backbone.
    static func passConfig() throws -> DopePassConfig<InkstrokeUniforms> {
        try DopePassConfig(
            doc: DopeResource.loadDope("inkstroke.dope", bundle: .module),
            vertexFunction: "inkstroke_vertex",
            fragmentFunction: "inkstroke_fragment",
            packUniforms: packInkstrokeUniforms
        )
    }
}
#endif
