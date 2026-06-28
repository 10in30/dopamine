// Confetti — the offscreen Canvas2D PANEL, ported to Core Graphics: the
// PANEL-DRAW SEAM. This is the ONLY hand-written Swift the effect ships; the
// factory shell (`Confetti.swift`), the resource-bundle accessor, the MSL
// shader and the uniforms glue are all GENERATED from confetti.dope.json + the
// canonical web GLSL, and the generated factory wires this function into
// `DopePanelPassConfig(drawPanel:)`. Everything time-shaped that the SHADER
// consumes (amp) is `tempo.frame` DATA; the per-piece poses below are panel
// GEOMETRY (the ballistic launch-then-fall) — code by design.
//
// HYBRID effect: the crisp paper pieces (spinning rectangles + a few petals)
// are NOT procedural in the shader — the web traces them into an offscreen
// Canvas2D ("panel") and the fragment shader samples that texture and applies
// the global gain (amp · exposure), ACES tonemap, the cel posterize toward the
// whimsy end, an ordered dither, and the soft cast shadow. The Swift backbone
// owns the panel runner (MetalOverlayHost redraws + uploads it every tick);
// this file supplies ONLY the per-effect draw, a faithful port of
// `effects/confetti/web/src/confetti-renderer.ts`.
//
// PANEL CHANNEL ENCODING (must match the shader exactly):
//   RGB = Σ per-piece LIT colour (palette × paper/cel shading), pre-multiplied
//         by the piece's lifetime fade, accumulated ADDITIVELY across pieces.
// The shader samples the panel at fragment texture(0), sampler(0) in a y-up vUv;
// the host flips the CGContext to a TOP-LEFT origin so this draw matches the web
// Canvas2D coordinate space verbatim (y-down, origin top-left).

#if canImport(Metal) && canImport(QuartzCore) && canImport(CoreGraphics)
import Foundation
import CoreGraphics
import DopamineCore

/// Max confetti pieces — the panel loop bound, the single source of truth shared
/// with the `.dope` integer clamp (`render.consts.MAX_PIECES`) + the web
/// `MAX_PIECES`. Counts above this won't render.
private let CONFETTI_MAX_PIECES = 120

private let TAU: Double = .pi * 2

