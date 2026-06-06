/**
 * WebGL2 renderer for Solarbloom. Owns a program + RAF loop, feeds the shader
 * the tempo envelope each frame, and resolves a promise when the afterglow ends.
 */

import { checkProgress, envelope } from "./tempo.js";
import type { RenderParams } from "./mood.js";
import { FRAGMENT_SRC, VERTEX_SRC } from "./shader.js";

export interface RunHandle {
  /** Resolves when the animation has fully played out and torn down. */
  done: Promise<void>;
  /** Stop early (e.g. on unmount). */
  stop: () => void;
}

const UNIFORMS = [
  "uResolution", "uOrigin", "uAmp", "uCheck", "uLife", "uTimeS", "uExposure",
  "uBloomRadius", "uTurbulence", "uMoteSpeed", "uMoteCount", "uMoteSeed",
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

/**
 * Play one Solarbloom on `canvas`. `originCss` is in CSS pixels relative to the
 * canvas's top-left; `dpr` is the device-pixel ratio to render at.
 */
export function runSolarbloom(
  canvas: HTMLCanvasElement,
  params: RenderParams,
  originCss: { x: number; y: number },
  dpr: number,
): RunHandle {
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

  let raf = 0;
  let stopped = false;
  const start = performance.now();
  const [c0, c1, c2] = params.palette;

  let resolveDone!: () => void;
  const done = new Promise<void>((res) => (resolveDone = res));

  const cleanup = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    window.removeEventListener("resize", resize);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    resolveDone();
  };

  const frame = (now: number) => {
    if (stopped) return;
    const elapsed = now - start;
    const life = Math.min(elapsed / params.durationMs, 1);
    const amp = envelope(life, params.overshoot);

    resize();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.uniform2f(u.uResolution, canvas.width, canvas.height);
    // Flip Y: gl_FragCoord origin is bottom-left.
    gl.uniform2f(u.uOrigin, originCss.x * dpr, canvas.height - originCss.y * dpr);
    gl.uniform1f(u.uAmp, amp);
    gl.uniform1f(u.uCheck, checkProgress(elapsed));
    gl.uniform1f(u.uLife, life);
    gl.uniform1f(u.uTimeS, elapsed / 1000);
    gl.uniform1f(u.uExposure, params.exposure);
    gl.uniform1f(u.uBloomRadius, params.bloomRadius);
    gl.uniform1f(u.uTurbulence, params.turbulence);
    gl.uniform1f(u.uMoteSpeed, params.moteSpeed);
    gl.uniform1f(u.uMoteCount, params.moteCount);
    gl.uniform1f(u.uMoteSeed, params.moteSeed);
    gl.uniform3f(u.uC0, c0.r, c0.g, c0.b);
    gl.uniform3f(u.uC1, c1.r, c1.g, c1.b);
    gl.uniform3f(u.uC2, c2.r, c2.g, c2.b);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (elapsed >= params.durationMs) {
      cleanup();
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return { done, stop: cleanup };
}
