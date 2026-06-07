// `.dope` CONTENT consumers — port of the portable parts of `framework/content.ts`.
//
// The whimsy→band picker (Solarbloom's check-glyph bands) and the seeded
// list picker (Comic's word pool). Reproduces the legacy arithmetic EXACTLY so a
// built-in's output is byte-identical while reskinning becomes pure `.dope` edit.

import Foundation

/// Deterministically pick one of `list` from a seed (matches Comic `pickWord`).
public func pickFromList<T>(_ list: [T], seed: UInt32) -> T {
    let r = mulberry32(seed)()
    let idx = Swift.min(list.count - 1, Int((r * Double(list.count)).rounded(.down)))
    return list[idx]
}

/// Pick a band by whimsy (0..1), splitting the slider into equal bands. Matches
/// Solarbloom's `pickCheckGlyph`: `floor(w * n)` clamped to the last band.
public func pickBand<T>(_ bands: [T], whimsy: Double) -> T {
    let w = whimsy < 0 ? 0 : (whimsy > 1 ? 1 : whimsy)
    let idx = Swift.min(bands.count - 1, Int((w * Double(bands.count)).rounded(.down)))
    return bands[idx]
}
