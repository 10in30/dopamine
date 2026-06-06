/**
 * WebGL2 renderer for **Calligraphic Verdict** (the ink-stroke success effect).
 *
 * Mirrors the Solarbloom renderer's contract: `createInkstroke` builds the
 * program and exposes `renderAt(elapsedMs)`, a pure function of time, so it can
 * be driven by the wall clock (`runInkstroke`) or a fixed offline timestep. No
 * per-frame randomness → a given `elapsedMs` always yields the same frame.
 *
 * Unlike Solarbloom there is no origin: the gesture composes itself across the
 * whole viewport, so the renderer only needs canvas + params + dpr.
 */

import { envelope, strokeProgress, NPR_TIME_STEP_MS } from "./tempo.js";
import type { InkRenderParams } from "./mood.js";
import { INK_FRAGMENT_SRC, INK_VERTEX_SRC } from "./inkstroke-shader.js";

export interface InkstrokeRenderer {
  readonly durationMs: number;
  renderAt(elapsedMs: number): void;
  dispose(): void;
}

export interface InkRunHandle {
  done: Promise<void>;
  stop: () => void;
}

const UNIFORMS = [
  "uResolution", "uDraw", "uLife", "uTimeS", "uAmp", "uExposure", "uScale",
  "uPressure", "uWetness", "uBristle", "uDroplets", "uSeed", "uStyle",
  "uC0", "uC1", "uC2",
] as const;

type UniformName = (typeof UNIFORMS)[number];
type UniformMap = Record<UniformName, WebGLUniformLocation | null>;

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
  const vs = compile(gl, gl.VERTEX_SHADER, INK_VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, INK_FRAGMENT_SRC);
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

export function createInkstroke(
  canvas: HTMLCanvasElement,
  params: InkRenderParams,
  dpr: number,
): InkstrokeRenderer {
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

  const resize = () => {
    const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
  };
  resize();
  window.addEventListener("resize", resize);

  let disposed = false;

  const renderAt = (elapsedMs: number) => {
    if (disposed) return;
    // Hand-drawn "on twos": snap the animation clock toward a coarse grid as
    // style (whimsy) rises. style 0 → continuous; style 1 → fully stepped.
    const stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS;
    const animMs = elapsedMs + (stepped - elapsedMs) * params.style;
    const life = Math.min(Math.max(animMs, 0) / params.durationMs, 1);
    const amp = envelope(life, params.overshoot);

    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.uResolution, canvas.width, canvas.height);
    gl.uniform1f(u.uDraw, strokeProgress(animMs));
    gl.uniform1f(u.uLife, life);
    gl.uniform1f(u.uTimeS, animMs / 1000);
    gl.uniform1f(u.uAmp, amp);
    gl.uniform1f(u.uExposure, params.exposure);
    gl.uniform1f(u.uScale, params.scale);
    gl.uniform1f(u.uPressure, params.pressure);
    gl.uniform1f(u.uWetness, params.wetness);
    gl.uniform1f(u.uBristle, params.bristle);
    gl.uniform1f(u.uDroplets, params.droplets);
    gl.uniform1f(u.uSeed, params.inkSeed);
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
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
  };

  return { durationMs: params.durationMs, renderAt, dispose };
}

/** Play one Calligraphic Verdict in real time, driven by the wall clock + RAF. */
export function runInkstroke(
  canvas: HTMLCanvasElement,
  params: InkRenderParams,
  dpr: number,
): InkRunHandle {
  const renderer = createInkstroke(canvas, params, dpr);
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
