// Shadow-pass geometry — port of `engine/shadow.ts`.
//
// Pure math that turns amplitude, "height" above the page, and stylization into
// the offset / softness / strength of the cast soft shadow. Framework- and
// GPU-free so it is unit-testable and reusable by any effect adopting the
// multiply shadow layer. Device pixels, gl coords where Y is UP.

import Foundation

public struct ShadowGeometry: Equatable {
    public var offsetX: Double
    public var offsetY: Double
    public var soft: Double
    public var strength: Double
}

public struct ShadowInput {
    public var minDim: Double
    public var heightFrac: Double
    public var amp: Double
    public var style: Double
    public init(minDim: Double, heightFrac: Double, amp: Double, style: Double) {
        self.minDim = minDim; self.heightFrac = heightFrac; self.amp = amp; self.style = style
    }
}

private func clamp(_ x: Double, _ lo: Double, _ hi: Double) -> Double { x < lo ? lo : (x > hi ? hi : x) }

public func shadowGeometry(_ input: ShadowInput) -> ShadowGeometry {
    let height = input.heightFrac * input.minDim
    let off = height * 0.16 * (0.6 + 0.5 * Swift.min(input.amp, 1.5))
    let soft = input.minDim * 0.014 * (1 - 0.6 * input.style) + input.minDim * 0.005
    let strength = clamp(0.6 * (0.8 + 0.45 * input.style), 0, 1)
    return ShadowGeometry(offsetX: off * 0.55, offsetY: -off, soft: soft, strength: strength)
}
