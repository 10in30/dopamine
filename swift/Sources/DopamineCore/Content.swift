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

// ---------------------------------------------------------------------------
// TYPOGRAPHY — port of `framework/content.ts` `resolveTypography`.
//
// The `.dope` `typography` section declares per-mood typographic baselines (the
// primary display face + skew/tilt/stretchX/tracking/roundness) and a table of
// derived numeric curve fields, each an expression over `control` (intensity /
// whimsy) + the mood `baseline` — evaluated with the SAME grammar evaluator the
// numeric params use. This reproduces the legacy `comicTypography` arithmetic
// byte-for-byte; reskinning the font/feel becomes a `.dope` edit.
// ---------------------------------------------------------------------------

@inline(__always)
private func clamp01t(_ x: Double) -> Double { x < 0 ? 0 : (x > 1 ? 1 : x) }

/// Resolve the `.dope` `typography` table for a mood + intensity + whimsy into a
/// bag fragment: `fontStack` + `face` (strings) and each numeric curve field. The
/// `baseline` context is the per-mood typographic baseline so a field expr can
/// reference e.g. `{ "baseline": "stretchX" }`. Returns an EMPTY map if the doc
/// declares no `typography` (additive; the numeric/palette path is untouched).
public func resolveTypography(_ doc: DopeDoc, mood: String, intensity: Double, whimsy: Double) -> [String: DopeValue] {
    guard let typo = doc.raw["typography"], let perMood = typo["perMood"]?.asObject else { return [:] }

    // Degrade an undeclared mood to the FIRST declared typography mood (matching
    // the web `typo.perMood[mood] ?? typo.perMood[Object.keys(...)[0]]`).
    let baseObj = perMood.first(where: { $0.0 == mood })?.1 ?? perMood.first?.1
    guard let base = baseObj else { return [:] }

    let face = base["face"]?.asString ?? ""
    let fallback = typo["fallbackStack"]?.asString ?? ""

    // Only the numeric baselines are visible to the grammar (matches the web ctx).
    let baseline: [String: Double] = [
        "skew": base["skew"]?.asNumber ?? 0,
        "tilt": base["tilt"]?.asNumber ?? 0,
        "stretchX": base["stretchX"]?.asNumber ?? 0,
        "tracking": base["tracking"]?.asNumber ?? 0,
        "roundness": base["roundness"]?.asNumber ?? 0,
    ]
    let ctx = EvalCtx(controls: ["intensity": clamp01t(intensity), "whimsy": clamp01t(whimsy)], baseline: baseline, consts: [:])

    var out: [String: DopeValue] = [
        // fontStack = `<face>, <fallback>` (the web's CSS chain); `face` is the bare
        // primary family the host panels map to a bundled ttf.
        "fontStack": .string("\(face), \(fallback)"),
        "face": .string(face),
    ]
    if let fields = typo["fields"]?.asObject {
        for (name, spec) in fields {
            guard let fromJSON = spec["from"], let node = try? decodeExpr(fromJSON), var v = try? evalExpr(node, ctx) else { continue }
            if spec["round"]?.asBool == true { v = jsRound(v) }
            if spec["clamp01"]?.asBool == true { v = clamp01t(v) }
            out[name] = .number(v)
        }
    }
    return out
}
