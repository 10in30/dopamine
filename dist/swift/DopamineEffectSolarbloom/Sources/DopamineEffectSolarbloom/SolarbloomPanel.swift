// Solarbloom — the drifting-motes SPRITE PANEL, ported to Core Graphics: the
// PANEL-DRAW SEAM. This is the ONLY hand-written Swift the effect ships; the
// factory shell (`Solarbloom.swift`), the resource-bundle accessor, the MSL
// shader and the uniforms glue are all GENERATED from solarbloom.dope.json +
// the canonical web GLSL, and the generated factory wires this function into
// `DopeSpritePanelPassConfig(drawPanel:)`.
//
// PASS HYBRID (not a panel-KIND effect): the volumetric bloom + the checkmark
// stay PROCEDURAL in the shader; only the sparse drifting light "motes" are a
// sprite layer — rasterized into an offscreen panel ONCE per frame (each mote's
// pose + lit colour + streak + twinkle computed here) and sampled by the shader
// (`uMotePanel`, bound at texture(3) — leaving texture(1) for the baked-✓ SDF).
// The motes used to be an 80-iteration loop AT EVERY pixel (the dominant
// software-WebGL cost); moving them to this panel keeps the shader cheap. A
// faithful port of `effects/solarbloom/web/src/solarbloom-renderer.ts`.
//
// PANEL CHANNEL ENCODING (must match the shader exactly):
//   RGB = Σ(per-mote lit colour × sprite falloff × fade × twinkle), additively
//   accumulated (the shader multiplies by the bloom gain). The host flips the
//   CGContext to a TOP-LEFT origin so this draw matches the web Canvas2D space.

#if canImport(Metal) && canImport(QuartzCore) && canImport(CoreGraphics)
import Foundation
import CoreGraphics
import DopamineCore

private let TAU = Double.pi * 2

private func clamp01(_ x: Double) -> Double { x < 0 ? 0 : (x > 1 ? 1 : x) }
private func mix(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }
private func smoothstep01(_ e0: Double, _ e1: Double, _ x: Double) -> Double {
    let t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
}

/// `paletteMix(t)` over the three RGB stops — the exact web renderer mix.
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

/// The per-frame sprite-panel draw the GENERATED factory wires into
/// `DopeSpritePanelPassConfig(drawPanel:)`. LIVE pose, redrawn every frame by
/// the host (mirrors the web panel runner): each mote drifts outward + floats up
/// + curls, depth-layered, with a velocity-aligned motion-blur streak and a
/// per-mote twinkle that needs the seconds clock (`frame.elapsedMs / 1000`).
public func drawSolarbloomPanel(
    _ ctx: CGContext, sizePx: CGSize, params: [String: DopeValue], frame: PanelFrame
) {
    let w = Double(sizePx.width), h = Double(sizePx.height)
    guard w > 1, h > 1 else { return }

    func num(_ k: String, _ d: Double) -> Double {
        if case let .number(v)? = params[k] { return v }; return d
    }
    let palette: [RGB] = {
        if case let .palette(p)? = params["palette"] { return p }
        return []
    }()
    let bloomRadius = num("bloomRadius", 0.7)
    let turbulence = num("turbulence", 0.6)
    let moteSpeed = num("moteSpeed", 0.85)
    let moteCount = num("moteCount", 48)
    let moteSeed = num("moteSeed", 0)

    let life = frame.life
    let timeS = frame.elapsedMs / 1000

    let minDim = min(w, h)
    let r = bloomRadius * minDim
    let count = max(0, Int(moteCount.rounded()))
    // The web rng seeds from ((moteSeed * 1000) >>> 0) + 7 — match it byte-for-byte.
    let seedU = UInt32(truncatingIfNeeded: Int(moteSeed * 1000)) &+ 7
    let rng = mulberry32(seedU)

    // The web uses `globalCompositeOperation = "lighter"` (additive). CG's
    // .plusLighter composites premultiplied source over destination additively.
    ctx.setBlendMode(.plusLighter)

    let cx = Double(frame.centerPx.x), cy = Double(frame.centerPx.y)

    for _ in 0 ..< count {
        let hx = rng(), hy = rng(), h2x = rng(), h2y = rng(), delayR = rng()
        let a0 = hx * TAU
        let spd = 0.5 + hy
        let delay = delayR * 0.15
        let ml = clamp01((life - delay) / (1 - delay))
        if ml <= 0 { continue }

        let near = h2x >= 0.66 ? 1.0 : 0.0
        let depth = mix(0.7, 1.4, near)
        let dirx = cos(a0), diry = sin(a0)
        let travel = ml * spd * moteSpeed * r * 1.3 * depth
        // y-up local frame (buoyancy floats upward = +y).
        var px = dirx * travel
        var py = diry * travel + ml * ml * r * 0.5
        let t1 = a0 * 3.0 + ml * TAU * spd
        px += sin(t1) * turbulence * r * 0.3 * ml
        py += cos(t1 * 0.8 + a0) * turbulence * r * 0.3 * ml

        // Velocity → motion-blur streak direction + amount (matches the shader).
        let velx = dirx * spd * moteSpeed * 1.3 * depth + cos(t1) * turbulence * 0.3
        let vely = diry * spd * moteSpeed * 1.3 * depth + 2.0 * ml * 0.5 - sin(t1 * 0.8 + a0) * turbulence * 0.3
        let vlen = max(1e-4, (velx * velx + vely * vely).squareRoot())
        let streak = clamp01(vlen * 0.12) * smoothstep01(0, 0.25, ml) * 0.65

        let size = minDim * 0.006 * (0.6 + hx * 0.8) * depth
        let twinkle = 0.75 + 0.25 * sin(timeS * (6.0 + h2y * 10.0) + hx * TAU)
        let fade = (1 - pow(ml, 1.3)) * smoothstep01(0, 0.08, ml)
        let amp = fade * twinkle * 1.2 * mix(0.9, 1.3, near)
        if amp <= 0.001 { continue }
        let base = paletteMix(palette, hy)
        let cr = clamp01(base.r * amp)
        let cg = clamp01(base.g * amp)
        let cb = clamp01(base.b * amp)
        if cr + cg + cb <= 0 { continue }

        // Canvas position (flip y-up → y-down).
        let pcx = cx + px
        let pcy = cy - py
        let ang = atan2(vely, velx)
        let stretch = 1 / (1 - streak)
        let rad = max(size * 3, 1.5)

        ctx.saveGState()
        ctx.translateBy(x: CGFloat(pcx), y: CGFloat(pcy))
        ctx.rotate(by: CGFloat(ang))
        ctx.scaleBy(x: CGFloat(stretch), y: 1)
        // A soft radial sprite: solid core → 35% mid → transparent rim (the web's
        // 3-stop radial gradient). Draw it as a filled clip with a CG gradient.
        let cs = CGColorSpaceCreateDeviceRGB()
        let cols = [
            CGColor(colorSpace: cs, components: [CGFloat(cr), CGFloat(cg), CGFloat(cb), 1])!,
            CGColor(colorSpace: cs, components: [CGFloat(cr), CGFloat(cg), CGFloat(cb), 0.35])!,
            CGColor(colorSpace: cs, components: [0, 0, 0, 0])!,
        ] as CFArray
        let locs: [CGFloat] = [0, 0.4, 1]
        if let grad = CGGradient(colorsSpace: cs, colors: cols, locations: locs) {
            ctx.drawRadialGradient(
                grad,
                startCenter: .zero, startRadius: 0,
                endCenter: .zero, endRadius: CGFloat(rad),
                options: [])
        }
        ctx.restoreGState()
    }
}
#endif
