/**
 * Heartburst Canvas2D PANEL drawing.
 *
 * The crisp, vector-y parts of Heartburst — the big swelling hero heart and the
 * flurry of little hearts that fly out on the burst — are drawn into an OFFSCREEN
 * Canvas2D each frame (cheap: a couple dozen filled paths) and uploaded as the
 * "panel" texture; the fragment shader (heartburst-shader.ts) adds the soft warm
 * bloom, the gloss highlight, the halftone blush, the noir↔pop styling, the beat
 * flash and casts the warm light + soft shadow.
 *
 * Both the hero and the little hearts are a single parametric HEART CURVE (the
 * classic `16sin³t` cardioid-ish heart) traced as a Canvas2D path, so the form
 * is true vector geometry the GPU can't easily do.
 *
 * Panel channel encoding consumed by the shader:
 *   R = hero heart FILL   ·  G = INK (outline) + gloss seed  ·  B = burst hearts FILL
 */

import { mulberry32 } from "./seed.js";
import { burstProgress } from "./tempo.js";

/** Resolved render params Heartburst's panel + shader consume. */
export interface HeartburstRenderParams {
  durationMs: number;
  palette: unknown;
  style: number;            // = whimsy (photoreal heart 0 -> flat cel sticker 1)
  heartburstSeed: number;   // per-fire scatter offset
  heartScale: number;       // hero heart size as fraction of min canvas dim
  burstCount: number;       // number of little hearts in the flurry
  burstSpread: number;      // how far the little hearts fly (fraction of min dim)
  inkWeight: number;        // outline weight (device-independent base)
  beatStrength: number;     // beat swell magnitude (intensity)
  doubleBeat: number;       // 0 single gentle pulse -> 1 full lub-dub
  dotSize: number;          // halftone cell size (dpr-scaled in the shader pass)
  exposure: number;         // cast-light gain (shader uniform)
  glow: number;             // soft bloom (shader uniform)
  gloss: number;            // specular gloss (shader uniform)
  halftone: number;         // halftone blush strength (shader uniform)
  saturation: number;       // panel saturation (shader uniform)
}

/**
 * Trace a parametric heart of half-size `s` centred at the current origin into
 * the given context's current path. `rot` rotates it (radians). The classic
 * heart curve, normalized so its bounding extent ≈ `s` and the cusp points UP.
 */
function traceHeart(ctx: CanvasRenderingContext2D, s: number, rot: number): void {
  const steps = 48;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * Math.PI * 2;
    // x in [-16,16], y in roughly [-17,12] for the standard curve.
    const x = 16 * Math.pow(Math.sin(t), 3);
    const y =
      13 * Math.cos(t) -
      5 * Math.cos(2 * t) -
      2 * Math.cos(3 * t) -
      Math.cos(4 * t);
    // Normalize to ~[-1,1] and flip Y so the lobes are at the top (canvas y-down).
    const nx = (x / 17) * s;
    const ny = (-y / 17) * s;
    const cx = nx * Math.cos(rot) - ny * Math.sin(rot);
    const cy = nx * Math.sin(rot) + ny * Math.cos(rot);
    if (i === 0) ctx.moveTo(cx, cy);
    else ctx.lineTo(cx, cy);
  }
  ctx.closePath();
}

/**
 * Draw the offscreen panel for this frame.
 *  - the hero heart at the current beat scale, fill in RED, outline in GREEN,
 *    plus a gloss-highlight blob painted into GREEN that sits ON the fill (the
 *    shader reads ink∩fill as the specular seed),
 *  - the little burst hearts flying outward along seeded arcs, fill in BLUE.
 *
 * `heartScaleMul` is the lub-dub beat multiplier on the hero (1 at rest).
 * `presence` fades the whole panel in/out.
 */
export function drawHeartburstPanel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: HeartburstRenderParams,
  heartScaleMul: number,
  life: number,
  presence: number,
  dpr: number,
): void {
  ctx.clearRect(0, 0, w, h);
  if (presence <= 0.001) return;

  const cx = w * 0.5;
  const cy = h * 0.5;
  const minDim = Math.min(w, h);
  const seed = (params.heartburstSeed * 1000) >>> 0;
  const rng = mulberry32(seed);

  const ink = Math.max(1, params.inkWeight * dpr);

  // ---------- HERO HEART (R fill, G outline + gloss seed) ------------------
  const heroS = minDim * params.heartScale * heartScaleMul;
  // a tiny per-fire tilt so it feels hand-placed.
  const tilt = ((params.heartburstSeed % 1) - 0.5) * 0.12;

  // As the burst takes over, the hero heart shrinks/cracks open a touch so the
  // little hearts read as having spilled OUT of it.
  const b = burstProgress(life);
  const heroPresence = presence * (1 - 0.65 * b);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.globalCompositeOperation = "lighter"; // additive into channels

  if (heroPresence > 0.002) {
    const heroFillA = Math.round(255 * heroPresence);
    // FILL -> RED.
    traceHeart(ctx, heroS, tilt);
    ctx.fillStyle = `rgba(${heroFillA},0,0,1)`;
    ctx.fill();

    // OUTLINE -> GREEN.
    traceHeart(ctx, heroS, tilt);
    ctx.lineJoin = "round";
    ctx.lineWidth = ink * 1.6;
    ctx.strokeStyle = `rgba(0,${heroFillA},0,1)`;
    ctx.stroke();

    // GLOSS SEED -> GREEN, painted ON the fill (upper-left lobe). The shader
    // reads ink∩fill as the specular highlight, so a soft blob here becomes the
    // gel-heart shine. Clip to the heart so it never bleeds past the silhouette.
    ctx.save();
    traceHeart(ctx, heroS, tilt);
    ctx.clip();
    const gx = -heroS * 0.34;
    const gy = -heroS * 0.42;
    const gr = heroS * 0.42;
    const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
    grad.addColorStop(0, `rgba(0,${heroFillA},0,1)`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(gx, gy, gr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();

  // ---------- BURST HEARTS (B fill) ----------------------------------------
  // A flurry of little hearts fly outward along seeded directions, arc under a
  // little "gravity", spin, and shrink as they go. Fully crisp vector hearts.
  if (b > 0.001) {
    const count = Math.max(0, Math.round(params.burstCount));
    const maxDist = minDim * params.burstSpread;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < count; i++) {
      // deterministic per-heart launch params.
      const ang = (i / count) * Math.PI * 2 + (rng() - 0.5) * 0.9;
      const speed = 0.55 + rng() * 0.45;       // some fly farther
      const spin = (rng() - 0.5) * 2.0;
      const littleS = minDim * (0.035 + rng() * 0.04) * params.heartScale * 1.6;
      // staggered launch so they don't all leave at once.
      const stagger = rng() * 0.25;
      const lp = Math.max(0, Math.min(1, (b - stagger) / (1 - stagger)));
      if (lp <= 0) continue;
      const dist = maxDist * speed * lp;
      // arc: a parabola so they rise then fall slightly.
      const arc = minDim * 0.10 * speed * (lp - lp * lp) * 4.0;
      const px = cx + Math.cos(ang) * dist;
      const py = cy + Math.sin(ang) * dist - arc;
      // fade + shrink late in the flight.
      const fade = 1 - Math.pow(lp, 2.2);
      if (fade <= 0.01) continue;
      const a = Math.round(255 * presence * fade);
      const s = littleS * (0.6 + 0.4 * (1 - lp));
      ctx.save();
      ctx.translate(px, py);
      traceHeart(ctx, s, spin * lp * Math.PI);
      ctx.fillStyle = `rgba(0,0,${a},1)`;
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  }
}
