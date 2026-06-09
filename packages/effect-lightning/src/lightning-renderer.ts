/**
 * Lightning Canvas2D PANEL drawing (web).
 *
 * PERFORMANCE: the original web lightning was a single full-screen fragment pass
 * that, at EVERY pixel, walked the main bolt + every fork (8 × 14 segments) and
 * evaluated `boltPoint` — which calls 4-octave `fbm` TWICE — per segment: ~220
 * fbm (~3.5K hash) evaluations PER PIXEL, plus the shadow pass re-walking it 9×.
 * Fine on a GPU; ~1.1 s/frame under software/ANGLE WebGL. The bolt is a thin
 * polyline whose vertices are fragment-INDEPENDENT, so it belongs in a panel: we
 * compute the jagged polyline ONCE per frame in JS (a faithful port of the
 * shader's fbm/hash + boltPoint) and stroke it — soft halo into R, hot core into
 * G — into an offscreen Canvas2D. The fragment shader then just samples that and
 * adds the (cheap, full-screen) flash + impact glow + finish.
 *
 * Swift/Metal lightning is untouched; lightning.dope.json is unchanged across
 * platforms — only the web render path moved.
 *
 * Panel channel encoding consumed by lightning-shader.ts:
 *   R = soft electric HALO (glow)   ·   G = hot white CORE
 */

import { MAX_FORKS, BOLT_SEGS } from "./lightning-shader.js";
import { strikeProgress } from "./lightning-tempo.js";

/** Resolved render params the lightning panel consumes. */
export interface LightningRenderParams {
  durationMs: number;
  style: number;       // = whimsy (photoreal plasma 0 -> cel comic bolt 1)
  thickness: number;   // bolt half-width as fraction of min dim
  jagged: number;      // fbm perturbation amount of the bolt vertices
  branches: number;    // number of secondary forks
  boltSeed: number;    // per-fire hash offset
}

const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const fract = (x: number): number => x - Math.floor(x);

// --- Faithful JS port of the shared look/glsl hash + value-noise fbm ---------
function hash11(p: number): number {
  p = fract(p * 0.1031);
  p *= p + 33.33;
  p *= p + p;
  return fract(p);
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

/** A jagged bolt vertex at parameter t along A→B (port of the shader boltPoint). */
function boltPoint(
  A: Vec2, B: Vec2, t: number, seedOff: number, jitterScale: number,
  seed: number, jagged: number, beat: number,
): Vec2 {
  const dx = B.x - A.x, dy = B.y - A.y;
  const len = Math.max(Math.hypot(dx, dy), 1);
  const dirx = dx / len, diry = dy / len;
  const nrmx = -diry, nrmy = dirx;
  const bt = beat * jitterScale;
  const n = fbm(t * 6 + seedOff + seed, bt * 0.5) - 0.5;
  const fine = fbm(t * 22 + seedOff * 3.1 + seed, bt) - 0.5;
  const taper = Math.sin(t * Math.PI);
  const off = (n * 1.6 + fine * 0.5) * jagged * len * 0.16 * taper;
  return { x: A.x + dirx * (t * len) + nrmx * off, y: A.y + diry * (t * len) + nrmy * off };
}

/** Build the drawn portion (0..`drawn`) of a jagged polyline A→B. */
function boltPolyline(
  A: Vec2, B: Vec2, drawn: number, seedOff: number, jitterScale: number,
  seed: number, jagged: number, beat: number,
): Vec2[] {
  const pts: Vec2[] = [boltPoint(A, B, 0, seedOff, jitterScale, seed, jagged, beat)];
  for (let i = 1; i <= BOLT_SEGS; i++) {
    const t = i / BOLT_SEGS;
    if (t - 1 / BOLT_SEGS > drawn) break;
    const tc = Math.min(t, drawn);
    pts.push(boltPoint(A, B, tc, seedOff, jitterScale, seed, jagged, beat));
  }
  return pts;
}

/**
 * Stroke a polyline as a tight soft HALO (red channel) + hot CORE (green),
 * additively. The halo is a thin bright stroke with a `shadowBlur` gaussian
 * falloff — a real bright-spine→transparent-edge glow, NOT a wide flat band (the
 * latter reads as a fuzzy translucent slab once the screen blend + gain amplify
 * its low-alpha tail).
 */
function strokeBolt(ctx: CanvasRenderingContext2D, pts: Vec2[], rad: number): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  // HALO -> R: a few TIGHT widening strokes approximate the plasma glow falloff
  // (bright spine, quick fade). Kept narrow (≤~1.6× rad) so it reads as a halo,
  // not a slab — and cheap (no shadowBlur gaussian, which is costly per frame).
  const halo: Array<[number, number]> = [[1.6, 0.16], [1.0, 0.3], [0.55, 0.6]];
  for (const [wmul, alpha] of halo) {
    ctx.lineWidth = Math.max(rad * wmul, 1);
    ctx.strokeStyle = `rgba(255,0,0,${alpha})`;
    ctx.stroke();
  }

  // CORE -> G: a crisp thin white-hot centre line.
  ctx.strokeStyle = "rgba(0,255,0,1)";
  ctx.lineWidth = Math.max(rad * 0.28, 1.5);
  ctx.stroke();
}

