// Fail / error as a Dopamine effect on the Swift backbone — mirror of the web
// `effects/fail/web/src/index.ts`.
//
// FULLY DATA-DRIVEN (P2) where data can reach: everything that isn't the shader
// lives in fail.dope.json — the mood→params mapping + OKLCH palette (the
// loader), AND the per-frame logic that used to be FailTempo.swift: the
// slam/hold/collapse `amp` (failEnvelope), the 170 ms ✗ "stamp" and the damped
// recoil "shake" (both on the REAL un-stepped `elapsedMs`, identical on every
// platform), with `render.shadowHeightFrac`/`config` and the uniform `binding`
// contract alongside. The generic `DopePassConfig` interprets that data through
// the shared Metal pass runner. What stays CODE (the honest boundary, passed as
// the `packExtras` hook): the canvas-size-dependent ✗ box / SDF-stroke pixel
// defaults the analytic fallback needs — mirroring the web `passUniforms` hook.
// (The MSL itself is transpiled from the web GLSL by the toolchain;
// `FailUniforms` + `packFailUniforms` are generated from the `.dope` binding
// contract.) The fail feel is the emotional OPPOSITE of the success effects:
// a stamped ✗ over a recoiling error flare, then a fast desaturated collapse —
// no afterglow, no celebration.

import Foundation
import DopamineCore

/// Fail: resolves a feeling → the flat `.dope` param bag. The drawable side is
/// Metal-only (below).
public final class Fail: EffectFactory {
    public let name = "fail"
    public let doc: DopeDoc

    public init() throws {
        // Load the bundled `.dope` (the EXACT web bytes) from this package's
        // resource bundle — proving the data spine is shared verbatim.
        self.doc = try DopeResource.loadDope("fail.dope", bundle: .module)
    }

    /// Resolve via the shared loader. There are no clamp consts (`render.consts`
    /// is empty); the scatter key (`failSeed`) comes from the `.dope` itself
    /// (`binding.scatterKey`) — byte-identical to the web.
    public func resolve(_ feeling: DopeResolveInput) throws -> [String: DopeValue] {
        try resolveDopeParams(doc, feeling)
    }
}

// MARK: - Metal drawable side (macOS/iOS only).

#if canImport(Metal)

/// Half-size of the ✗ box as a fraction of min viewport dim.
private let CROSS_BOX_FRAC: Float = 0.15

public extension Fail {
    /// The DATA-DRIVEN pass config: `tempo.frame` (failEnvelope amp + the
    /// "stamp"/"shake" extras on the un-stepped clock, read by the generated
    /// packer under their canonical names), `render.shadowHeightFrac` and
    /// `render.config` all come from the bundled `.dope`. The `packExtras` hook
    /// keeps the genuinely code-shaped ✗ plumbing: boxPx / sdfStrokePx defaults
    /// derived from the live target size.
    static func passConfig() throws -> DopePassConfig<FailUniforms> {
        try DopePassConfig(
            doc: DopeResource.loadDope("fail.dope", bundle: .module),
            vertexFunction: "fail_vertex",
            fragmentFunction: "fail_fragment",
            packUniforms: packFailUniforms,
            packExtras: { standard, _, extras in
                // boxPx / sdfStrokePx are needed even in the analytic (SDF-less)
                // fallback. The host may override, but we fill the
                // analytic-fallback default so the shader still draws when no
                // SDF is bound. sdfOn stays 0 until the host uploads the baked
                // ✗ SDF texture and flips it on. The ✗ box is sized to the
                // TARGETED element (standard.target defaults to the full
                // canvas, so untargeted fires are unchanged).
                let minDim = Float(min(standard.target.x, standard.target.y))
                let boxPx = CROSS_BOX_FRAC * minDim
                if extras["boxPx"] == nil { extras["boxPx"] = Double(boxPx) }
                if extras["sdfStrokePx"] == nil { extras["sdfStrokePx"] = Double(boxPx * 0.13) }
            }
        )
    }
}
#endif
