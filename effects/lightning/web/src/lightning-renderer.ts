/**
 * Lightning bolt geometry precompute (web).
 *
 * PERFORMANCE: the original web lightning re-derived every bolt vertex with TWO
 * 4-octave `fbm` calls per segment AT EVERY PIXEL (~220 fbm/pixel), plus a 9-tap
 * shadow re-walk — ~1.1 s/frame under software/ANGLE WebGL. The bolt polyline is
 * fragment-INDEPENDENT, so we compute it ONCE per frame here (a faithful JS port
 * of the shared fbm/hash + the original `boltPoint`) and feed it to the shader as
 * the `uVerts` / `uBoltMeta` uniform arrays. The shader keeps the exact original
 * inverse-distance plasma glow; only the cost moved off the per-pixel path.
 *
 * Output (gl_FragCoord space — device px, y-UP, to match the shader):
 *   verts: Float32Array(MAX_BOLTS * VERTS_PER_BOLT * 2) — vertex i of bolt b at
 *          [(b*VPB + i) * 2].
 *   meta:  Float32Array(MAX_BOLTS * 4) — per bolt (segCount, radFrac, fadeMul, isMain).
 */

import { MAX_FORKS, BOLT_SEGS, MAX_BOLTS, VERTS_PER_BOLT } from "./lightning-shader.js";
import { strikeProgress } from "./lightning-tempo.js";