/**
 * Draw one frame of the bolt (main trunk + forks) into the offscreen panel.
 * `center` is the strike point (anchor, device px); the bolt descends from the
 * top edge to it. Geometry is a pure function of elapsedMs + seed.
 */
export function drawLightningPanel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: LightningRenderParams,
  elapsedMs: number,
  center: { x: number; y: number },
): void {
  ctx.clearRect(0, 0, w, h);
  const strike = strikeProgress(elapsedMs);
  if (strike <= 0) return;

  const minDim = Math.min(w, h);
  const seed = params.boltSeed;
  const jagged = params.jagged;
  const timeS = elapsedMs / 1000;
  const beat = Math.floor(timeS * 12) * params.style;

  // Strike geometry: from near the top edge (biased toward the strike x) down to
  // the strike point (anchor). Canvas y-down: top is y≈0.
  const jx = (hash21(seed * 1.7).x - 0.5) * w * 0.5;
  const A: Vec2 = { x: clamp(center.x + jx, w * 0.12, w * 0.88), y: -0.02 * h };
  const B: Vec2 = { x: center.x, y: center.y };

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  // MAIN BOLT.
  const radMain = minDim * params.thickness;
  strokeBolt(ctx, boltPolyline(A, B, strike, 0, 1, seed, jagged, beat), radMain);

  // SECONDARY FORKS.
  const forks = Math.max(0, Math.min(MAX_FORKS, Math.round(params.branches)));
  const dlen = Math.hypot(B.x - A.x, B.y - A.y) || 1;
  const dirx = (B.x - A.x) / dlen, diry = (B.y - A.y) / dlen;
  const nrmx = -diry, nrmy = dirx;
  const radFork = minDim * params.thickness * 0.6;
  for (let i = 0; i < forks; i++) {
    const hh = hash21(i * 9.7 + seed + 3);
    const launchT = 0.18 + hh.x * 0.62;
    if (strike < launchT) continue;
    const forkA = boltPoint(A, B, launchT, 0, 1, seed, jagged, beat);
    const ang = (hh.y - 0.5) * 2.2;
    const reach = (0.18 + hh.x * 0.22) * dlen;
    const ex = dirx * (0.5 + hh.y) + nrmx * ang;
    const ey = diry * (0.5 + hh.y) + nrmy * ang;
    const forkB: Vec2 = { x: forkA.x + ex * reach, y: forkA.y + ey * reach };
    const forkDrawn = clamp((strike - launchT) / Math.max(1 - launchT, 0.05), 0, 1);
    strokeBolt(ctx, boltPolyline(forkA, forkB, forkDrawn, i * 17 + 5, 1, seed, jagged, beat), radFork);
  }

  ctx.restore();
}
