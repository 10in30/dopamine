// Halo as a Dopamine effect on the Swift backbone — mirror of the web
// `effects/halo/web/src/index.ts`.
//
// FULLY DATA-DRIVEN (P2): everything that isn't the shader lives in
// halo.dope.json — the mood→params mapping + OKLCH palette (the loader), AND
// the per-frame logic: `tempo.frame` (the steady periodic breathe gate that
// used to be the hand-written `haloBreathe`), `render.shadowHeightFrac` (the
// ring's outer reach), `render.config` and the uniform `binding` contract. The
// generic `DopePassConfig` interprets that data through the shared Metal pass
// runner; this module is just the factory shell + the pass-config constructor.
// (The MSL itself is transpiled from the web GLSL by the toolchain;
// `HaloUniforms` + `packHaloUniforms` are generated from the `.dope` binding
// contract.)
//
// CONTINUOUS / LOOPING. Halo is Dopamine's first continuous effect: every other
// effect is a one-shot reward moment gated by `amp = envelope(life)` (a 0→peak→0
// fade). Halo instead declares the first-class `tempo.loop` contract
// (`periodMs = 1500`): the parser validates the seam invariants (the period is
// exactly 18 "animate-on-twos" steps; `durationMs = 6000` is exactly 4
// periods), the runner derives the standard periodic clocks (`phase`/`loopS`,
// packed into every effect's uniform struct) AND wraps its clock at
// `durationMs`, so a host that keeps ticking loops seamlessly forever. The
// `tempo.frame.amp` is a STEADY periodic breathe of that phase —
// `0.85 + 0.15·sin(2π·phase)` — never an envelope.

import Foundation
import DopamineCore

/// Halo: resolves a feeling → the flat `.dope` param bag. The drawable side is
/// Metal-only (below).
public final class Halo: EffectFactory {
    public let name = "halo"
    public let doc: DopeDoc

    public init() throws {
        // Load the bundled `.dope` (the EXACT web bytes) from this package's
        // resource bundle — proving the data spine is shared verbatim.
        self.doc = try DopeResource.loadDope("halo.dope", bundle: .module)
    }

    /// Resolve via the shared loader. Halo references no clamp consts; the
    /// scatter key (`haloSeed`) comes from the `.dope` itself
    /// (`binding.scatterKey`) — byte-identical to the web.
    public func resolve(_ feeling: DopeResolveInput) throws -> [String: DopeValue] {
        try resolveDopeParams(doc, feeling)
    }
}

// MARK: - Metal drawable side (macOS/iOS only).

#if canImport(Metal)
public extension Halo {
    /// The DATA-DRIVEN pass config: `tempo.frame` (the STEADY periodic breathe
    /// amp — NOT an envelope; halo's continuous-loop contract),
    /// `render.shadowHeightFrac` and `render.config` all come from the bundled
    /// `.dope`, evaluated by the shared backbone.
    static func passConfig() throws -> DopePassConfig<HaloUniforms> {
        try DopePassConfig(
            doc: DopeResource.loadDope("halo.dope", bundle: .module),
            vertexFunction: "halo_vertex",
            fragmentFunction: "halo_fragment",
            packUniforms: packHaloUniforms
        )
    }
}
#endif
