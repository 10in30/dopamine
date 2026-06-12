/**
 * Lightning bolt geometry precompute — the SINGLE cross-platform source.
 *
 * The bolt polyline is fragment-INDEPENDENT, so it is computed ONCE per frame
 * here (a faithful port of the shared fbm/hash + the original shader
 * `boltPoint`) and fed to the shader as the `uVerts` / `uBoltMeta` arrays. The
 * shader keeps the exact original inverse-distance plasma glow; only the cost
 * moved off the per-pixel path.
 *
 * THIS FILE IS TRANSPILED to Swift (`LightningRenderer.swift`) and Kotlin
 * (`LightningRenderer.kt`) by `tools/dopamine/src/logic.mjs` (declared by the
 * `.dope` `x-build.logic` block) — the per-frame-geometry analog of the scoped
 * GLSL→MSL shader transpiler. Keep it inside the supported subset:
 *
 *   • no imports — the module is self-contained (pure math, no DOM/GL);
 *   • function declarations with `number` / `Float32Array` / interface-typed
 *     params; `const`/`let`; `if`/`else`; canonical `for (let i = A; i < B; i++)`
 *     loops; `break`/`continue`/`return`; ternaries; arithmetic + comparisons;
 *   • Math.{floor,min,max,abs,sqrt,exp,hypot,sin,cos,pow,round} and Math.PI;
 *   • `new Float32Array(n)`, element writes, `{ x, y }` vector literals, and a
 *     `{ verts, meta }` bundle return (declared via an exported interface).
 *
 * The transpiler THROWS on anything outside that subset. Numeric semantics are
 * JS's: every number is a double (loop counters transpile to ints), `/` is
 * always double division, and array writes narrow to float32 exactly like the
 * Float32Array stores here do.
 *
 * Output (gl_FragCoord space — device px, y-UP, to match the shader):
 *   verts: Float32Array(MAX_BOLTS * VERTS_PER_BOLT * 2) — vertex i of bolt b at
 *          [(b*VPB + i) * 2].
 *   meta:  Float32Array(MAX_BOLTS * 4) — per bolt (segCount, radFrac, fadeMul, isMain).
 */

/** Max secondary forks — shared by the shader + the `.dope` clamp. */
export const MAX_FORKS = 7;
/** Polyline segment count of the main bolt (and forks). More = jaggier arc. */
export const BOLT_SEGS = 14;
/** Main trunk + forks. */
export const MAX_BOLTS = MAX_FORKS + 1;
/** Vertices stored per bolt (BOLT_SEGS + 1). */
export const VERTS_PER_BOLT = BOLT_SEGS + 1;
/** Window (ms) over which the bolt cracks in to the strike point. Hard + fast. */
export const STRIKE_MS = 130;

interface Vec2 {
  x: number;
  y: number;
}

/** verts: MAX_BOLTS*VPB*2 ; meta: MAX_BOLTS*4 = (segCount, radFrac, fadeMul, isMain). */
export interface LightningArrays {
  verts: Float32Array;
  meta: Float32Array;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function fract(x: number): number {
  return x - Math.floor(x);
}

function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Bolt strike progress (0..1) over elapsed ms — the jagged arc racing from the
 * source to the action point. Ease-out quint: a near-instant crack-in that
 * settles abruptly, so the bolt reads as a strike, not a slow draw.
 */
export function strikeProgress(elapsedMs: number): number {
  const x = clamp01(elapsedMs / STRIKE_MS);
  return 1 - Math.pow(1 - x, 5);
}

// --- Faithful port of the shared look/glsl hash + value-noise fbm -----------

function hash11(p: number): number {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
}

/** Just the .x channel of the shared hash21 (used for the start jog). */
function hash21x(p: number): number {
  let x = fract(p * 0.1031), y = fract(p * 0.103), z = fract(p * 0.0973);
  const d = x * (y + 33.33) + y * (z + 33.33) + z * (x + 33.33);
  x += d; y += d; z += d;
  return fract((x + y) * z);
}

function hash21(p: number): Vec2 {
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

/**
 * Compute the bolt polyline (trunk + forks) for this frame, in gl_FragCoord
 * space (device px, y-up). `originX`/`originY` is the strike point (gl coords);
 * `width`/`height` the canvas device px; `elapsedMs`/`life` the timing.
 */
export function computeLightningArrays(
  style: number, thickness: number, jagged: number, branches: number, boltSeed: number,
  width: number, height: number, originX: number, originY: number,
  elapsedMs: number, life: number,
): LightningArrays {
  const verts = new Float32Array(MAX_BOLTS * VERTS_PER_BOLT * 2);
  const meta = new Float32Array(MAX_BOLTS * 4);
  const strike = strikeProgress(elapsedMs);
  if (strike <= 0) return { verts, meta };

  const seed = boltSeed;
  const beat = Math.floor((elapsedMs / 1000) * 12) * style;

  // Strike geometry: from near the top edge (biased toward the strike x) down to
  // the strike point. gl coords y-up: top edge is y ≈ height.
  const jx = (hash21x(seed * 1.7) - 0.5) * width * 0.5;
  const A: Vec2 = { x: clamp(originX + jx, width * 0.12, width * 0.88), y: height * 1.02 };
  const B: Vec2 = { x: originX, y: originY };

  // MAIN BOLT (slot 0).
  const mainSegs = writeBolt(verts, 0, A, B, strike, 0, seed, jagged, beat);
  meta[0] = mainSegs; meta[1] = thickness; meta[2] = 1.0; meta[3] = 1.0;

  // FORKS (slots 1..).
  const forks = Math.max(0, Math.min(MAX_FORKS, Math.round(branches)));
  const dlenRaw = Math.hypot(B.x - A.x, B.y - A.y);
  const dlen = dlenRaw === 0 ? 1 : dlenRaw;
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
    meta[b * 4] = segs; meta[b * 4 + 1] = thickness * 0.6; meta[b * 4 + 2] = forkFade; meta[b * 4 + 3] = 0;
  }

  return { verts, meta };
}
