/**
 * Comic Impact Canvas2D PANEL drawing + bundled-font loading.
 *
 * The crisp, vector-y parts of Comic Impact — the jagged starburst and the
 * blocky hand-lettered onomatopoeia word with bold ink outlines — are drawn into
 * an OFFSCREEN Canvas2D each frame (cheap: a few paths) and uploaded as the
 * "panel" texture; the fragment shader (comic-shader.ts) adds the Ben-Day
 * halftone, action lines, flash and noir↔pop-art styling. `drawPanel` (the
 * offscreen draw) and `ensureComicFonts` (the bundled-face loader) live here and
 * are consumed by the Comic `EffectFactory` (effects/comic.ts), which owns the
 * GL pass via the shared, program-cached context + the conductor.
 *
 * Panel channel encoding consumed by the shader:
 *   R = word fill · G = ink (all black contours) · B = starburst fill
 */

import { type ComicRenderParams, isCheckmark } from "./comic-params.js";
import { mulberry32 } from "@dopamine/core";
import { EMBEDDED_FACES } from "./comic-fonts.js";

// ---------------------------------------------------------------------------
// BUNDLED FONT LOADING
//
// The effect must NOT silently depend on a host font being installed, so the
// SIL OFL display faces (Bangers / Anton / Luckiest Guy) ship base64-embedded
// (comic-fonts.ts) and are registered via the FontFace API. We kick this off
// once at module import and await it before the first paint; if it fails for
// any reason the renderer still draws using the robust fallback stack (and the
// mood/whimsy difference still reads via the procedural treatment).
// ---------------------------------------------------------------------------

let fontsReady: Promise<void> | null = null;

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/** Register + load the embedded faces once. Resolves even if loading fails. */
export function ensureComicFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  if (
    typeof document === "undefined" ||
    typeof FontFace === "undefined" ||
    !(document as Document).fonts
  ) {
    fontsReady = Promise.resolve();
    return fontsReady;
  }
  fontsReady = (async () => {
    await Promise.all(
      EMBEDDED_FACES.map(async (f) => {
        try {
          // Skip if a face by this family is already registered (e.g. host has it).
          const face = new FontFace(f.family, base64ToArrayBuffer(f.base64));
          await face.load();
          (document as Document).fonts.add(face);
        } catch {
          /* fall back to the system stack for this face */
        }
      }),
    );
    try {
      await (document as Document).fonts.ready;
    } catch {
      /* ignore */
    }
  })();
  return fontsReady;
}

// Begin loading as soon as the module is imported so faces are usually ready by
// the time the user fires the effect.
if (typeof document !== "undefined") void ensureComicFonts();

/**
 * Draw the offscreen panel for this frame: a jagged starburst balloon, the
 * onomatopoeia word in blocky outlined block caps, all at the current impact
 * scale + a tiny rotation tilt. Encodes masks into channels:
 *   R = word fill, G = ink (contours), B = burst fill.
 *
 * We draw ink as the GREEN channel and the two fills as RED/BLUE so we can
 * blend them independently in the shader. To keep channels independent we draw
 * each layer onto the same 2D context but only write the intended channel.
 */
/** Starburst + word size relative to the targeted element box (≈1.5×). See the
 * Swift `COMIC_TARGET_FILL` — keep the two in sync. */
const COMIC_TARGET_FILL = 1.7;

