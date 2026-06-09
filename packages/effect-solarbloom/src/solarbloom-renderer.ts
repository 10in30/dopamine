/**
 * Solarbloom drifting-motes Canvas2D PANEL drawing (web).
 *
 * PERFORMANCE: the motes used to be an 80-iteration loop AT EVERY pixel
 * (O(pixels × motes)) — the dominant cost of solarbloom under software/ANGLE
 * WebGL (the full-screen volumetric bloom itself is cheap, ~28 ms). The motes are
 * sparse glowing sprites, so they belong in a panel: each mote's pose + palette
 * colour + streak + twinkle is computed ONCE per frame here and rasterized into
 * an offscreen Canvas2D as a soft sprite. The fragment shader keeps the bloom,
 * iridescence, dispersion, shafts and the checkmark fully procedural, and just
 * SAMPLES this panel for the mote layer.
 *
 * Swift/Metal solarbloom is untouched; solarbloom.dope.json is unchanged across
 * platforms — only the web mote render path moved.
 *
 * Panel encoding: RGB = Σ(per-mote lit colour × sprite falloff × fade × twinkle),
 * accumulated additively (the shader multiplies by the bloom gain).
 */

import { mulberry32, type RGB } from "@dopamine/core";

const TAU = Math.PI * 2;
const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a: number, b: number, t: number): number => a + (b - a) * t;
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

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

/** Resolved params the mote panel consumes (a subset of solarbloom's RenderParams). */
export interface MotePanelParams {
  palette: RGB[];
  bloomRadius: number;
  turbulence: number;
  moteSpeed: number;
  moteCount: number;
  moteSeed: number;
}

/**
 * Draw the drifting motes for this frame into the offscreen panel. Mirrors the
 * original shader's per-mote motion (outward drift + buoyancy + curl), depth
 * layering, motion-blur streak, twinkle and lifetime fade — computed once per
 * mote in JS. `life` is whole-effect progress; `center` the bloom origin (device
 * px, canvas y-down); `timeS` the elapsed seconds (for twinkle).
 */
export function drawMotePanel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: MotePanelParams,
  life: number,
  timeS: number,
  center: { x: number; y: number },
): void {
  ctx.clearRect(0, 0, w, h);
  const minDim = Math.min(w, h);
  const r = params.bloomRadius * minDim;
  const count = Math.max(0, Math.round(params.moteCount));
  const rng = mulberry32(((params.moteSeed * 1000) >>> 0) + 7);

  ctx.save();
  ctx.globalCompositeOperation = "lighter";

  for (let i = 0; i < count; i++) {
    const hx = rng(), hy = rng(), h2x = rng(), h2y = rng(), delayR = rng();
    const a0 = hx * TAU;
    const spd = 0.5 + hy;
    const delay = delayR * 0.15;
    const ml = clamp01((life - delay) / (1 - delay));
    if (ml <= 0) continue;

    const near = h2x >= 0.66 ? 1 : 0;
    const depth = mix(0.7, 1.4, near);
    const dirx = Math.cos(a0), diry = Math.sin(a0);
    const travel = ml * spd * params.moteSpeed * r * 1.3 * depth;
    // y-up local frame (buoyancy floats upward = +y).
    let px = dirx * travel;
    let py = diry * travel + ml * ml * r * 0.5;
    const t1 = a0 * 3.0 + ml * TAU * spd;
    px += Math.sin(t1) * params.turbulence * r * 0.3 * ml;
    py += Math.cos(t1 * 0.8 + a0) * params.turbulence * r * 0.3 * ml;

    // Velocity → motion-blur streak direction + amount (matches the shader).
    const velx = dirx * spd * params.moteSpeed * 1.3 * depth + Math.cos(t1) * params.turbulence * 0.3;
    const vely = diry * spd * params.moteSpeed * 1.3 * depth + 2.0 * ml * 0.5 - Math.sin(t1 * 0.8 + a0) * params.turbulence * 0.3;
    const vlen = Math.hypot(velx, vely) || 1e-4;
    const streak = clamp01(vlen * 0.12) * smoothstep(0, 0.25, ml) * 0.65;

    const size = minDim * 0.006 * (0.6 + hx * 0.8) * depth;
    const twinkle = 0.75 + 0.25 * Math.sin(timeS * (6.0 + h2y * 10.0) + hx * TAU);
    const fade = (1 - Math.pow(ml, 1.3)) * smoothstep(0, 0.08, ml);
    const amp = fade * twinkle * 1.2 * mix(0.9, 1.3, near);
    if (amp <= 0.001) continue;
    const base = paletteMix(params.palette, hy);
    const cr = Math.round(clamp01(base.r * amp) * 255);
    const cg = Math.round(clamp01(base.g * amp) * 255);
    const cb = Math.round(clamp01(base.b * amp) * 255);
    if (cr + cg + cb <= 0) continue;

    // Canvas position (flip y-up → y-down).
    const cx = center.x + px;
    const cy = center.y - py;
    // Stretch along the velocity direction to mimic the motion-blur streak.
    const ang = Math.atan2(vely, velx);
    const stretch = 1 / (1 - streak);
    const rad = Math.max(size * 3, 1.5);

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(ang);
    ctx.scale(stretch, 1);
    const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, rad);
    grad.addColorStop(0, `rgb(${cr},${cg},${cb})`);
    grad.addColorStop(0.4, `rgba(${cr},${cg},${cb},0.35)`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(0, 0, rad, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}