export interface LightningRenderParams {
  style: number;       // = whimsy (drives the on-twos cel jitter)
  thickness: number;   // bolt half-width as fraction of min dim
  jagged: number;      // fbm perturbation amount of the bolt vertices
  branches: number;    // number of secondary forks
  boltSeed: number;    // per-fire hash offset
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const fract = (x: number): number => x - Math.floor(x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;

// --- Faithful JS port of the shared look/glsl hash + value-noise fbm ---------
function hash11(p: number): number {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}
function hash21x(p: number): number {
  // Just the .x channel of the shared hash21 (used for the start jog).
  let x = fract(p * 0.1031), y = fract(p * 0.103), z = fract(p * 0.0973);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}
function hash21(p: number): { x: number; y: number } {
  let x = fract(p * 0.1031), y = fract(p * 0.103), z = fract(p * 0.0973);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return { x: fract((x + y) * z), y: fract((x + z) * y) };
}
function vnoise(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = hash11(ix * 1 + iy * 57);
  const b = hash11((ix + 1) * 1 + iy * 57);
  const c = hash11(ix * 1 + (iy + 1) * 57);
  const d = hash11((ix + 1) * 1 + (iy + 1) * 57);
  return mix(mix(a, b, ux), mix(c, d, ux), uy);
}
function fbm(x: number, y: number): number {
  let s = 0, a = 0.5;
  for (let i = 0; i < 4; i++) {
    s += a * vnoise(x, y);
    const nx = (0.8 * x + 0.6 * y) * 2.03;
    const ny = (-0.6 * x + 0.8 * y) * 2.03;
    x = nx; y = ny; a *= 0.5;
  }
  return s;
}

interface Vec2 { x: number; y: number }

/** Port of the shader boltPoint: a jagged vertex at t along A→B. */
function boltPoint(A: Vec2, B: Vec2, t: number, seedOff: number, seed: number, jagged: number, beat: number): Vec2 {
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.max(Math.hypot(dx, dy), 1);
  const dirx = dx / len, diry = dy / len;
  const nrmx = -diry, nrmy = dirx;
  const n = fbm(t * 6 + seedOff + seed, beat * 0.5) - 0.5;
  const fine = fbm(t * 22 + seedOff * 3.1 + seed, beat) - 0.5;
  const taper = Math.sin(t * Math.PI);
  const off = (n * 1.6 + fine * 0.5) * jagged * len * 0.16 * taper;
  return { x: A.x + dirx * (t * len) + nrmx * off, y: A.y + diry * (t * len) + nrmy * off };
}

/** Write up to BOLT_SEGS+1 vertices of the drawn (0..drawn) polyline A→B into
 *  `verts` at bolt slot `b`; returns the segment count (points-1). */
function writeBolt(
  verts: Float32Array, b: number, A: Vec2, B: Vec2, drawn: number,
  seedOff: number, seed: number, jagged: number, beat: number,
): number {
  const base = b * VERTS_PER_BOLT;
  let last = 0;
  const v0 = boltPoint(A, B, 0, seedOff, seed, jagged, beat);
  verts[(base + 0) * 2] = v0.x;
  verts[(base + 0) * 2 + 1] = v0.y;
  for (let i = 1; i <= BOLT_SEGS; i++) {
    const t = i / BOLT_SEGS;
    if (t - 1 / BOLT_SEGS > drawn) break;
    const tc = Math.min(t, drawn);
    const v = boltPoint(A, B, tc, seedOff, seed, jagged, beat);
    verts[(base + i) * 2] = v.x;
    verts[(base + i) * 2 + 1] = v.y;
    last = i;
  }
  return last;
}

export interface LightningArrays {
  verts: Float32Array; // MAX_BOLTS * VERTS_PER_BOLT * 2
  meta: Float32Array;  // MAX_BOLTS * 4 = (segCount, radFrac, fadeMul, isMain)
}

/**
 * Compute the bolt polyline (trunk + forks) for this frame, in gl_FragCoord
 * space (device px, y-up). `origin` is the strike point (gl coords); `width`/
 * `height` the canvas device px; `elapsedMs`/`life` the timing.
 */
export function computeLightningArrays(
  params: LightningRenderParams,
  width: number,
  height: number,
  origin: { x: number; y: number },
  elapsedMs: number,
  life: number,
): LightningArrays {
  const verts = new Float32Array(MAX_BOLTS * VERTS_PER_BOLT * 2);
  const meta = new Float32Array(MAX_BOLTS * 4);
  const strike = strikeProgress(elapsedMs);
  if (strike <= 0) return { verts, meta };

  const seed = params.boltSeed;
  const jagged = params.jagged;
  const beat = Math.floor((elapsedMs / 1000) * 12) * params.style;

  // Strike geometry: from near the top edge (biased toward the strike x) down to
  // the strike point. gl coords y-up: top edge is y ≈ height.
  const jx = (hash21x(seed * 1.7) - 0.5) * width * 0.5;
  const A: Vec2 = { x: clamp(origin.x + jx, width * 0.12, width * 0.88), y: height * 1.02 };
  const B: Vec2 = { x: origin.x, y: origin.y };

  // MAIN BOLT (slot 0).
  const mainSegs = writeBolt(verts, 0, A, B, strike, 0, seed, jagged, beat);
  meta[0] = mainSegs; meta[1] = params.thickness; meta[2] = 1.0; meta[3] = 1.0;

  // FORKS (slots 1..).
  const forks = Math.max(0, Math.min(MAX_FORKS, Math.round(params.branches)));
  const dlen = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const dirx = (B.x - A.x) / dlen, diry = (B.y - A.y) / dlen;
  const nrmx = -diry, nrmy = dirx;
  const forkFade = 0.6 + 0.4 * (1 - smoothstep(0.5, 1.0, life));
  for (let i = 0; i < forks; i++) {
    const b = 1 + i;
    const hh = hash21(i * 9.7 + seed + 3);
    const launchT = 0.18 + hh.x * 0.62;
    if (strike < launchT) { meta[b * 4] = 0; continue; }
    const forkA = boltPoint(A, B, launchT, 0, seed, jagged, beat);
    const ang = (hh.y - 0.5) * 2.2;
    const reach = (0.18 + hh.x * 0.22) * dlen;
    const ex = dirx * (0.5 + hh.y) + nrmx * ang;
    const ey = diry * (0.5 + hh.y) + nrmy * ang;
    const forkB: Vec2 = { x: forkA.x + ex * reach, y: forkA.y + ey * reach };
    const forkDrawn = clamp((strike - launchT) / Math.max(1 - launchT, 0.05), 0, 1);
    const segs = writeBolt(verts, b, forkA, forkB, forkDrawn, i * 17 + 5, seed, jagged, beat);
    meta[b * 4] = segs; meta[b * 4 + 1] = params.thickness * 0.6; meta[b * 4 + 2] = forkFade; meta[b * 4 + 3] = 0;
  }

  return { verts, meta };
}
