// Heartburst — the offscreen Canvas2D PANEL, ported to Core Graphics: the
// PANEL-DRAW SEAM. This is the ONLY hand-written Swift the effect ships; the
// factory shell (`Heartburst.swift`), the resource-bundle accessor, the MSL
// shader and the uniforms glue are all GENERATED from heartburst.dope.json +
// the canonical web GLSL, and the generated factory wires this function into
// `DopePanelPassConfig(drawPanel:)`. Everything time-shaped that the SHADER
// consumes (amp/presence/beat/burst/flash) is `tempo.frame` DATA; the copies
// below exist because the panel GEOMETRY (the hero's beat swell, the burst
// flight) needs the same curves — and panel geometry is code by design.
//
// HYBRID effect: the crisp vector hearts (the big swelling HERO heart + the
// flurry of little BURST hearts that fly out) are NOT procedural in the shader —
// the web traces them as parametric heart curves into an offscreen Canvas2D
// ("panel") and the fragment shader samples that texture and adds the warm
// bloom / gloss / halftone blush / beat flash / cast light on top. The Swift
// backbone owns the panel runner (MetalOverlayHost redraws + uploads it every
// tick); this file supplies ONLY the per-effect draw, a faithful port of
// `effects/heartburst/web/src/heartburst-renderer.ts`.
//
// PANEL CHANNEL ENCODING (must match the shader exactly):
//   R = hero heart FILL   G = INK (outline) + gloss seed   B = burst hearts FILL
// The shader samples the panel at fragment texture(0), sampler(0) in a y-up vUv;
// the host flips the CGContext to a TOP-LEFT origin so this draw matches the web
// Canvas2D coordinate space verbatim (y-down, origin top-left).

#if canImport(Metal) && canImport(QuartzCore) && canImport(CoreGraphics)
import Foundation
import CoreGraphics
import DopamineCore

/// How big the hero heart reads relative to the targeted element box. The heart's
/// extent ≈ 2·heartScale·basis, so this lifts the default heartScale (~0.22) to a
/// heart ≈ 1.5× the element. Kept in sync with the web renderer.
private let HEARTBURST_TARGET_FILL: CGFloat = 3.6

// ── Draw-side tempo (the curves the panel GEOMETRY needs; the shader-facing
//    per-frame values ride `tempo.frame` in the `.dope`). ──

/// Fraction of life occupied by the lub-dub beat phase before the burst.
private let HEARTBEAT_PHASE: Double = 0.3

/// A single soft beat pulse centred at `center` (in life units) with half-width
/// `width`: rises fast, eases back down. Returns 0..1 (peak 1 at `center`).
private func beatPulse(_ t: Double, _ center: Double, _ width: Double) -> Double {
    let x = (t - center) / width
    if x <= -1 || x >= 1 { return 0 }
    let lobe = 0.5 + 0.5 * cos(x * Double.pi)
    return x < 0 ? pow(lobe, 0.7) : pow(lobe, 1.4)
}

/// Heart SCALE multiplier over normalized life (resting 1.0 + the lub-dub).
private func heartbeatScale(_ life: Double, strength: Double, doubleBeat: Double) -> Double {
    let t = tempoClamp01(life)
    let lub = beatPulse(t, 0.1, 0.1)
    let dub = beatPulse(t, 0.21, 0.075) * 0.62 * tempoClamp01(doubleBeat)
    let beat = max(lub, dub)
    let sag = t > HEARTBEAT_PHASE ? 0.06 * easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE)) : 0
    return 1 + beat * 0.42 * strength - sag
}

/// Burst progress 0..1 over the post-beat phase.
private func burstProgress(_ life: Double) -> Double {
    let t = tempoClamp01(life)
    if t <= HEARTBEAT_PHASE { return 0 }
    return easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE))
}