export function drawPanel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: ComicRenderParams,
  scale: number,
  presence: number,
  dpr: number,
  center: { x: number; y: number },
  span: number,
): void {
  ctx.clearRect(0, 0, w, h);
  if (presence <= 0.001) return;

  // Position + size the word/starburst to the targeted element (defaults to the
  // canvas centre + full canvas, reproducing the old screen-centred pose).
  const cx = center.x;
  const cy = center.y;
  // The starburst + word read at ~150% of the targeted element, clamped to the
  // canvas so a full-page fire (target == canvas) keeps its original size. Kept in
  // sync with ComicPanel.swift. TUNABLE.
  const minDim = Math.min(span * COMIC_TARGET_FILL, Math.min(w, h));
  const rng = mulberry32((params.comicSeed * 1000) >>> 0);

  // Deterministic per-fire tilt so the panel feels hand-placed (a few degrees).
  const tilt = ((params.comicSeed % 1) - 0.5) * 0.18; // ~±5deg

  // ---------- STARBURST BALLOON (B channel) --------------------------------
  // A classic many-pointed jagged star: alternating long/short radii with
  // per-point jitter. Drawn solid into BLUE; its bold outline into GREEN.
  const points = Math.max(8, Math.round(params.burstPoints));
  const outerR = minDim * params.scale * 1.3 * scale;
  const innerR = outerR * 0.64;
  const burstPts: [number, number][] = [];
  for (let i = 0; i < points * 2; i++) {
    const t = i / (points * 2);
    const a = t * Math.PI * 2 - Math.PI / 2 + tilt;
    const even = i % 2 === 0;
    const jitter = 0.82 + rng() * 0.36;
    const r = (even ? outerR : innerR) * jitter;
    burstPts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const tracePath = () => {
    ctx.beginPath();
    burstPts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    ctx.closePath();
  };

  const ink = params.inkWeight * dpr * scale;

  // Burst FILL -> BLUE only.
  ctx.save();
  ctx.globalCompositeOperation = "lighter"; // additive into channels
  tracePath();
  ctx.fillStyle = `rgba(0,0,${Math.round(255 * presence)},1)`;
  ctx.fill();
  ctx.restore();

  // Burst OUTLINE -> GREEN (ink). Thick bold contour.
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineJoin = "miter";
  ctx.miterLimit = 2;
  tracePath();
  ctx.lineWidth = ink * 1.3;
  ctx.strokeStyle = `rgba(0,${Math.round(255 * presence)},0,1)`;
  ctx.stroke();
  ctx.restore();

  // ---------- LETTERING (success word) or CHECKMARK ------------------------
  // Mood selects the bundled display face + base character (skew/stretch/tilt);
  // whimsy shifts the treatment from restrained inked caps (noir) to fat,
  // inflated, multi-layer-inked, 3D-extruded, per-letter-bounced pop-art. The
  // owner also wants a big bold ✓ as a selectable option — that's drawn as a
  // VECTOR path (not a font glyph) so it's reliable everywhere.
  const fillA = Math.round(255 * presence);
  const inkStyle = `rgba(0,${fillA},0,1)`;
  const fillStyle = `rgba(${fillA},0,0,1)`;
  const round = params.inkRoundness;

  // Per-letter / per-shape deterministic jitter, derived from the per-fire seed.
  const jrng = mulberry32((params.comicSeed * 2654435761) >>> 0);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(tilt + params.fontTilt);
  // Italic lean + non-uniform stretch as a shared transform on the whole word.
  // matrix: [stretchX, 0, skewX, 1] (a=stretch horiz, c=shear).
  ctx.transform(params.fontStretchX, 0, params.fontSkew, 1, 0, 0);
  ctx.lineJoin = round > 0.5 ? "round" : "miter";
  ctx.lineCap = round > 0.5 ? "round" : "butt";
  ctx.miterLimit = 2;
  ctx.globalCompositeOperation = "lighter"; // additive into channels

  if (isCheckmark(params.word)) {
    // ----- VECTOR CHECKMARK -----------------------------------------------
    // A bold two-segment tick centred on the panel, sized to the burst's inner
    // span. Drawn as a stroked path; ink contour + 3D extrude + bright fill use
    // the same treatment knobs as the word path below.
    const span = innerR * 1.25; // overall check width
    const strokeW = span * 0.24 * (0.85 + round * 0.25);
    const extrude = span * params.extrudeDepth;
    // Check geometry (down-stroke then long up-flick), centred.
    const pts: [number, number][] = [
      [-span * 0.42, span * 0.02],
      [-span * 0.12, span * 0.34],
      [span * 0.46, -span * 0.36],
    ];
    const traceCheck = () => {
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
    };
    // 3D extrude: stacked ink copies stepping down-right (pop-art only).
    if (extrude > 0.5) {
      const steps = 8;
      for (let s = steps; s >= 1; s--) {
        const dx = (extrude * s) / steps;
        const dy = (extrude * s) / steps;
        ctx.save();
        ctx.translate(dx, dy);
        traceCheck();
        ctx.lineWidth = strokeW;
        ctx.strokeStyle = inkStyle;
        ctx.stroke();
        ctx.restore();
      }
    }
    // Bold ink contour (heavier toward pop-art via outlineLayers).
    traceCheck();
    ctx.lineWidth = strokeW + ink * (1.2 + params.outlineLayers * 0.5);
    ctx.strokeStyle = inkStyle;
    ctx.stroke();
    // Bright fill body.
    traceCheck();
    ctx.lineWidth = strokeW;
    ctx.strokeStyle = fillStyle;
    ctx.stroke();
    ctx.restore();
    return;
  }

  // ----- WORD RUN ---------------------------------------------------------
  const word = params.word;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const fontFor = (px: number) => `${px}px ${params.fontStack}`;

  // Target size, then SHRINK-TO-FIT so longer words (GREAT!/DONE!) never spill
  // out of the burst. Account for the extra horizontal stretch + tracking.
  let fontPx = minDim * params.scale * 0.92 * scale;
  ctx.font = fontFor(fontPx);
  const chars = [...word];
  const trackPx = () => fontPx * params.fontTracking;
  const runWidth = (): number => {
    let total = 0;
    for (const ch of chars) total += ctx.measureText(ch).width + trackPx();
    return Math.max(1, total - trackPx());
  };
  const maxW = (innerR * 1.7) / Math.max(0.6, params.fontStretchX);
  let measured = runWidth();
  if (measured > maxW) {
    fontPx *= maxW / measured;
    ctx.font = fontFor(fontPx);
    measured = runWidth();
  }

  const extrude = fontPx * params.extrudeDepth;
  const inkLine = ink * (1.3 + (params.outlineLayers - 1) * 0.7);

  // Lay out letters individually so we can apply per-letter rotation/baseline
  // jitter (the pop-art bounce). Start at the left edge of the centred run.
  let penX = -measured / 2;
  type Letter = { ch: string; x: number; rot: number; dy: number; wgt: number };
  const letters: Letter[] = chars.map((ch) => {
    const wpx = ctx.measureText(ch).width;
    const x = penX + wpx / 2;
    penX += wpx + trackPx();
    const rot = (jrng() - 0.5) * 2 * params.letterRotJitter;
    const dy = (jrng() - 0.5) * 2 * params.letterBaselineJitter * fontPx;
    return { ch, x, rot, dy, wgt: jrng() };
  });

  const drawLetters = (
    cb: (ctx: CanvasRenderingContext2D, l: Letter) => void,
  ) => {
    for (const l of letters) {
      ctx.save();
      ctx.translate(l.x, l.dy);
      ctx.rotate(l.rot);
      cb(ctx, l);
      ctx.restore();
    }
  };

  // 3D extrude / drop: stacked ink copies stepping down-right behind the body
  // (pop-art pops, flat at noir).
  if (extrude > 0.5) {
    const steps = 8;
    for (let s = steps; s >= 1; s--) {
      const dx = (extrude * s) / steps;
      const dy = (extrude * s) / steps;
      drawLetters((c, l) => {
        c.fillStyle = inkStyle;
        c.fillText(l.ch, dx, dy);
      });
    }
  }

  // Bold INK contour — drawn under the fill so the outline frames the letters.
  // outlineLayers stacks slightly fattening passes for the inflated balloon look.
  for (let layer = params.outlineLayers; layer >= 1; layer--) {
    const lw = inkLine * (1 + (layer - 1) * 0.5);
    drawLetters((c, l) => {
      c.lineJoin = round > 0.5 ? "round" : "miter";
      c.lineWidth = lw;
      c.strokeStyle = inkStyle;
      c.strokeText(l.ch, 0, 0);
    });
  }

  // Bright FILL body on top.
  drawLetters((c, l) => {
    c.fillStyle = fillStyle;
    c.fillText(l.ch, 0, 0);
  });

  ctx.restore();
}
