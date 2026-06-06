/**
 * WebGL2 renderer for Solarbloom.
 *
 * `createSolarbloom` builds the program and exposes `renderAt(elapsedMs)`, a
 * pure function of time — so it can be driven by either the wall clock
 * (`runSolarbloom`, for real use) or an explicit fixed timestep (offline,
 * frame-perfect capture). The shader has no per-frame randomness, so a given
 * `elapsedMs` always yields the same frame.
 */

import { checkProgress, envelope, NPR_TIME_STEP_MS } from "./tempo.js";
import type { RenderParams } from "./mood.js";
import { shadowGeometry } from "./shadow.js";
import { FRAGMENT_SRC, VERTEX_SRC } from "./shader.js";

export interface SolarbloomRenderer {
  readonly durationMs: number;
  /** Render the frame at `elapsedMs` since the start of the effect. */
  renderAt(elapsedMs: number): void;
  /** Free GL resources and listeners. */
  dispose(): void;
}

export interface RunHandle {
  /** Resolves when the animation has fully played out and torn down. */
  done: Promise<void>;
  /** Stop early (e.g. on unmount). */
  stop: () => void;
}

const UNIFORMS = [
  "uResolution", "uOrigin", "uAmp", "uCheck", "uLife", "uTimeS", "uExposure",
  "uBloomRadius", "uTurbulence", "uMoteSpeed", "uMoteCount", "uMoteSeed",
  "uIridescence", "uDispersion", "uStyle", "uC0", "uC1", "uC2",
  "uShadow", "uShadowOffset", "uShadowSoft", "uShadowStrength",
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
  const vs = compile(gl, gl.VERTEX_SHADER, VERTEX_SRC);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SRC);
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

interface Pass {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  program: WebGLProgram;
  u: UniformMap;
  vao: WebGLVertexArrayObject | null;
}

function makePass(canvas: HTMLCanvasElement): Pass {
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
  return { gl, canvas, program, u, vao };
}

/**
 * Build a renderer for `canvas`. `originCss` is in CSS pixels relative to the
 * canvas's top-left; `dpr` is the device-pixel ratio to render at.
 *
 * `shadowCanvas` (optional) is a second, identically-sized full-bleed canvas
 * composited with `mix-blend-mode: multiply`. When given, every frame also
 * renders a soft, offset occlusion silhouette of the bright forms onto it, so
 * the effect casts a real shadow into the UI beneath. The light pass is
 * byte-for-byte unchanged whether or not a shadow canvas is supplied.
 */
export function createSolarbloom(
  canvas: HTMLCanvasElement,
  params: RenderParams,
  originCss: { x: number; y: number },
  dpr: number,
  shadowCanvas?: HTMLCanvasElement | null,
): SolarbloomRenderer {
  const light = makePass(canvas);
  const shadow = shadowCanvas ? makePass(shadowCanvas) : null;
  const [c0, c1, c2] = params.palette;

  const resizeOne = (c: HTMLCanvasElement) => {
    const w = Math.max(1, Math.round(c.clientWidth * dpr));
    const h = Math.max(1, Math.round(c.clientHeight * dpr));
    if (c.width !== w || c.height !== h) {
      c.width = w;
      c.height = h;
    }
  };
  const resize = () => {
    resizeOne(canvas);
    if (shadowCanvas) resizeOne(shadowCanvas);
  };
  resize();
  window.addEventListener("resize", resize);

  let disposed = false;

  // Shadow geometry: offset + softness scale with bloom radius (≈ element
  // "height" above the page) and with amplitude (a brighter source throws a
  // crisper, slightly longer shadow). Direction is down-and-right — a single
  // implied key light up-and-left of the floating effect.
  const renderPass = (
    pass: Pass,
    animMs: number,
    life: number,
    amp: number,
    isShadow: boolean,
  ) => {
    const { gl, canvas: c, program, u, vao } = pass;
    gl.viewport(0, 0, c.width, c.height);
    // Shadow layer clears to WHITE (multiply identity); light to BLACK (screen
    // identity). So an untouched frame is a no-op on either blend mode.
    if (isShadow) gl.clearColor(1, 1, 1, 1);
    else gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.uResolution, c.width, c.height);
    // Flip Y: gl_FragCoord origin is bottom-left.
    gl.uniform2f(u.uOrigin, originCss.x * dpr, c.height - originCss.y * dpr);
    gl.uniform1f(u.uAmp, amp);
    gl.uniform1f(u.uCheck, checkProgress(animMs));
    gl.uniform1f(u.uLife, life);
    gl.uniform1f(u.uTimeS, animMs / 1000);
    gl.uniform1f(u.uExposure, params.exposure);
    gl.uniform1f(u.uBloomRadius, params.bloomRadius);
    gl.uniform1f(u.uTurbulence, params.turbulence);
    gl.uniform1f(u.uMoteSpeed, params.moteSpeed);
    gl.uniform1f(u.uMoteCount, params.moteCount);
    gl.uniform1f(u.uMoteSeed, params.moteSeed);
    gl.uniform1f(u.uIridescence, params.iridescence);
    gl.uniform1f(u.uDispersion, params.dispersion);
    gl.uniform1f(u.uStyle, params.style);
    gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
    gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
    gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);

    gl.uniform1f(u.uShadow, isShadow ? 1 : 0);
    if (isShadow) {
      const minDim = Math.min(c.width, c.height);
      const sg = shadowGeometry({
        minDim,
        heightFrac: params.bloomRadius,
        amp,
        style: params.style,
      });
      gl.uniform2f(u.uShadowOffset, sg.offsetX, sg.offsetY);
      gl.uniform1f(u.uShadowSoft, sg.soft);
      gl.uniform1f(u.uShadowStrength, sg.strength);
    }
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };

  const renderAt = (elapsedMs: number) => {
    if (disposed) return;
    // Hand-drawn "on twos": snap the animation clock toward a coarse grid as
    // style (whimsy) rises. style 0 → continuous; style 1 → fully stepped.
    const stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS;
    const animMs = elapsedMs + (stepped - elapsedMs) * params.style;
    const life = Math.min(Math.max(animMs, 0) / params.durationMs, 1);
    const amp = envelope(life, params.overshoot);

    resize();
    if (shadow) renderPass(shadow, animMs, life, amp, true);
    renderPass(light, animMs, life, amp, false);
  };

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    window.removeEventListener("resize", resize);
    light.gl.deleteVertexArray(light.vao);
    light.gl.deleteProgram(light.program);
    if (shadow) {
      shadow.gl.deleteVertexArray(shadow.vao);
      shadow.gl.deleteProgram(shadow.program);
    }
  };

  return { durationMs: params.durationMs, renderAt, dispose };
}

/** Play one Solarbloom in real time, driven by the wall clock + RAF. */
export function runSolarbloom(
  canvas: HTMLCanvasElement,
  params: RenderParams,
  originCss: { x: number; y: number },
  dpr: number,
  shadowCanvas?: HTMLCanvasElement | null,
): RunHandle {
  const renderer = createSolarbloom(canvas, params, originCss, dpr, shadowCanvas);
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
