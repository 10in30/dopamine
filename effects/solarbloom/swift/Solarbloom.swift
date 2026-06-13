// Solarbloom as a Dopamine effect on the Swift backbone — mirror of the web
// `effect-solarbloom/src/index.ts`.
//
// Solarbloom is a PASS HYBRID on web (a procedural bloom + checkmark + a Canvas2D
// mote SPRITE PANEL). On Metal the runner has no sprite-panel/aux support for a
// PASS effect, so the SHADER stays a hand-written per-platform source that renders
// the motes PROCEDURALLY (the per-pixel mote loop) and the checkmark via the
// ANALYTIC two-segment SDF branch (uSdfOn / uCheckTexOn stay 0 — the fail
// precedent). But everything around that shader is now DATA: the per-frame logic
// (`tempo.frame`), the per-pass uniforms (`render.pass`), the shadow height
// (`render.shadowHeightFrac`), the consts/config and reduced motion all come from
// solarbloom.dope.json via the generic `DopePassConfig` — so there is no
// hand-written SolarbloomTempo.swift and no hand frame()/passExtras here.
// The numeric/palette bag is the SAME bytes as the web; the whimsy-picked check
// glyph is composed on top with the shared `pickBand` (no rng, no parity effect).

import Foundation
import DopamineCore

#if canImport(Metal)
import simd
#endif

/// The single source of truth for the mote cap: BOTH the MSL `#define MAX_MOTES`
/// and the integer-clamp const the `.dope` references (`render.consts.MAX_MOTES`).
public let MAX_MOTES: Double = 80

/// A concrete check-glyph choice (bundled face + the codepoint to render).
public struct CheckGlyph: Equatable {
    public var family: String
    public var char: String
}

/// Solarbloom: resolves a feeling → the flat `.dope` param bag (+ the picked
/// check glyph). The drawable side is Metal-only (below).
public final class Solarbloom: EffectFactory {
    public let name = "solarbloom"
    public let doc: DopeDoc
    private let glyphBands: [CheckGlyph]

    public init() throws {
        // Load the bundled `.dope` (the EXACT web bytes) from this package's
        // resource bundle — proving the data spine is shared verbatim.
        self.doc = try DopeResource.loadDope("solarbloom.dope", bundle: .module)
        // The whimsy→check-glyph fallback BANDS live in the .dope content section.
        var bands: [CheckGlyph] = []
        if let arr = doc.raw["content"]?["glyphBands"]?.asArray {
            for b in arr {
                if let fam = b["family"]?.asString, let ch = b["char"]?.asString {
                    bands.append(CheckGlyph(family: fam, char: ch))
                }
            }
        }
        self.glyphBands = bands.isEmpty
            ? [CheckGlyph(family: "Dopamine Check Symbols", char: "\u{2713}")]
            : bands
    }

    /// Resolve via the shared loader. The clamp consts (`MAX_MOTES`) and the
    /// scatter key (`moteSeed`) come from the `.dope` itself — byte-identical to
    /// the web.
    public func resolve(_ feeling: DopeResolveInput) throws -> [String: DopeValue] {
        try resolveDopeParams(doc, feeling)
    }

    /// The whimsy-picked check glyph (composed on top of the numeric bag).
    public func pickCheckGlyph(whimsy: Double) -> CheckGlyph {
        pickBand(glyphBands, whimsy: whimsy)
    }
}

// MARK: - Metal drawable side (macOS/iOS only).

#if canImport(Metal)

// NOTE: `SolarbloomUniforms` + `packSolarbloomUniforms(...)` are GENERATED into
// `SolarbloomUniforms.swift` (the SAME source that emits the MSL struct), so the
// Swift struct and the `.metal` struct cannot drift. The config below just wraps
// the generic data-driven `DopePassConfig` (which reads `tempo.frame` +
// `render.pass` from the bundled `.dope`) over that generated packer.

/// The per-effect pass config. Solarbloom keeps a HAND factory only because its
/// MSL shader is hand-written (the procedural per-pixel mote loop — a supported
/// per-platform path); everything time/pass-shaped is the datafied `.dope`,
/// interpreted by the wrapped `DopePassConfig` (the same generic config the fully
/// generated effects use). The public `SolarbloomConfig()` API is unchanged.
public struct SolarbloomConfig: PassConfig {
    public typealias Uniforms = SolarbloomUniforms

    private let base: DopePassConfig<SolarbloomUniforms>

    public init() throws {
        self.base = try DopePassConfig(
            doc: DopeResource.loadDope("solarbloom.dope", bundle: .module),
            vertexFunction: "solarbloom_vertex",
            fragmentFunction: "solarbloom_fragment",
            packUniforms: packSolarbloomUniforms
        )
    }

    // PassConfig — forwarded to the data-driven base.
    public var vertexFunction: String { base.vertexFunction }
    public var fragmentFunction: String { base.fragmentFunction }
    public var usesOrigin: Bool { base.usesOrigin }
    public var loopPeriodMs: Double? { base.loopPeriodMs }
    public var snapsOnTwos: Bool { base.snapsOnTwos }
    public func shadowHeightFrac(_ params: [String: DopeValue]) -> Double {
        base.shadowHeightFrac(params)
    }
    public func frame(_ info: FrameInfo, _ params: [String: DopeValue]) -> (amp: Double, extras: [String: Double]) {
        base.frame(info, params)
    }
    public func passExtras(
        targetMinDimPx: Double, dpr: Double, params: [String: DopeValue]
    ) -> [String: Double] {
        base.passExtras(targetMinDimPx: targetMinDimPx, dpr: dpr, params: params)
    }
    public func packUniforms(
        standard: StandardUniforms,
        params: [String: DopeValue],
        extras: [String: Double]
    ) -> SolarbloomUniforms {
        base.packUniforms(standard: standard, params: params, extras: extras)
    }
}
#endif
