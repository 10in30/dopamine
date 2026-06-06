/**
 * WebGL2 + Canvas2D HYBRID renderer for **Comic Impact** (the "BAM! POW!"
 * fight-panel success effect).
 *
 * Mirrors the Solarbloom / Verdict renderer contract: `createComic` builds the
 * program and exposes `renderAt(elapsedMs)`, a pure function of time (no
 * per-frame randomness), so it can be driven by the wall clock (`runComic`) or a
 * fixed offline timestep.
 *
 * The crisp, vector-y parts — the jagged starburst and the blocky hand-lettered
 * onomatopoeia word with bold ink outlines — are drawn into an OFFSCREEN
 * Canvas2D each frame (cheap: a few paths) and uploaded as the "panel" texture.
 * The fragment shader (comic-shader.ts) adds the Ben-Day halftone, radiating
 * action lines, impact flash and the noir↔pop-art styling, and composites
 * everything as cast light through the screen-blend overlay.
 *
 * Panel channel encoding consumed by the shader:
 *   R = word fill · G = ink (all black contours) · B = starburst fill
 */

import { impactScale, impactPresence, IMPACT_MS, IMPACT_HOLD_MS } from "./tempo.js";
import { isCheckmark, type ComicRenderParams } from "./mood.js";
import { COMIC_FRAGMENT_SRC, COMIC_VERTEX_SRC } from "./comic-shader.js";
import { mulberry32 } from "./seed.js";
import { EMBEDDED_FACES } from "./comic-fonts.js";

export interface ComicRenderer {
  readonly durationMs: number;
  renderAt(elapsedMs: number): void;
  dispose(): void;
}

export interface ComicRunHandle {
  done: Promise<void>;
  stop: () => void;
}

const UNIFORMS = [
  "uPanel", "uResolution", "uCenter", "uLife", "uTimeS", "uPresence", "uFlash",
  "uExposure", "uHalftone", "uDotSize", "uSaturation", "uActionLines",
  "uInkBoost", "uSeed", "uStyle", "uC0", "uC1", "uC2",
] as const;

type UniformName = (typeof UNIFORMS)[number];
type UniformMap = Record<UniformName, WebGLUniformLocation | null>;

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

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("dopamine: failed to create shader");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(sh);
    gl.deleteShader(sh);
    throw new Error(`dopamine: shader compile error\n${log ?? ""}`);
  }
  return sh;
}

function link(gl: WebGL2RenderingContext): WebGLProgram {
  const vs = compile(gl, gl.VERTEX_SHADER, COMIC_VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, COMIC_FRAGMENT_SRC);
  const program = gl.createProgram();
  if (!program) throw new Error("dopamine: failed to create program");
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`dopamine: program link error\n${log ?? ""}`);
  }
  return program;
}

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
function drawPanel(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  params: ComicRenderParams,
  scale: number,
  presence: number,
  dpr: number,
): void {
  ctx.clearRect(0, 0, w, h);
  if (presence <= 0.001) return;

  const cx = w * 0.5;
  const cy = h * 0.5;
  const minDim = Math.min(w, h);
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

export function createComic(
  canvas: HTMLCanvasElement,
  params: ComicRenderParams,
  dpr: number,
): ComicRenderer {
  const gl = canvas.getContext("webgl2", {
    alpha: false,
    antialias: false,
    premultipliedAlpha: false,
    powerPreference: "high-performance",
  });
  if (!gl) throw new Error("dopamine: WebGL2 is not available");

  const program = link(gl);
  const u = Object.fromEntries(
    UNIFORMS.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as UniformMap;
  const vao = gl.createVertexArray();
  const [c0, c1, c2] = params.palette;

  // Offscreen Canvas2D for the panel (word + burst + ink contours).
  const panel = document.createElement("canvas");
  const pctx = panel.getContext("2d", { alpha: true })!;

  // Panel texture.
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    if (panel.width !== w || panel.height !== h) {
      panel.width = w;
      panel.height = h;
    }
  };
  resize();
  window.addEventListener("resize", resize);

  let disposed = false;

  const renderAt = (elapsedMs: number) => {
    if (disposed) return;
    resize();
    const W = canvas.width;
    const H = canvas.height;

    const life = Math.min(Math.max(elapsedMs, 0) / params.durationMs, 1);
    const scale = impactScale(elapsedMs, params.overshoot);
    const presence = impactPresence(life);

    // Impact FLASH: a hard spike right at the slam, decaying over ~IMPACT_MS,
    // with a faint secondary on the recoil settle.
    const flash =
      Math.exp(-elapsedMs / (IMPACT_MS * 0.55)) +
      0.25 * Math.exp(-Math.abs(elapsedMs - IMPACT_HOLD_MS * 0.2) / (IMPACT_MS * 0.8));

    // Redraw the offscreen panel for this frame's scale/presence.
    // (The flicker "on twos" of the word lives in the panel too: snap presence
    // grid is unnecessary — scale already settled by IMPACT_MS.)
    drawPanel(pctx, W, H, params, scale, presence, dpr);

    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    // Upload the panel. Canvas2D is top-left origin; flip Y so it matches the
    // shader's bottom-left vUv space.
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, panel);
    gl.uniform1i(u.uPanel, 0);

    gl.uniform2f(u.uResolution, W, H);
    gl.uniform2f(u.uCenter, W * 0.5, H * 0.5);
    gl.uniform1f(u.uLife, life);
    gl.uniform1f(u.uTimeS, elapsedMs / 1000);
    gl.uniform1f(u.uPresence, presence);
    gl.uniform1f(u.uFlash, Math.min(flash, 1.2));
    gl.uniform1f(u.uExposure, params.exposure);
    gl.uniform1f(u.uHalftone, params.halftone);
    gl.uniform1f(u.uDotSize, params.dotSize * dpr);
    gl.uniform1f(u.uSaturation, params.saturation);
    gl.uniform1f(u.uActionLines, params.actionLines);
    gl.uniform1f(u.uInkBoost, 1.0 + params.style * 0.4);
    gl.uniform1f(u.uSeed, params.comicSeed);
    gl.uniform1f(u.uStyle, params.style);
    gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
    gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
    gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("resize", resize);
    gl.deleteTexture(tex);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
  };

  return { durationMs: params.durationMs, renderAt, dispose };
}

/** Play one Comic Impact in real time, driven by the wall clock + RAF. */
export function runComic(
  canvas: HTMLCanvasElement,
  params: ComicRenderParams,
  dpr: number,
): ComicRunHandle {
  const renderer = createComic(canvas, params, dpr);
  let raf = 0;
  let stopped = false;
  const start = performance.now();

  let resolveDone!: () => void;
  const done = new Promise<void>((res) => (resolveDone = res));

  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    renderer.dispose();
    resolveDone();
  };

  const frame = (now: number) => {
    if (stopped) return;
    const elapsed = now - start;
    renderer.renderAt(elapsed);
    if (elapsed >= params.durationMs) {
      stop();
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return { done, stop };
}
