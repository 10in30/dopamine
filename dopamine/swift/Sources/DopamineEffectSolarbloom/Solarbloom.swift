// Solarbloom as a Dopamine effect on the Swift backbone — mirror of the web
// `effect-solarbloom/src/index.ts`.
//
// Per the generalization mandate, the ONLY per-effect code here is {the MSL
// shader (in Shaders/) + the bespoke tempo (SolarbloomTempo.swift) + a tiny
// config naming its scalar params and packing them into the uniform struct}.
// Everything else — the `.dope` mapping, the OKLCH palette, the registry, the
// two-pass loop, the standard uniforms, the shadow geometry — is shared
// DopamineCore. The numeric/palette bag comes verbatim from the bundled `.dope`
// (the SAME bytes as the web); the whimsy-picked check glyph is composed on top
// with the shared `pickBand` (no rng, no effect on parity).

import Foundation
import DopamineCore

#if canImport(Metal)
import simd
#endif

/// The single source of truth for the mote cap: BOTH the MSL `#define MAX_MOTES`
/// and the integer-clamp const the `.dope` references (`clampMax: "MAX_MOTES"`).
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

    /// Resolve via the shared loader. `MAX_MOTES` is the only const; `moteSeed`
    /// is the scatter key — both byte-identical to the web call.
    public func resolve(_ feeling: DopeResolveInput) throws -> [String: DopeValue] {
        try resolveDopeParams(doc, feeling, consts: ["MAX_MOTES": MAX_MOTES], scatterKey: "moteSeed")
    }

    /// The whimsy-picked check glyph (composed on top of the numeric bag).
    public func pickCheckGlyph(whimsy: Double) -> CheckGlyph {
        pickBand(glyphBands, whimsy: whimsy)
    }
}

// MARK: - Metal drawable side (macOS/iOS only).

#if canImport(Metal)

/// The fragment uniform struct — its memory layout MUST match
/// `SolarbloomUniforms` in `Shaders/Solarbloom.metal` (same field order/types).
/// This is the GLSL→MSL binding seam made concrete: the web's per-name
/// `gl.uniform*` becomes this one packed struct.
public struct SolarbloomUniforms {
    // standard (matches StandardUniforms order)
    public var resolution = SIMD2<Float>(0, 0)
    public var origin = SIMD2<Float>(0, 0)
    public var life: Float = 0
    public var timeS: Float = 0
    public var style: Float = 0
    public var amp: Float = 0
    public var c0 = SIMD3<Float>(0, 0, 0)
    public var c1 = SIMD3<Float>(0, 0, 0)
    public var c2 = SIMD3<Float>(0, 0, 0)
    public var shadow: Float = 0
    public var shadowOffset = SIMD2<Float>(0, 0)
    public var shadowSoft: Float = 0
    public var shadowStrength: Float = 0
    // render.params (auto-bound by NAME from the resolved bag)
    public var exposure: Float = 0
    public var bloomRadius: Float = 0
    public var turbulence: Float = 0
    public var moteSpeed: Float = 0
    public var moteCount: Float = 0
    public var moteSeed: Float = 0
    public var iridescence: Float = 0
    public var dispersion: Float = 0
    // frame extras + checkmark plumbing
    public var check: Float = 0
    public var checkBox: Float = 0
    public var checkTexOn: Float = 0
    public var sdfOn: Float = 0
    public var sdfRangePx: Float = 0
    public var sdfStrokePx: Float = 0
    public init() {}
}

/// Half-size of the checkmark glyph box as a fraction of min viewport dim.
private let CHECK_BOX_FRAC: Float = 0.16

/// The per-effect pass config. The genuinely code-shaped bits: the MSL function
/// names, the shadow height (= bloom radius), the per-frame (envelope + check
/// draw) hook, and the uniform packer that lays the resolved bag into the struct.
public struct SolarbloomConfig: PassConfig {
    public typealias Uniforms = SolarbloomUniforms
    public var vertexFunction = "solarbloom_vertex"
    public var fragmentFunction = "solarbloom_fragment"
    public var usesOrigin = true
    public init() {}

    public func shadowHeightFrac(_ params: [String: DopeValue]) -> Double {
        if case let .number(v)? = params["bloomRadius"] { return v }
        return 0.7
    }

    public func frame(_ info: FrameInfo, _ params: [String: DopeValue]) -> (amp: Double, extras: [String: Double]) {
        var overshoot = 1.0
        if case let .number(v)? = params["overshoot"] { overshoot = v }
        let amp = envelope(info.life, overshoot: overshoot)
        // The check draws on its OWN ~240ms clock (bespoke tempo).
        return (amp, ["check": checkProgress(info.animMs)])
    }

    /// Pack the resolved bag → the struct. The standard half is copied straight
    /// from `StandardUniforms`; each named scalar maps to its struct field
    /// (the "auto-bind by name" the web does via `u<Name>`).
    public func packUniforms(standard s: StandardUniforms, params: [String: DopeValue], extras: [String: Double]) -> SolarbloomUniforms {
        var u = SolarbloomUniforms()
        u.resolution = s.resolution; u.origin = s.origin
        u.life = s.life; u.timeS = s.timeS; u.style = s.style; u.amp = s.amp
        u.c0 = s.c0; u.c1 = s.c1; u.c2 = s.c2
        u.shadow = s.shadow; u.shadowOffset = s.shadowOffset
        u.shadowSoft = s.shadowSoft; u.shadowStrength = s.shadowStrength

        func f(_ k: String) -> Float { if case let .number(v)? = params[k] { return Float(v) }; return 0 }
        u.exposure = f("exposure")
        u.bloomRadius = f("bloomRadius")
        u.turbulence = f("turbulence")
        u.moteSpeed = f("moteSpeed")
        u.moteCount = f("moteCount")
        u.moteSeed = f("moteSeed")
        u.iridescence = f("iridescence")
        u.dispersion = f("dispersion")

        u.check = Float(extras["check"] ?? 0)
        // checkBox / sdfStrokePx depend on the live canvas; filled by the host
        // (kept here as the analytic-fallback default so the shader still draws
        // when no SDF/glyph texture is bound).
        let minDim = min(u.resolution.x, u.resolution.y)
        u.checkBox = CHECK_BOX_FRAC * minDim
        u.sdfStrokePx = u.checkBox * 0.11
        // checkTexOn / sdfOn default 0 (analytic SDF path) until the host uploads
        // the baked-SDF / glyph texture and flips them on.
        return u
    }
}
#endif
