// Lightning bolt geometry precompute — faithful port of `lightning-renderer.ts`.
//
// The bolt polyline (trunk + forks) is fragment-INDEPENDENT, so it is computed
// ONCE per frame on the CPU here (a port of the shared fbm/hash + the shader's
// `boltPoint`) and fed to the shader as the `uVerts` / `uBoltMeta` uniform arrays
// (via the backbone's `frameArrays` seam). The shader keeps the exact original
// inverse-distance plasma glow. Output is gl_FragCoord space (device px, y-UP).
//
// Note: these CPU hash/fbm are intentionally the JS port's own (NOT the GLSL
// `Look` chunks) — they reproduce the GLSL noise on the CPU so the precomputed
// polyline matches what the per-pixel shader would have derived.

package ai.dopamine.effect.lightning

import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.hypot
import kotlin.math.sin

private fun clamp(x: Double, lo: Double, hi: Double): Double = if (x < lo) lo else if (x > hi) hi else x
private fun clamp01(x: Double): Double = if (x < 0.0) 0.0 else if (x > 1.0) 1.0 else x
private fun smoothstep(e0: Double, e1: Double, x: Double): Double {
    val t = clamp01((x - e0) / (e1 - e0))
    return t * t * (3.0 - 2.0 * t)
}
private fun fract(x: Double): Double = x - floor(x)
private fun mix(a: Double, b: Double, t: Double): Double = a + (b - a) * t

// --- Faithful port of the shared look/glsl hash + value-noise fbm -------------
private fun hash11(p0: Double): Double {
    var p = fract(p0 * 0.1031)
    p *= p + 33.33
    p *= p + p
    return fract(p)
}
private fun hash21x(p: Double): Double {
    var x = fract(p * 0.1031); var y = fract(p * 0.103); var z = fract(p * 0.0973)
    val d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33)
    x += d; y += d; z += d
    return fract((x + y) * z)
}
private class V2(val x: Double, val y: Double)
private fun hash21(p: Double): V2 {
    var x = fract(p * 0.1031); var y = fract(p * 0.103); var z = fract(p * 0.0973)
    val d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33)
    x += d; y += d; z += d
    return V2(fract((x + y) * z), fract((x + z) * y))
}
private fun vnoise(x: Double, y: Double): Double {
    val ix = floor(x); val iy = floor(y)
    val fx = x - ix; val fy = y - iy
    val ux = fx * fx * (3.0 - 2.0 * fx); val uy = fy * fy * (3.0 - 2.0 * fy)
    val a = hash11(ix * 1.0 + iy * 57.0)
    val b = hash11((ix + 1.0) * 1.0 + iy * 57.0)
    val c = hash11(ix * 1.0 + (iy + 1.0) * 57.0)
    val d = hash11((ix + 1.0) * 1.0 + (iy + 1.0) * 57.0)
    return mix(mix(a, b, ux), mix(c, d, ux), uy)
}
private fun fbm(x0: Double, y0: Double): Double {
    var x = x0; var y = y0; var s = 0.0; var a = 0.5
    for (i in 0 until 4) {
        s += a * vnoise(x, y)
        val nx = (0.8 * x + 0.6 * y) * 2.03
        val ny = (-0.6 * x + 0.8 * y) * 2.03
        x = nx; y = ny; a *= 0.5
    }
    return s
}

/** Port of the shader boltPoint: a jagged vertex at t along A→B. */
private fun boltPoint(ax: Double, ay: Double, bx: Double, by: Double, t: Double, seedOff: Double, seed: Double, jagged: Double, beat: Double): V2 {
    val dx = bx - ax; val dy = by - ay
    val len = maxOf(hypot(dx, dy), 1.0)
    val dirx = dx / len; val diry = dy / len
    val nrmx = -diry; val nrmy = dirx
    val n = fbm(t * 6.0 + seedOff + seed, beat * 0.5) - 0.5
    val fine = fbm(t * 22.0 + seedOff * 3.1 + seed, beat) - 0.5
    val taper = sin(t * PI)
    val off = (n * 1.6 + fine * 0.5) * jagged * len * 0.16 * taper
    return V2(ax + dirx * (t * len) + nrmx * off, ay + diry * (t * len) + nrmy * off)
}

/** Write up to BOLT_SEGS+1 vertices of the drawn (0..drawn) polyline A→B into
 *  `verts` at bolt slot `b`; returns the segment count (points-1). */
