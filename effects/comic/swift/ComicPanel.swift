// Comic Impact — the offscreen Canvas2D PANEL, ported to Core Graphics / Core
// Text as a `PanelDrawing` conformance on `ComicConfig`.
//
// HYBRID effect: the crisp vector forms (the jagged starburst balloon, the
// blocky onomatopoeia word, the bold ink contours) are NOT procedural in the
// shader — the web draws them into an offscreen Canvas2D ("panel") and the
// fragment shader (Comic.metal) samples that texture and adds the Ben-Day
// halftone / action lines / flash / pop-art look on top. The Swift backbone owns
// the panel runner (MetalOverlayHost builds + uploads it every frame in `tick`);
// this file supplies ONLY the per-effect draw, a faithful port of
// `effects/comic/web/src/comic-renderer.ts`.
//
// PANEL CHANNEL ENCODING (must match Comic.metal exactly):
//   R = word FILL mask   G = INK mask   B = burst FILL mask   A = unused
// The shader samples the panel at fragment texture(0), sampler(0), in a y-up vUv;
// the host flips the CGContext to a TOP-LEFT origin so this draw matches the web
// Canvas2D coordinate space verbatim (y-down, origin top-left).
//
// ANIMATED (leveled up to web parity): the panel is redrawn EVERY frame with the
// live slam `scale` + `presence` — `MetalOverlayHost.tick` calls `drawPanel(…,
// frame:)` per frame, so the word slams in / recoils / fades exactly like the web
// (the "static snapshot" was a choice, not a host limit). `elapsedMs` is recovered
// as `frame.life * params.durationMs`.
//
// TYPOGRAPHY (leveled up to web parity): the mood-picked bundled display face
// (Bangers / Anton / Luckiest Guy) is loaded from this package's Resources/fonts
// (ttf converted from the shared woff2 by the toolchain) and laid out per-letter
// with the full skew / stretch / tilt / per-letter rotation + baseline jitter / 3D
// extrude / stacked outline / inkRoundness treatment — driven by the typography
// fields the loader now composes into the resolved bag (`face`, `fontSkew`,
// `fontTilt`, `fontStretchX`, `fontTracking`, `outlineLayers`, `extrudeDepth`,
// `letterRotJitter`, `letterBaselineJitter`, `inkRoundness`). If the face can't be
// loaded it falls back to a bold system face so the word still reads.

#if canImport(CoreGraphics)
import Foundation
import CoreGraphics
import DopamineCore

#if canImport(CoreText)
import CoreText
#endif

/// How big the starburst + word read relative to the targeted element box (the
/// burst diameter ≈ 0.88·basis, so this gives a comic ≈ 1.5× the element). Kept in
/// sync with the web comic renderer.
private let COMIC_TARGET_FILL: CGFloat = 1.7

/// The bundled display faces, mapped family → ttf basename in Resources/fonts.
/// The `.dope` per-mood `face` is a CSS family (quoted); we strip the quotes to
/// look it up here. Kept in sync with `effects/comic/fonts` + the toolchain.
private let COMIC_FONT_FILES: [String: String] = [
    "Bangers": "Bangers-Regular",
    "Anton": "Anton-Regular",
    "Luckiest Guy": "LuckiestGuy-Regular",
]

extension ComicConfig: PanelDrawing {
    /// The per-fire SLAMMED token pool — the comic.dope `content.pool` (the seven
    /// affirmations + the checkmark sentinel, equal odds). Kept in sync with the
    /// `.dope`; reskinning the word list is a `.dope` edit on the `Comic` factory
    /// (this static mirror only feeds the host-side panel draw).
    static let wordPool: [String] = ["YES!", "DONE!", "NICE!", "OKAY!", "WIN!", "GREAT!", "WOO!", "✓"]

    // The whole canvas — the panel is a full-frame overlay (web `panelSizePx`).
    public func panelSizePx(canvasPx: CGSize, params: [String: DopeValue]) -> CGSize { canvasPx }

