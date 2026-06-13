/**
 * Confetti Canvas2D PANEL drawing (web).
 *
 * PERFORMANCE: the original web confetti was a single full-screen fragment pass
 * that re-derived all MAX_PIECES poses (hash + ballistic + sway + spin) at EVERY
 * pixel — O(pixels × pieces) ≈ 95M piece-evaluations/frame at 1100×720, which is
 * fine on a GPU but crawls under software/ANGLE WebGL. The pieces actually cover
 * a tiny fraction of the screen, so the work belongs where it scales with COVERED
 * AREA, not pixel count: we rasterize the pieces into an offscreen Canvas2D panel
 * (each pose computed ONCE per frame, in JS) and the fragment shader just samples
 * that texture and applies the screen-space finish (ACES tonemap, cel posterize,
 * dither). This is the same hybrid-panel architecture the fast effects (comic,
 * heartburst) already use.
 *
 * The Swift/Metal renderer is untouched (its GPU full-screen pass is plenty fast),
 * and confetti.dope.json is byte-identical across platforms — only the web render
 * path changed.
 *
 * Panel channel encoding consumed by confetti-shader.ts:
 *   RGB = the per-piece LIT colour (palette × paper/cel shading), pre-multiplied
 *         by the piece's lifetime fade and accumulated additively across pieces.
 *         The shader applies the global gain (amp × exposure), tonemap + finish.
 */

import { mulberry32, type RGB } from "@dopaminefx/core";
import { MAX_PIECES } from "./confetti-shader.js";

/** Resolved render params the confetti panel consumes. */
export interface ConfettiRenderParams {
  durationMs: number;
  palette: RGB[];
  style: number; // = whimsy (photoreal paper 0 -> flat cel 1)
  exposure: number;
  pieceCount: number;
  spread: number;
  launchSpeed: number;
  gravity: number;
  flutter: number;
  pieceSize: number;
  spin: number;
  overshoot: number;
  pieceSeed: number;
}

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const fract = (x: number): number => x - Math.floor(x);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** paletteMix from the look lib: two-segment lerp across the three stops. */
function paletteMix(pal: RGB[], t: number): RGB {
  t = clamp01(t);
  const [c0, c1, c2] = pal;
  if (t < 0.5) {
    const k = t * 2;
    return { r: mix(c0.r, c1.r, k), g: mix(c0.g, c1.g, k), b: mix(c0.b, c1.b, k) };
  }
  const k = (t - 0.5) * 2;
  return { r: mix(c1.r, c2.r, k), g: mix(c1.g, c2.g, k), b: mix(c1.b, c2.b, k) };
}

/**
 * Draw one frame of confetti into the offscreen panel. `life` is whole-effect
 * progress 0..1; `center` is the launch anchor (device px, canvas y-down).
 *
 * Mirrors the original shader's `pieceAt` motion (a mostly-up launch cone, a
 * gravity arc, an air-drag sway, and a tumbling spin with a face-flash) and its
 * per-piece lit colour (paper shading ↔ flat cel by whimsy), computed once per
 * piece in JS instead of once per pixel in GLSL.
 */
export function drawConfettiPanel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: ConfettiRenderParams,
  life: number,
  center: { x: number; y: number },
): void {
  ctx.clearRect(0, 0, w, h);
  if (life <= 0 || life >= 1) return;

  const minDim = Math.min(w, h);
  const count = Math.max(0, Math.min(MAX_PIECES, Math.round(params.pieceCount)));
  const rng = mulberry32(((params.pieceSeed * 1000) >>> 0) + 1);
  const style = params.style;

  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive accumulation, like the shader's `col +=`

  for (let i = 0; i < count; i++) {
    // Five per-piece randoms in a fixed order (≈ the GLSL hash21/hash11 draws).
    const hx = rng(), hy = rng(), h2x = rng(), h2y = rng(), h3 = rng();

    // Spawn stagger: most pieces fire in the first ~12%, renormalized to a full arc.
    const delay = h2x * 0.12;
    const pl = clamp01((life - delay) / (1 - delay));
    if (pl <= 0 || pl >= 1) continue;

    // Launch direction (y-up local frame): a mostly-up cone fanned by spread.
    const fan = (hx - 0.5) * 2;
    const dlen = Math.hypot(fan * (0.35 + params.spread), 1.0);
    const dirx = (fan * (0.35 + params.spread)) / dlen;
    const diry = 1.0 / dlen;
    const speed = (0.85 + hy * 0.6) * params.launchSpeed * minDim * 1.15;
    const grav = (0.9 + h3 * 0.4) * params.gravity * minDim * 1.5;

    // Ballistic arc: up, then down under gravity (y-up).
    let px = dirx * speed * pl;
    let py = diry * speed * pl - grav * pl * pl;

    // Air-drag flutter: a growing sideways sway as the piece slows + falls.
    const swayPhase = hx * TAU + h2y * 3.0;
    const swayFreq = 3.0 + h2x * 4.0;
    const fallT = smoothstep(0.12, 0.7, pl);
    const swayAmp = params.flutter * minDim * 0.06 * (0.4 + fallT);
    const sway =
      Math.sin(pl * swayFreq + swayPhase) * swayAmp +
      Math.sin(pl * swayFreq * 0.37 + swayPhase * 1.7) * swayAmp * 0.4;
    px += sway;

    // Spin + face-flash (wide/bright face-on, dim edge-on).
    const spinRate = (3.0 + h3 * 6.0) * params.spin;
    const rot = pl * spinRate * TAU + swayPhase;
    const flip = Math.abs(Math.cos(rot * 0.5 + sway * 0.02));
    const face = mix(0.18, 1.0, flip);

    // Paper shape: rectangles + a few petals, foreshortened by the face angle.
    const aspect = mix(0.5, 1.6, h2y);
    const s = minDim * 0.011 * params.pieceSize * (0.7 + hy * 0.7);
    const fore = mix(1.0, face, 0.65);
    const heX = Math.max(s * aspect * fore, 0.5);
    const heY = Math.max(s * fore, 0.5);
    const hue = fract(h2y * 0.9 + h3 * 0.31);
    const petal = h3 >= 0.78;

    // Per-piece lit colour (paper shading ↔ flat cel), pre-multiplied by fade.
    const base = paletteMix(params.palette, hue);
    const shade = mix(0.45, 1.15, face);
    const spec = smoothstep(0.85, 1.0, face) * 0.5;
    const celK = face >= 0.5 ? 1 : 0;
    const celShade = mix(0.55, 1.1, celK);
    const fade = (1 - Math.pow(pl, 1.4)) * smoothstep(0.0, 0.08, pl);
    const lit = (c: number): number => {
      const paper = c * shade + spec;
      const cel = c * celShade;
      return clamp01(mix(paper, cel, style)) * fade;
    };
    const r = Math.round(lit(base.r) * 255);
    const g = Math.round(lit(base.g) * 255);
    const bl = Math.round(lit(base.b) * 255);
    if (r + g + bl <= 0) continue;

    // Place in canvas space (flip y: local y-up → canvas y-down).
    const cx = center.x + px;
    const cy = center.y - py;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = `rgb(${r},${g},${bl})`;
    if (petal) {
      ctx.beginPath();
      ctx.ellipse(0, 0, heX * 1.05, heY * 1.05, 0, 0, TAU);
      ctx.fill();
    } else {
      const rad = Math.min(heX, heY) * 0.5;
      ctx.beginPath();
      ctx.roundRect(-heX, -heY, heX * 2, heY * 2, rad);
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}