private fun writeBolt(
    verts: FloatArray, b: Int, ax: Double, ay: Double, bx: Double, by: Double, drawn: Double,
    seedOff: Double, seed: Double, jagged: Double, beat: Double,
): Int {
    val base = b * VERTS_PER_BOLT
    var last = 0
    val v0 = boltPoint(ax, ay, bx, by, 0.0, seedOff, seed, jagged, beat)
    verts[(base + 0) * 2] = v0.x.toFloat()
    verts[(base + 0) * 2 + 1] = v0.y.toFloat()
    for (i in 1..BOLT_SEGS) {
        val t = i.toDouble() / BOLT_SEGS
        if (t - 1.0 / BOLT_SEGS > drawn) break
        val tc = minOf(t, drawn)
        val v = boltPoint(ax, ay, bx, by, tc, seedOff, seed, jagged, beat)
        verts[(base + i) * 2] = v.x.toFloat()
        verts[(base + i) * 2 + 1] = v.y.toFloat()
        last = i
    }
    return last
}

/** verts: MAX_BOLTS*VPB*2 ; meta: MAX_BOLTS*4 = (segCount, radFrac, fadeMul, isMain). */
class LightningArrays(val verts: FloatArray, val meta: FloatArray)

/**
 * Compute the bolt polyline (trunk + forks) for this frame, in gl_FragCoord space
 * (device px, y-up). `originX/originY` is the strike point (gl coords).
 */
fun computeLightningArrays(
    style: Double,
    thickness: Double,
    jagged: Double,
    branches: Double,
    boltSeed: Double,
    width: Int,
    height: Int,
    originX: Double,
    originY: Double,
    elapsedMs: Double,
    life: Double,
): LightningArrays {
    val verts = FloatArray(MAX_BOLTS * VERTS_PER_BOLT * 2)
    val meta = FloatArray(MAX_BOLTS * 4)
    val strike = strikeProgress(elapsedMs)
    if (strike <= 0.0) return LightningArrays(verts, meta)

    val w = width.toDouble(); val h = height.toDouble()
    val seed = boltSeed
    val beat = floor((elapsedMs / 1000.0) * 12.0) * style

    // Strike geometry: from near the top edge (biased toward the strike x) down to
    // the strike point. gl coords y-up: top edge is y ≈ height.
    val jx = (hash21x(seed * 1.7) - 0.5) * w * 0.5
    val ax = clamp(originX + jx, w * 0.12, w * 0.88); val ay = h * 1.02
    val bx = originX; val by = originY

    // MAIN BOLT (slot 0).
    val mainSegs = writeBolt(verts, 0, ax, ay, bx, by, strike, 0.0, seed, jagged, beat)
    meta[0] = mainSegs.toFloat(); meta[1] = thickness.toFloat(); meta[2] = 1.0f; meta[3] = 1.0f

    // FORKS (slots 1..).
    val forks = maxOf(0, minOf(MAX_FORKS, Math.round(branches).toInt()))
    val dlen = hypot(bx - ax, by - ay).let { if (it == 0.0) 1.0 else it }
    val dirx = (bx - ax) / dlen; val diry = (by - ay) / dlen
    val nrmx = -diry; val nrmy = dirx
    val forkFade = 0.6 + 0.4 * (1.0 - smoothstep(0.5, 1.0, life))
    for (i in 0 until forks) {
        val b = 1 + i
        val hh = hash21(i * 9.7 + seed + 3.0)
        val launchT = 0.18 + hh.x * 0.62
        if (strike < launchT) { meta[b * 4] = 0f; continue }
        val forkA = boltPoint(ax, ay, bx, by, launchT, 0.0, seed, jagged, beat)
        val ang = (hh.y - 0.5) * 2.2
        val reach = (0.18 + hh.x * 0.22) * dlen
        val ex = dirx * (0.5 + hh.y) + nrmx * ang
        val ey = diry * (0.5 + hh.y) + nrmy * ang
        val forkBx = forkA.x + ex * reach; val forkBy = forkA.y + ey * reach
        val forkDrawn = clamp((strike - launchT) / maxOf(1.0 - launchT, 0.05), 0.0, 1.0)
        val segs = writeBolt(verts, b, forkA.x, forkA.y, forkBx, forkBy, forkDrawn, i * 17.0 + 5.0, seed, jagged, beat)
        meta[b * 4] = segs.toFloat(); meta[b * 4 + 1] = (thickness * 0.6).toFloat()
        meta[b * 4 + 2] = forkFade.toFloat(); meta[b * 4 + 3] = 0f
    }

    return LightningArrays(verts, meta)
}
