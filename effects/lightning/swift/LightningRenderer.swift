// Lightning bolt geometry precompute — port of `lightning-renderer.ts`.
//
// PERFORMANCE PARITY with web + android: the original analytic Metal shader
// re-derived every bolt vertex with TWO 4-octave fbm calls per segment AT EVERY
// PIXEL (~220 fbm/pixel) + a 9-tap shadow re-walk. The bolt polyline is
// fragment-INDEPENDENT, so — exactly as the web/android rework does — it is now
// computed ONCE per frame here (a faithful port of the shared fbm/hash +
// `boltPoint`) and fed to the shader as the `uVerts` / `uBoltMeta` fragment-buffer
// arrays via DopamineCore's `frameArrays` seam. The shader keeps the exact
// inverse-distance plasma glow; only the per-pixel cost moved off the hot path.
//
// PURE Swift (no Metal) so it compiles on Linux too (the portable half), like the
// bespoke tempo. Output is gl_FragCoord space (device px, y-UP) to match the shader.

import Foundation

/// Polyline segment count of the main bolt (and forks). More = jaggier arc.
let LIGHTNING_BOLT_SEGS = 14
/// Main trunk + MAX_FORKS(7) forks.
let LIGHTNING_MAX_BOLTS = 8
/// Vertices stored per bolt (BOLT_SEGS + 1).
let LIGHTNING_VPB = 15
/// Max secondary forks (matches the `.metal` #define + the `.dope` clamp).
let LIGHTNING_MAX_FORKS = 7

private func clampD(_ x: Double, _ lo: Double, _ hi: Double) -> Double { x < lo ? lo : (x > hi ? hi : x) }
private func clamp01D(_ x: Double) -> Double { x < 0 ? 0 : (x > 1 ? 1 : x) }
private func smoothstepD(_ e0: Double, _ e1: Double, _ x: Double) -> Double {
    let t = clamp01D((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)
}
private func fractD(_ x: Double) -> Double { x - floor(x) }
private func mixD(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * t }

// --- Faithful port of the shared look/glsl hash + value-noise fbm -------------
private func hash11(_ p0: Double) -> Double {
    var p = fractD(p0 * 0.1031)
    p *= p + 33.33
    p *= p + p
    return fractD(p)
}
private func hash21x(_ p: Double) -> Double {
    var x = fractD(p * 0.1031), y = fractD(p * 0.103), z = fractD(p * 0.0973)
    let d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33)
    x += d; y += d; z += d
    return fractD((x + y) * z)
}
private func hash21(_ p: Double) -> (x: Double, y: Double) {
    var x = fractD(p * 0.1031), y = fractD(p * 0.103), z = fractD(p * 0.0973)
    let d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33)
    x += d; y += d; z += d
    return (fractD((x + y) * z), fractD((x + z) * y))
}
private func vnoise(_ x: Double, _ y: Double) -> Double {
    let ix = floor(x), iy = floor(y)
    let fx = x - ix, fy = y - iy
    let ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
    let a = hash11(ix * 1 + iy * 57)
    let b = hash11((ix + 1) * 1 + iy * 57)
    let c = hash11(ix * 1 + (iy + 1) * 57)
    let d = hash11((ix + 1) * 1 + (iy + 1) * 57)
    return mixD(mixD(a, b, ux), mixD(c, d, ux), uy)
}
private func fbm(_ x0: Double, _ y0: Double) -> Double {
    var s = 0.0, a = 0.5
    var x = x0, y = y0
    for _ in 0 ..< 4 {
        s += a * vnoise(x, y)
        let nx = (0.8 * x + 0.6 * y) * 2.03
        let ny = (-0.6 * x + 0.8 * y) * 2.03
        x = nx; y = ny; a *= 0.5
    }
    return s
}

private struct V2 { var x: Double; var y: Double }

/// Port of the shader `boltPoint`: a jagged vertex at t along A→B.
private func boltPoint(_ A: V2, _ B: V2, _ t: Double, _ seedOff: Double, _ seed: Double, _ jagged: Double, _ beat: Double) -> V2 {
    let dx = B.x - A.x, dy = B.y - A.y
    let len = max(hypot(dx, dy), 1)
    let dirx = dx / len, diry = dy / len
    let nrmx = -diry, nrmy = dirx
    let n = fbm(t * 6 + seedOff + seed, beat * 0.5) - 0.5
    let fine = fbm(t * 22 + seedOff * 3.1 + seed, beat) - 0.5
    let taper = sin(t * Double.pi)
    let off = (n * 1.6 + fine * 0.5) * jagged * len * 0.16 * taper
    return V2(x: A.x + dirx * (t * len) + nrmx * off, y: A.y + diry * (t * len) + nrmy * off)
}