private func clamp01(_ x: Double) -> Double { x < 0 ? 0 : (x > 1 ? 1 : x) }
private func mix(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
private func fract(_ x: Double) -> Double { x - x.rounded(.down) }
private func smoothstep(_ e0: Double, _ e1: Double, _ x: Double) -> Double {
    let t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
}

/// paletteMix from the look lib: a two-segment lerp across the three stops.
private func paletteMix(_ pal: [RGB], _ tIn: Double) -> RGB {
    let t = clamp01(tIn)
    guard pal.count >= 3 else { return pal.first ?? RGB(r: 1, g: 1, b: 1) }
    let c0 = pal[0], c1 = pal[1], c2 = pal[2]
    if t < 0.5 {
        let k = t * 2
        return RGB(r: mix(c0.r, c1.r, k), g: mix(c0.g, c1.g, k), b: mix(c0.b, c1.b, k))
    }
    let k = (t - 0.5) * 2
    return RGB(r: mix(c1.r, c2.r, k), g: mix(c1.g, c2.g, k), b: mix(c1.b, c2.b, k))
}

/// The per-frame panel draw the GENERATED factory wires into
/// `DopePanelPassConfig(drawPanel:)`. LIVE pose, redrawn every frame by the host
/// (mirrors the web panel runner): a flurry of paper pieces launch upward then
/// tumble down under gravity with air-drag flutter + spin, lit by the palette.
public func drawConfettiPanel(
    _ ctx: CGContext, sizePx: CGSize, params: [String: DopeValue], frame: PanelFrame
) {
    let w = sizePx.width, h = sizePx.height
    guard w > 1, h > 1 else { return }
    let life = frame.life
    if life <= 0 || life >= 1 { return }   // cleared frame (web early-out)

    func num(_ k: String, _ d: Double) -> Double {
        if case let .number(v)? = params[k] { return v }; return d
    }
    var palette: [RGB] = []
    if case let .palette(p)? = params["palette"] { palette = p }

    let seedParam   = num("pieceSeed", 0)
    let pieceCount  = num("pieceCount", 60)
    let spread      = num("spread", 0.5)
    let launchSpeed = num("launchSpeed", 1)
    let gravity     = num("gravity", 0.9)
    let flutter     = num("flutter", 0.85)
    let pieceSize   = num("pieceSize", 1)
    let spin        = num("spin", 1)
    let style       = num("style", 0)

    let minDim = Double(min(w, h))
    let count = max(0, min(CONFETTI_MAX_PIECES, Int(pieceCount.rounded())))
    // The web rng seeds from ((pieceSeed * 1000) >>> 0) + 1.
    let rng = mulberry32(UInt32(truncatingIfNeeded: Int((seedParam * 1000).rounded(.towardZero))) &+ 1)

    // The web additive compositing keeps the per-piece colour masks accumulating.
    ctx.setBlendMode(.plusLighter)

    let cx = Double(frame.centerPx.x), cy = Double(frame.centerPx.y)

    for _ in 0 ..< count {
        // Five per-piece randoms in a fixed order (≈ the GLSL hash21/hash11 draws).
        let hx = rng(), hy = rng(), h2x = rng(), h2y = rng(), h3 = rng()

        // Spawn stagger: most pieces fire in the first ~12%, renormalized to a full arc.
        let delay = h2x * 0.12
        let pl = clamp01((life - delay) / (1 - delay))
        if pl <= 0 || pl >= 1 { continue }

        // Launch direction (y-up local frame): a mostly-up cone fanned by spread.
        let fan = (hx - 0.5) * 2
        let dlen = (pow(fan * (0.35 + spread), 2) + 1.0).squareRoot()
        let dirx = (fan * (0.35 + spread)) / dlen
        let diry = 1.0 / dlen
        let speed = (0.85 + hy * 0.6) * launchSpeed * minDim * 1.15
        let grav = (0.9 + h3 * 0.4) * gravity * minDim * 1.5

        // Ballistic arc: up, then down under gravity (y-up).
        var px = dirx * speed * pl
        let py = diry * speed * pl - grav * pl * pl

        // Air-drag flutter: a growing sideways sway as the piece slows + falls.
        let swayPhase = hx * TAU + h2y * 3.0
        let swayFreq = 3.0 + h2x * 4.0
        let fallT = smoothstep(0.12, 0.7, pl)
        let swayAmp = flutter * minDim * 0.06 * (0.4 + fallT)
        let sway =
            sin(pl * swayFreq + swayPhase) * swayAmp +
            sin(pl * swayFreq * 0.37 + swayPhase * 1.7) * swayAmp * 0.4
        px += sway

        // Spin + face-flash (wide/bright face-on, dim edge-on).
        let spinRate = (3.0 + h3 * 6.0) * spin
        let rot = pl * spinRate * TAU + swayPhase
        let flip = abs(cos(rot * 0.5 + sway * 0.02))
        let face = mix(0.18, 1.0, flip)

        // Paper shape: rectangles + a few petals, foreshortened by the face angle.
        let aspect = mix(0.5, 1.6, h2y)
        let s = minDim * 0.011 * pieceSize * (0.7 + hy * 0.7)
        let fore = mix(1.0, face, 0.65)
        let heX = max(s * aspect * fore, 0.5)
        let heY = max(s * fore, 0.5)
        let hue = fract(h2y * 0.9 + h3 * 0.31)
        let petal = h3 >= 0.78

        // Per-piece lit colour (paper shading ↔ flat cel), pre-multiplied by fade.
        let base = paletteMix(palette, hue)
        let shade = mix(0.45, 1.15, face)
        let spec = smoothstep(0.85, 1.0, face) * 0.5
        let celK: Double = face >= 0.5 ? 1 : 0
        let celShade = mix(0.55, 1.1, celK)
        let fade = (1 - pow(pl, 1.4)) * smoothstep(0.0, 0.08, pl)
        func lit(_ c: Double) -> Double {
            let paper = c * shade + spec
            let cel = c * celShade
            return clamp01(mix(paper, cel, style)) * fade
        }
        let r = lit(base.r), g = lit(base.g), bl = lit(base.b)
        if r + g + bl <= 0 { continue }

        // Place in canvas space (flip y: local y-up → canvas y-down).
        let drawX = cx + px
        let drawY = cy - py

        ctx.saveGState()
        ctx.translateBy(x: CGFloat(drawX), y: CGFloat(drawY))
        ctx.rotate(by: CGFloat(rot))
        ctx.setFillColor(red: CGFloat(r), green: CGFloat(g), blue: CGFloat(bl), alpha: 1)
        if petal {
            ctx.addEllipse(in: CGRect(
                x: CGFloat(-heX * 1.05), y: CGFloat(-heY * 1.05),
                width: CGFloat(heX * 2.1), height: CGFloat(heY * 2.1)))
            ctx.fillPath()
        } else {
            let rad = CGFloat(min(heX, heY) * 0.5)
            let rect = CGRect(x: CGFloat(-heX), y: CGFloat(-heY), width: CGFloat(heX * 2), height: CGFloat(heY * 2))
            let path = CGPath(roundedRect: rect, cornerWidth: rad, cornerHeight: rad, transform: nil)
            ctx.addPath(path)
            ctx.fillPath()
        }
        ctx.restoreGState()
    }
}
#endif
