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

import { easeOutCubic, clamp01, mulberry32, type PanelDraw } from "@dopaminefx/core";

// ---------------------------------------------------------------------------
// DRAW-side tempo. The per-frame UNIFORM logic (amp/presence/beat/burst/flash)
// is DATA — `tempo.frame` in heartburst.dope.json, evaluated by the core
// frame-expr evaluator (pinned delta-0 against these functions by the tests).
// The same curves are ALSO needed by the panel GEOMETRY (the hero swells with
// the beat, the little hearts fly out with the burst), and panel geometry is
// code by design — so the draw-side copies live here, next to the draw.
//
//   life 0.00 .. 0.30  : LUB-DUB — two beats; the second tucked behind the first
//   life 0.30 .. 1.00  : BURST + AFTERGLOW — little hearts fly out, hero fades
// ---------------------------------------------------------------------------

/** Fraction of life occupied by the lub-dub beat phase before the burst. */
export const HEARTBEAT_PHASE = 0.3;

/**
 * A single soft beat pulse centred at `center` (in life units) with half-width
 * `width`: rises fast, eases back down. Returns 0..1 (peak 1 at `center`).
 */
function beatPulse(t: number, center: number, width: number): number {
  const x = (t - center) / width;
  if (x <= -1 || x >= 1) return 0;
  const lobe = 0.5 + 0.5 * Math.cos(x * Math.PI);
  return x < 0 ? Math.pow(lobe, 0.7) : Math.pow(lobe, 1.4);
}

/**
 * Heart SCALE multiplier over normalized life. A resting 1.0 with two beats
 * superimposed, then it settles to rest through the burst and gently shrinks as
 * it fades. `strength` scales beat swell; `doubleBeat` blends single → lub-dub.
 */
export function heartbeatScale(life: number, strength = 1, doubleBeat = 1): number {
  const t = clamp01(life);
  const lub = beatPulse(t, 0.1, 0.1);
  const dub = beatPulse(t, 0.21, 0.075) * 0.62 * clamp01(doubleBeat);
  const beat = Math.max(lub, dub);
  const sag = t > HEARTBEAT_PHASE ? 0.06 * easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE)) : 0;
  return 1 + beat * 0.42 * strength - sag;
}

/**
 * The amplitude/energy envelope (→ uAmp + shadow strength). Tracks the beats
 * during the lub-dub then a bright flare at the burst, decaying through the
 * afterglow. NOTE: shipped as DATA (`tempo.frame.amp`); this copy exists only
 * so the tests can pin the data delta-0 against the readable formula.
 */
export function heartburstEnvelope(life: number, strength = 1, doubleBeat = 1): number {
  const t = clamp01(life);
  if (t <= 0 || t >= 1) return 0;
  const lub = beatPulse(t, 0.1, 0.1);
  const dub = beatPulse(t, 0.21, 0.075) * 0.62 * clamp01(doubleBeat);
  const beats = Math.max(lub, dub) * 0.9 * strength;
  const b = burstProgress(life);
  const flare = b * Math.pow(1 - b, 1.1) * 2.4;
  return clamp01(Math.max(beats, flare * (0.7 + 0.3 * strength)));
}

/**
 * Burst progress 0..1 over the post-beat phase: 0 until the dub finishes, then
 * eases out to 1 as the little hearts fly out and fade.
 */
export function burstProgress(life: number): number {
  const t = clamp01(life);
  if (t <= HEARTBEAT_PHASE) return 0;
  return easeOutCubic((t - HEARTBEAT_PHASE) / (1 - HEARTBEAT_PHASE));
}

/**
 * Overall panel presence over normalized life: a quick snap-in, a proud hold
 * through the beats + burst, then a clean fade at the tail so the panel clears.
 */
export function heartPresence(life: number): number {
  const t = life < 0 ? 0 : life > 1 ? 1 : life;
  if (t < 0.04) return t / 0.04;
  if (t < 0.8) return 1;
  const fade = 1 - (t - 0.8) / 0.2;
  return Math.pow(Math.max(0, fade), 1.4);
}

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
/** Hero-heart size relative to the targeted element box (≈1.5×). See the Swift
 * `HEARTBURST_TARGET_FILL` — keep the two in sync. */
const HEARTBURST_TARGET_FILL = 3.6;

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
/**
 * The per-frame panel draw in the generic `PanelDraw` shape — the ONE
 * code-shaped hook the data-driven factory wires (`registerDopePanelEffect`).
 * Computes the draw-side tempo (beat scale, presence, target span) and hands
 * off to {@link drawHeartburstPanel}.
 */
export const drawHeartburstFrame: PanelDraw = (pctx, w, h, params, info) => {
  const p = params as unknown as HeartburstRenderParams;
  const scale = heartbeatScale(info.life, p.beatStrength, p.doubleBeat);
  const presence = heartPresence(info.life);
  const span = Math.min(info.targetPx.width, info.targetPx.height);
  drawHeartburstPanel(pctx, w, h, p, scale, info.life, presence, info.dpr, info.centerPx, span);
};

export function drawHeartburstPanel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: HeartburstRenderParams,
  heartScaleMul: number,
  life: number,
  presence: number,
  dpr: number,
  center: { x: number; y: number },
  span: number,
): void {
  ctx.clearRect(0, 0, w, h);
  if (presence <= 0.001) return;

  // Position the hearts on the targeted element (centre) and size them to its box
  // (`span`), so the centrepiece matches the page element instead of the canvas.
  const cx = center.x;
  const cy = center.y;
  // The hero heart reads at ~150% of the targeted element (heartScale ~0.22 ⇒
  // heart extent ≈ 1.5× the box), clamped to the canvas so a full-page fire
  // (target == canvas) keeps its original size. Sync w/ HeartburstPanel.swift.
  const minDim = Math.min(span * HEARTBURST_TARGET_FILL, Math.min(w, h));
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