/// Overall panel presence: a quick snap-in, a proud hold, a clean tail fade.
private func heartPresence(_ life: Double) -> Double {
    let t = tempoClamp01(life)
    if t < 0.04 { return t / 0.04 }
    if t < 0.8 { return 1 }
    let fade = 1 - (t - 0.8) / 0.2
    return pow(max(0, fade), 1.4)
}

/// The per-frame panel draw the GENERATED factory wires into
/// `DopePanelPassConfig(drawPanel:)`. LIVE pose, redrawn every frame by the
/// host (mirrors the web panel runner): the panel fades in/out with presence,
/// the hero swells on the lub-dub beat, and the little hearts fly outward as
/// the burst progresses.
public func drawHeartburstPanel(
    _ ctx: CGContext, sizePx: CGSize, params: [String: DopeValue], frame: PanelFrame
) {
    let w = sizePx.width, h = sizePx.height
    guard w > 1, h > 1 else { return }
    let life = frame.life

    func num(_ k: String, _ d: Double) -> Double {
        if case let .number(v)? = params[k] { return v }; return d
    }
    let seedParam    = num("heartburstSeed", 0)
    let heartScale   = num("heartScale", 0.22)
    let burstCount   = num("burstCount", 14)
    let burstSpread  = num("burstSpread", 0.4)
    let inkWeight    = num("inkWeight", 3)
    let beatStrength = num("beatStrength", 1)
    let doubleBeat   = num("doubleBeat", 1)

    // The web additive compositing keeps the R/G/B channel masks independent.
    ctx.setBlendMode(.plusLighter)

    // Position the hearts on the targeted element (centre) and size them to its
    // box, so the centrepiece matches the page element instead of the canvas.
    // Defaults (centre, full canvas) reproduce the old screen-centred pose.
    let cx = frame.centerPx.x, cy = frame.centerPx.y
    // The centrepiece should read at ~150% of the targeted element (not a small
    // fraction of it), so scale the sizing basis up — but clamp to the canvas so a
    // full-page fire (target == canvas) keeps its original size. `heartScale`
    // (~0.22) then gives a hero heart whose extent ≈ 1.5× the element box. TUNABLE.
    let minDim = min(min(frame.targetPx.width, frame.targetPx.height) * HEARTBURST_TARGET_FILL, min(w, h))
    // The web rng seeds from (heartburstSeed * 1000) >>> 0.
    let rng = mulberry32(UInt32(truncatingIfNeeded: Int((seedParam * 1000).rounded(.towardZero))))

    let dpr: CGFloat = 1.0   // host re-rasterizes at the device size already.
    let ink = max(1, CGFloat(inkWeight) * dpr)

    let presence = CGFloat(heartPresence(life))
    if presence <= 0.001 { return }   // cleared frame (web early-out)
    let heartScaleMul = CGFloat(heartbeatScale(life, strength: beatStrength, doubleBeat: doubleBeat))
    let b = CGFloat(burstProgress(life))

    // ---- Parametric heart trace (classic 16 sin³ curve, cusp UP) ----------
    // Matches heartburst-renderer.ts `traceHeart` exactly. `s` is the half-size.
    func traceHeart(_ s: CGFloat, _ rot: CGFloat) {
        let steps = 48
        ctx.beginPath()
        for i in 0 ... steps {
            let t = (CGFloat(i) / CGFloat(steps)) * .pi * 2
            let x = 16 * pow(sin(t), 3)
            let y = 13 * cos(t) - 5 * cos(2 * t) - 2 * cos(3 * t) - cos(4 * t)
            let nx = (x / 17) * s
            let ny = (-y / 17) * s       // flip Y so lobes are at the top (canvas y-down).
            let px = nx * cos(rot) - ny * sin(rot)
            let py = nx * sin(rot) + ny * cos(rot)
            if i == 0 { ctx.move(to: CGPoint(x: px, y: py)) }
            else { ctx.addLine(to: CGPoint(x: px, y: py)) }
        }
        ctx.closePath()
    }

    // ---------- HERO HEART (R fill, G outline + gloss seed) --------------
    let heroS = minDim * CGFloat(heartScale) * heartScaleMul
    let tilt = CGFloat((seedParam.truncatingRemainder(dividingBy: 1)) - 0.5) * 0.12
    // As the burst takes over the hero shrinks a touch (web heroPresence).
    let heroPresence = presence * (1 - 0.65 * b)

    ctx.saveGState()
    ctx.translateBy(x: cx, y: cy)
    if heroPresence > 0.002 {
        let heroFillA = heroPresence   // 0..1 channel value.
        // FILL -> RED.
        traceHeart(heroS, tilt)
        ctx.setFillColor(red: heroFillA, green: 0, blue: 0, alpha: 1)
        ctx.fillPath()
        // OUTLINE -> GREEN.
        traceHeart(heroS, tilt)
        ctx.setLineJoin(.round)
        ctx.setLineWidth(ink * 1.6)
        ctx.setStrokeColor(red: 0, green: heroFillA, blue: 0, alpha: 1)
        ctx.strokePath()
        // GLOSS SEED -> GREEN, clipped to the heart (upper-left lobe). The shader
        // reads ink∩fill as the specular highlight.
        ctx.saveGState()
        traceHeart(heroS, tilt)
        ctx.clip()
        let gx = -heroS * 0.34, gy = -heroS * 0.42, gr = heroS * 0.42
        let cs = CGColorSpaceCreateDeviceRGB()
        let solid: [CGFloat] = [0, heroFillA, 0, 1]
        let clear: [CGFloat] = [0, 0, 0, 0]
        let cols = [
            CGColor(colorSpace: cs, components: solid)!,
            CGColor(colorSpace: cs, components: clear)!,
        ] as CFArray
        let locs: [CGFloat] = [0, 1]
        if let grad = CGGradient(colorsSpace: cs, colors: cols, locations: locs) {
            ctx.drawRadialGradient(grad, startCenter: CGPoint(x: gx, y: gy), startRadius: 0,
                                   endCenter: CGPoint(x: gx, y: gy), endRadius: gr, options: [])
        }
        ctx.restoreGState()
    }
    ctx.restoreGState()

    // ---------- BURST HEARTS (B fill) ------------------------------------
    if b > 0.001 {
        let count = max(0, Int(burstCount.rounded()))
        let maxDist = minDim * CGFloat(burstSpread)
        for i in 0 ..< count {
            // deterministic per-heart launch params (web order: ang, speed, spin,
            // littleS, stagger — the rng pulls MUST stay in this order for parity).
            let ang = (CGFloat(i) / CGFloat(max(1, count))) * .pi * 2 + (CGFloat(rng()) - 0.5) * 0.9
            let speed = 0.55 + CGFloat(rng()) * 0.45
            let spin = (CGFloat(rng()) - 0.5) * 2.0
            let littleS = minDim * (0.035 + CGFloat(rng()) * 0.04) * CGFloat(heartScale) * 1.6
            let stagger = CGFloat(rng()) * 0.25
            let lp = max(0, min(1, (b - stagger) / (1 - stagger)))
            if lp <= 0 { continue }
            let dist = maxDist * speed * lp
            let arc = minDim * 0.10 * speed * (lp - lp * lp) * 4.0
            let px = cx + cos(ang) * dist
            let py = cy + sin(ang) * dist - arc
            let fade = 1 - pow(lp, 2.2)
            if fade <= 0.01 { continue }
            let a = presence * fade
            let s = littleS * (0.6 + 0.4 * (1 - lp))
            ctx.saveGState()
            ctx.translateBy(x: px, y: py)
            traceHeart(s, spin * lp * .pi)
            ctx.setFillColor(red: 0, green: 0, blue: a, alpha: 1)
            ctx.fillPath()
            ctx.restoreGState()
        }
    }
}
#endif
