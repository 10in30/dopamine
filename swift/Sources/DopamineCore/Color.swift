// Algorithmic color in OKLCH — direct port of `engine/color.ts`.
//
// OKLCH is perceptually uniform, so walking hue by the golden angle (137.5°)
// yields harmonious-but-never-repeating palettes. We hand the shader *linear*
// sRGB (light sums in linear space). The math (Björn Ottosson's OKLab matrices,
// the golden-angle palette builder, the gamut clamp) is reproduced constant-for-
// constant so a pinned seed matches the web byte-for-byte.

import Foundation

/// Linear sRGB, nominally 0..1 (may exceed before clamping).
public struct RGB: Equatable, Codable {
    public var r: Double
    public var g: Double
    public var b: Double
    public init(r: Double, g: Double, b: Double) {
        self.r = r; self.g = g; self.b = b
    }
}

/// OKLCH: perceptual lightness L (0..1), chroma C (~0..0.4), hue h (degrees).
public struct OKLCH: Equatable {
    public var L: Double
    public var C: Double
    public var h: Double
    public init(L: Double, C: Double, h: Double) {
        self.L = L; self.C = C; self.h = h
    }
}

public let GOLDEN_ANGLE_DEG = 137.50776405003785

@inline(__always)
func clamp01(_ x: Double) -> Double { x < 0 ? 0 : (x > 1 ? 1 : x) }

/// Positive modulo into [0, 360).
public func wrapHue(_ h: Double) -> Double {
    (h.truncatingRemainder(dividingBy: 360) + 360).truncatingRemainder(dividingBy: 360)
}

/// OKLCH → linear sRGB (OKLab matrices). Gamut-clamped to [0, 1] per channel.
public func oklchToLinearSrgb(_ c: OKLCH) -> RGB {
    let hr = c.h * Double.pi / 180
    let a = c.C * cos(hr)
    let b = c.C * sin(hr)

    let l_ = c.L + 0.3963377774 * a + 0.2158037573 * b
    let m_ = c.L - 0.1055613458 * a - 0.0638541728 * b
    let s_ = c.L - 0.0894841775 * a - 1.291485548 * b

    let l = l_ * l_ * l_
    let m = m_ * m_ * m_
    let s = s_ * s_ * s_

    return RGB(
        r: clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
        g: clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
        b: clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)
    )
}

/// Parameters for the 3-stop golden-angle palette.
public struct PaletteParams {
    public var lightness: Double
    public var chroma: Double
    public var hueCenter: Double
    public var hueRange: Double
    /// 0..1 — how far the golden-angle stops fan out from the base hue.
    public var hueSpread: Double
    public init(lightness: Double, chroma: Double, hueCenter: Double, hueRange: Double, hueSpread: Double) {
        self.lightness = lightness; self.chroma = chroma
        self.hueCenter = hueCenter; self.hueRange = hueRange; self.hueSpread = hueSpread
    }
}

/// Build a 3-stop linear-RGB palette. The base hue is drawn from `rng` FIRST
/// (the parity anchor — exactly one pull here), biased toward the mood's range;
/// successive stops step by the golden angle scaled by hueSpread.
public func buildPalette(_ rng: Rng, _ p: PaletteParams) -> [RGB] {
    let baseHue = wrapHue(p.hueCenter + (rng() - 0.5) * p.hueRange)
    let step = GOLDEN_ANGLE_DEG * (0.35 + 0.65 * p.hueSpread)
    let lightSteps = [0.0, 0.06, -0.05]
    let chromaSteps = [0.0, 0.02, -0.01]

    return (0 ..< 3).map { i in
        oklchToLinearSrgb(OKLCH(
            L: clamp01(p.lightness + lightSteps[i]),
            C: max(0, p.chroma + chromaSteps[i]),
            h: wrapHue(baseHue + step * Double(i))
        ))
    }
}