/// Write up to BOLT_SEGS+1 vertices of the drawn (0..drawn) polyline A→B into
/// `verts` at bolt slot `b`; returns the segment count (points-1).
private func writeBolt(_ verts: inout [Float], _ b: Int, _ A: V2, _ B: V2, _ drawn: Double,
                       _ seedOff: Double, _ seed: Double, _ jagged: Double, _ beat: Double) -> Int {
    let base = b * LIGHTNING_VPB
    var last = 0
    let v0 = boltPoint(A, B, 0, seedOff, seed, jagged, beat)
    verts[(base + 0) * 2] = Float(v0.x)
    verts[(base + 0) * 2 + 1] = Float(v0.y)
    for i in 1 ... LIGHTNING_BOLT_SEGS {
        let t = Double(i) / Double(LIGHTNING_BOLT_SEGS)
        if t - 1.0 / Double(LIGHTNING_BOLT_SEGS) > drawn { break }
        let tc = Swift.min(t, drawn)
        let v = boltPoint(A, B, tc, seedOff, seed, jagged, beat)
        verts[(base + i) * 2] = Float(v.x)
        verts[(base + i) * 2 + 1] = Float(v.y)
        last = i
    }
    return last
}

/// Compute the bolt polyline (trunk + forks) for this frame, in gl_FragCoord space
/// (device px, y-up). Returns the flat `verts` (MAX_BOLTS*VPB*2) + `meta`
/// (MAX_BOLTS*4 = segCount, radFrac, fadeMul, isMain) the shader reads.
public func computeLightningArrays(
    style: Double, thickness: Double, jagged: Double, branches: Double, boltSeed: Double,
    width: Double, height: Double, originX: Double, originY: Double,
    elapsedMs: Double, life: Double
) -> (verts: [Float], meta: [Float]) {
    var verts = [Float](repeating: 0, count: LIGHTNING_MAX_BOLTS * LIGHTNING_VPB * 2)
    var meta = [Float](repeating: 0, count: LIGHTNING_MAX_BOLTS * 4)
    let strike = strikeProgress(elapsedMs)
    if strike <= 0 { return (verts, meta) }

    let seed = boltSeed
    let beat = floor((elapsedMs / 1000) * 12) * style

    // Strike geometry: from near the top edge (biased toward the strike x) down to
    // the strike point. gl coords y-up: top edge is y ≈ height.
    let jx = (hash21x(seed * 1.7) - 0.5) * width * 0.5
    let A = V2(x: clampD(originX + jx, width * 0.12, width * 0.88), y: height * 1.02)
    let B = V2(x: originX, y: originY)

    // MAIN BOLT (slot 0).
    let mainSegs = writeBolt(&verts, 0, A, B, strike, 0, seed, jagged, beat)
    meta[0] = Float(mainSegs); meta[1] = Float(thickness); meta[2] = 1.0; meta[3] = 1.0

    // FORKS (slots 1..).
    let forks = max(0, Swift.min(LIGHTNING_MAX_FORKS, Int(branches.rounded())))
    let dlen = max(hypot(B.x - A.x, B.y - A.y), 1)
    let dirx = (B.x - A.x) / dlen, diry = (B.y - A.y) / dlen
    let nrmx = -diry, nrmy = dirx
    let forkFade = 0.6 + 0.4 * (1 - smoothstepD(0.5, 1.0, life))
    for i in 0 ..< forks {
        let b = 1 + i
        let hh = hash21(Double(i) * 9.7 + seed + 3)
        let launchT = 0.18 + hh.x * 0.62
        if strike < launchT { meta[b * 4] = 0; continue }
        let forkA = boltPoint(A, B, launchT, 0, seed, jagged, beat)
        let ang = (hh.y - 0.5) * 2.2
        let reach = (0.18 + hh.x * 0.22) * dlen
        let ex = dirx * (0.5 + hh.y) + nrmx * ang
        let ey = diry * (0.5 + hh.y) + nrmy * ang
        let forkB = V2(x: forkA.x + ex * reach, y: forkA.y + ey * reach)
        let forkDrawn = clampD((strike - launchT) / max(1 - launchT, 0.05), 0, 1)
        let segs = writeBolt(&verts, b, forkA, forkB, forkDrawn, Double(i) * 17 + 5, seed, jagged, beat)
        meta[b * 4] = Float(segs); meta[b * 4 + 1] = Float(thickness * 0.6); meta[b * 4 + 2] = Float(forkFade); meta[b * 4 + 3] = 0
    }

    return (verts, meta)
}