    /// Draw the offscreen panel for this frame. The host redraws this EVERY frame
    /// with the live `frame.life`, so the slam scale + presence animate exactly
    /// like the web. The frame's element box positions + sizes the word.
    public func drawPanel(_ ctx: CGContext, sizePx: CGSize, params: [String: DopeValue], frame: PanelFrame) {
        let w = sizePx.width, h = sizePx.height
        guard w > 1, h > 1 else { return }

        // Resolved-bag scalars (defaults mirror comic.dope authored ranges).
        func num(_ k: String, _ d: Double) -> Double {
            if case let .number(v)? = params[k] { return v }; return d
        }
        func str(_ k: String, _ d: String) -> String {
            if case let .string(v)? = params[k] { return v }; return d
        }
        let comicSeed   = num("comicSeed", 0)
        let rawSeed     = num("seed", 0)   // the raw fire seed (word pick uses this)
        let scaleParam  = num("scale", 0.34)
        let burstPoints = num("burstPoints", 14)
        let inkWeight   = num("inkWeight", 3)
        let overshoot   = num("overshoot", 1)
        let durationMs  = num("durationMs", 1)

        // LIVE slam: recover elapsedMs from life (PanelFrame carries life only).
        let presence  = CGFloat(impactPresence(frame.life))
        if presence <= 0.001 { return }
        let elapsedMs = frame.life * durationMs
        let slamScale = CGFloat(impactScale(elapsedMs, overshoot: overshoot))
        let dpr: CGFloat = 1.0   // the host re-rasterizes at the device size already.

        // The web draws every layer with `globalCompositeOperation = "lighter"`
        // (additive) so the R/G/B channel masks accumulate INDEPENDENTLY — a red
        // word fill must not zero the blue burst it overlaps. `.plusLighter` is the
        // Core Graphics equivalent; set once for the whole panel.
        ctx.setBlendMode(.plusLighter)

        // Position + size the word/starburst to the targeted element (defaults to the
        // canvas centre + full canvas, reproducing the old screen-centred pose).
        let cx = frame.centerPx.x, cy = frame.centerPx.y
        let minDim = min(min(frame.targetPx.width, frame.targetPx.height) * COMIC_TARGET_FILL, min(w, h))
        // The web rng seeds the burst jitter from (comicSeed * 1000) >>> 0.
        let rng = mulberry32(UInt32(truncatingIfNeeded: Int((comicSeed * 1000).rounded(.towardZero))))

        // Per-fire tilt, hand-placed feel (~±5deg) — web `(comicSeed % 1 - 0.5)*0.18`.
        let tilt = CGFloat((comicSeed.truncatingRemainder(dividingBy: 1)) - 0.5) * 0.18

        // ---------- STARBURST BALLOON (B fill + G outline) -------------------
        let points = max(8, Int(burstPoints.rounded()))
        let outerR = minDim * CGFloat(scaleParam) * 1.3 * slamScale
        let innerR = outerR * 0.64
        var burstPts: [CGPoint] = []
        burstPts.reserveCapacity(points * 2)
        for i in 0 ..< (points * 2) {
            let t = CGFloat(i) / CGFloat(points * 2)
            let a = t * .pi * 2 - .pi / 2 + tilt
            let even = (i % 2 == 0)
            let jitter = 0.82 + CGFloat(rng()) * 0.36
            let r = (even ? outerR : innerR) * jitter
            burstPts.append(CGPoint(x: cx + cos(a) * r, y: cy + sin(a) * r))
        }
        func tracePath() {
            ctx.beginPath()
            for (i, p) in burstPts.enumerated() {
                if i == 0 { ctx.move(to: p) } else { ctx.addLine(to: p) }
            }
            ctx.closePath()
        }

        let ink = CGFloat(inkWeight) * dpr * slamScale
        let fillA = presence  // 0..1 channel value scaled by presence (web `255*presence`).

        // Burst FILL -> BLUE.
        ctx.saveGState()
        tracePath()
        ctx.setFillColor(red: 0, green: 0, blue: fillA, alpha: 1)
        ctx.fillPath()
        ctx.restoreGState()

        // Burst OUTLINE -> GREEN (ink).
        ctx.saveGState()
        ctx.setLineJoin(.miter)
        ctx.setMiterLimit(2)
        tracePath()
        ctx.setLineWidth(ink * 1.3)
        ctx.setStrokeColor(red: 0, green: fillA, blue: 0, alpha: 1)
        ctx.strokePath()
        ctx.restoreGState()

        // ---------- WORD / CHECKMARK -----------------------------------------
        // The seed-picked token (raw fire seed, like the web `pickFromList(pool,
        // feeling.seed)`). The pool is the comic.dope `content.pool`, mirrored above.
        let pool = ComicConfig.wordPool
        let word = pickFromList(pool, seed: UInt32(truncatingIfNeeded: Int(rawSeed.rounded(.towardZero))))
        let inkColor = CGColor(red: 0, green: fillA, blue: 0, alpha: 1)
        let fillColor = CGColor(red: fillA, green: 0, blue: 0, alpha: 1)

        // Typography knobs (composed into the bag by the loader; web parity defaults).
        let fontSkew    = CGFloat(num("fontSkew", 0))
        let fontTilt    = CGFloat(num("fontTilt", 0))
        let fontStretchX = CGFloat(num("fontStretchX", 1))
        let fontTracking = CGFloat(num("fontTracking", 0))
        let outlineLayers = max(1, Int(num("outlineLayers", 1).rounded()))
        let extrudeDepth = CGFloat(num("extrudeDepth", 0))
        let letterRotJitter = num("letterRotJitter", 0)
        let letterBaselineJitter = num("letterBaselineJitter", 0)
        let round = num("inkRoundness", 0)

        ctx.saveGState()
        ctx.translateBy(x: cx, y: cy)
        ctx.rotate(by: tilt + fontTilt)
        // Italic lean + non-uniform stretch as a shared transform on the whole word:
        // matrix [a=stretchX, b=0, c=skew, d=1] (web `ctx.transform(stretchX,0,skew,1,0,0)`).
        ctx.concatenate(CGAffineTransform(a: fontStretchX, b: 0, c: fontSkew, d: 1, tx: 0, ty: 0))
        ctx.setLineJoin(round > 0.5 ? .round : .miter)
        ctx.setLineCap(round > 0.5 ? .round : .butt)
        ctx.setMiterLimit(2)

        if word == "✓" {
            // ----- VECTOR CHECKMARK (web isCheckmark path) --------------------
            let span = innerR * 1.25
            let strokeW = span * 0.24 * (0.85 + CGFloat(round) * 0.25)
            let extrude = span * extrudeDepth
            let pts: [CGPoint] = [
                CGPoint(x: -span * 0.42, y: span * 0.02),
                CGPoint(x: -span * 0.12, y: span * 0.34),
                CGPoint(x:  span * 0.46, y: -span * 0.36),
            ]
            func traceCheck() {
                ctx.beginPath()
                for (i, p) in pts.enumerated() { i == 0 ? ctx.move(to: p) : ctx.addLine(to: p) }
            }
            // 3D extrude: stacked ink copies stepping down-right (pop-art only).
            if extrude > 0.5 {
                let steps = 8
                for s in stride(from: steps, through: 1, by: -1) {
                    let d = extrude * CGFloat(s) / CGFloat(steps)
                    ctx.saveGState()
                    ctx.translateBy(x: d, y: d)
                    traceCheck()
                    ctx.setLineWidth(strokeW)
                    ctx.setStrokeColor(inkColor)
                    ctx.strokePath()
                    ctx.restoreGState()
                }
            }
            // Bold ink contour (heavier toward pop-art via outlineLayers).
            traceCheck()
            ctx.setLineWidth(strokeW + ink * (1.2 + CGFloat(outlineLayers) * 0.5))
            ctx.setStrokeColor(inkColor)
            ctx.strokePath()
            // Bright fill body.
            traceCheck()
            ctx.setLineWidth(strokeW)
            ctx.setStrokeColor(fillColor)
            ctx.strokePath()
            ctx.restoreGState()
            return
        }

        #if canImport(CoreText)
        // ----- WORD RUN (mood face, full per-letter typography) ---------------
        let face = str("face", "").trimmingCharacters(in: CharacterSet(charactersIn: "\""))
        let chars = Array(word)

        // Target size, then SHRINK-TO-FIT so longer words never spill the burst.
        var fontPx = minDim * CGFloat(scaleParam) * 0.92 * slamScale
        if fontPx < 1 { ctx.restoreGState(); return }

        // Build the CTFont at a size; advances measure the run (like measureText).
        func makeFont(_ px: CGFloat) -> CTFont {
            if let file = COMIC_FONT_FILES[face],
               let url = Bundle.module.url(forResource: file, withExtension: "ttf", subdirectory: "fonts"),
               let provider = CGDataProvider(url: url as CFURL),
               let cg = CGFont(provider) {
                return CTFontCreateWithGraphicsFont(cg, px, nil, nil)
            }
            // Robust fallback so the word still reads if the face is unavailable.
            return CTFontCreateWithName("Helvetica-Bold" as CFString, px, nil)
        }
        var font = makeFont(fontPx)

        // Per-char glyph + advance (the analog of ctx.measureText(ch).width).
        func glyphAndAdvance(_ ch: Character, _ f: CTFont) -> (CGGlyph, CGFloat) {
            let s = String(ch)
            var utf16 = Array(s.utf16)
            var glyphs = [CGGlyph](repeating: 0, count: utf16.count)
            CTFontGetGlyphsForCharacters(f, &utf16, &glyphs, utf16.count)
            let g = glyphs.first ?? 0
            var gg = g
            var adv = CGSize.zero
            CTFontGetAdvancesForGlyphs(f, .horizontal, &gg, &adv, 1)
            return (g, adv.width)
        }
        func trackPx(_ px: CGFloat) -> CGFloat { px * fontTracking }
        func runWidth(_ f: CTFont, _ px: CGFloat) -> CGFloat {
            var total: CGFloat = 0
            for ch in chars { total += glyphAndAdvance(ch, f).1 + trackPx(px) }
            return max(1, total - trackPx(px))
        }
        let maxW = (innerR * 1.7) / max(0.6, fontStretchX)
        var measured = runWidth(font, fontPx)
        if measured > maxW {
            fontPx *= maxW / measured
            font = makeFont(fontPx)
            measured = runWidth(font, fontPx)
        }

        let extrude = fontPx * extrudeDepth
        let inkLine = ink * (1.3 + CGFloat(outlineLayers - 1) * 0.7)
        // Vertical "middle" baseline: centre the caps on the origin (these are
        // all-caps display words), matching Canvas2D textBaseline = "middle".
        let capHeight = CTFontGetCapHeight(font)

        // Per-letter / per-shape deterministic jitter, derived from the per-fire seed
        // (web `mulberry32((comicSeed * 2654435761) >>> 0)`).
        let jrng = mulberry32(UInt32(truncatingIfNeeded: Int((comicSeed * 2654435761).rounded(.towardZero))))

        // Lay out letters individually so we can apply per-letter rotation/baseline
        // jitter (the pop-art bounce). Start at the left edge of the centred run.
        struct Letter { var glyph: CGGlyph; var x: CGFloat; var rot: CGFloat; var dy: CGFloat; var adv: CGFloat }
        var penX = -measured / 2
        var letters: [Letter] = []
        letters.reserveCapacity(chars.count)
        for ch in chars {
            let (g, wpx) = glyphAndAdvance(ch, font)
            let x = penX + wpx / 2
            penX += wpx + trackPx(fontPx)
            let rot = CGFloat((jrng() - 0.5) * 2 * letterRotJitter)
            let dy = CGFloat((jrng() - 0.5) * 2 * letterBaselineJitter) * fontPx
            _ = jrng()  // web draws a third rng() per letter (`wgt`); keep the stream aligned.
            letters.append(Letter(glyph: g, x: x, rot: rot, dy: dy, adv: wpx))
        }

        // Draw one glyph centred at the current per-letter origin, offset by (dx,dy).
        // The host flipped the context to y-DOWN (Canvas2D space); glyph paths are
        // y-UP, so flip locally just for the glyph (the layout transforms stay y-down,
        // matching the web). Fill or stroke per `strokeWidth`.
        func drawGlyph(_ l: Letter, dx: CGFloat, dy: CGFloat, color: CGColor, strokeWidth: CGFloat?) {
            guard let path = CTFontCreatePathForGlyph(font, l.glyph, nil) else { return }
            ctx.saveGState()
            ctx.translateBy(x: l.x, y: l.dy)
            ctx.rotate(by: l.rot)
            ctx.translateBy(x: dx, y: dy)
            ctx.scaleBy(x: 1, y: -1)                                   // glyph y-up → screen y-down
            ctx.translateBy(x: -l.adv / 2, y: -capHeight / 2)          // centre (textAlign/baseline)
            ctx.addPath(path)
            if let sw = strokeWidth {
                ctx.setLineWidth(sw)
                ctx.setLineJoin(round > 0.5 ? .round : .miter)
                ctx.setStrokeColor(color)
                ctx.strokePath()
            } else {
                ctx.setFillColor(color)
                ctx.fillPath()
            }
            ctx.restoreGState()
        }

        // 3D extrude / drop: stacked ink copies stepping down-right (pop-art pops).
        if extrude > 0.5 {
            let steps = 8
            for s in stride(from: steps, through: 1, by: -1) {
                let d = extrude * CGFloat(s) / CGFloat(steps)
                for l in letters { drawGlyph(l, dx: d, dy: d, color: inkColor, strokeWidth: nil) }
            }
        }

        // Bold INK contour under the fill — outlineLayers stacks fattening passes.
        for layer in stride(from: outlineLayers, through: 1, by: -1) {
            let lw = inkLine * (1 + CGFloat(layer - 1) * 0.5)
            for l in letters { drawGlyph(l, dx: 0, dy: 0, color: inkColor, strokeWidth: lw) }
        }

        // Bright FILL body on top.
        for l in letters { drawGlyph(l, dx: 0, dy: 0, color: fillColor, strokeWidth: nil) }
        #endif

        ctx.restoreGState()
    }
}
#endif
