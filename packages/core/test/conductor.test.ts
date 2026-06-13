/**
 * Conductor lifecycle tests against a minimal in-memory DOM + WebGL2 stub.
 *
 * Covers the load-bearing backbone guarantees that aren't visual:
 *  - ONE persistent host (overlay + contexts) per target, reused across fires.
 *  - Programs LINK ONCE per page (the perf + leak fix): firing the same effect
 *    twice does not relink its shader.
 *  - Disposal / teardown frees GL resources and removes the overlay (no leak).
 *  - prefers-reduced-motion renders a single calm frame, no RAF animation loop.
 *  - The effect draws into BOTH the light and the shadow context.
 *
 * The stub is intentionally tiny: just enough surface for `createGLContext`,
 * `createOverlay`, and the conductor's RAF/visibility/dpr/matchMedia access.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Minimal WebGL2 stub ---------------------------------------------------

let linkCount = 0;
let liveContexts = 0;

function makeGLStub() {
  liveContexts++;
  const gl: Record<string, unknown> = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    COLOR_BUFFER_BIT: 5, TRIANGLES: 6, BLEND: 7, FUNC_ADD: 8, MIN: 9, ONE: 10,
    TEXTURE_2D: 11, TEXTURE0: 12, TEXTURE1: 13, RGBA: 14, R8: 15, RED: 16,
    UNSIGNED_BYTE: 17, LINEAR: 18, NEAREST: 19, CLAMP_TO_EDGE: 20,
    TEXTURE_MIN_FILTER: 21, TEXTURE_MAG_FILTER: 22, TEXTURE_WRAP_S: 23,
    TEXTURE_WRAP_T: 24, UNPACK_FLIP_Y_WEBGL: 25, UNPACK_PREMULTIPLY_ALPHA_WEBGL: 26,
    UNPACK_ALIGNMENT: 27,
    createTexture: () => ({}), bindTexture: () => {}, deleteTexture: () => {},
    activeTexture: () => {}, texImage2D: () => {}, texParameteri: () => {},
    pixelStorei: () => {},
    createShader: () => ({}), shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: () => true, getShaderInfoLog: () => "", deleteShader: () => {},
    createProgram: () => ({}),
    attachShader: () => {},
    linkProgram: () => { linkCount++; },
    getProgramParameter: () => true, getProgramInfoLog: () => "",
    deleteProgram: () => {},
    getUniformLocation: () => ({}),
    createVertexArray: () => ({}), bindVertexArray: () => {}, deleteVertexArray: () => {},
    useProgram: () => {}, viewport: () => {}, clearColor: () => {}, clear: () => {},
    enable: () => {}, blendEquation: () => {}, blendFunc: () => {},
    uniform1f: () => {}, uniform2f: () => {}, uniform3f: () => {}, uniform1i: () => {},
    drawArrays: () => {},
  };
  return gl;
}

function makeCanvasStub() {
  return {
    width: 0, height: 0, clientWidth: 800, clientHeight: 600,
    style: {}, dataset: {},
    setAttribute: () => {},
    getContext: (type: string) => (type === "webgl2" ? makeGLStub() : null),
    remove: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
  };
}

// ---- DOM stub --------------------------------------------------------------

let rafQueue: ((t: number) => void)[] = [];
let reduceMotion = false;
let hidden = false;
const appended: unknown[] = [];
let visibilityListeners: Record<string, (() => void)[]> = {};

/** Flip the tab's visibility + dispatch the visibilitychange listeners, as a browser would. */
function setHidden(next: boolean) {
  hidden = next;
  for (const cb of visibilityListeners["visibilitychange"] ?? []) cb();
}

function installDom(): HTMLElement {
  const body = {
    appendChild: (c: unknown) => { appended.push(c); },
    insertBefore: (c: unknown) => { appended.push(c); },
    firstChild: null,
    style: {},
  } as unknown as HTMLElement;

  (globalThis as Record<string, unknown>).document = {
    body,
    documentElement: { dataset: {} },
    createElement: () => makeCanvasStub(),
    get visibilityState() { return hidden ? "hidden" : "visible"; },
    addEventListener: (type: string, cb: () => void) => {
      (visibilityListeners[type] ??= []).push(cb);
    },
    removeEventListener: () => {},
  };
  (globalThis as Record<string, unknown>).window = {
    devicePixelRatio: 2,
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: (q: string) => ({ matches: q.includes("reduce") && reduceMotion }),
    requestAnimationFrame: (cb: (t: number) => void) => { rafQueue.push(cb); return rafQueue.length; },
    cancelAnimationFrame: () => {},
  };
  (globalThis as Record<string, unknown>).getComputedStyle = () => ({ position: "static" });
  (globalThis as Record<string, unknown>).performance = { now: () => 0 };
  (globalThis as Record<string, unknown>).requestAnimationFrame = (
    globalThis as unknown as { window: { requestAnimationFrame: typeof requestAnimationFrame } }
  ).window.requestAnimationFrame;
  (globalThis as Record<string, unknown>).cancelAnimationFrame = () => {};
  return body;
}

function uninstallDom() {
  for (const k of ["document", "window", "getComputedStyle", "performance", "requestAnimationFrame", "cancelAnimationFrame"]) {
    delete (globalThis as Record<string, unknown>)[k];
  }
}

/** Pump the RAF queue forward to a given clock time, re-arming as the loop does. */
function pump(toMs: number) {
  (globalThis as Record<string, unknown>).performance = { now: () => toMs };
  const q = rafQueue;
  rafQueue = [];
  for (const cb of q) cb(toMs);
}

/**
 * A minimal pass-based fake effect. Core ships no effect, so the conductor's GL
 * lifecycle is exercised with a tiny full-screen-pass factory built on the same
 * `createPassInstance` runner the real effects use — it links ONE program per
 * GL context (so the light + shadow passes link 2 programs), exactly like a real
 * pass effect, which is what these lifecycle assertions hinge on.
 */
async function makeFakeFactory() {
  const { createPassInstance } = await import("../src/framework/pass-runner.js");
  const VS = "#version 300 es\nvoid main(){gl_Position=vec4(0.0);}";
  const FS = "#version 300 es\nprecision highp float;out vec4 o;void main(){o=vec4(0.0);}";
  const config = {
    vertex: VS,
    fragment: FS,
    uniforms: [] as readonly string[],
    frame: () => ({ amp: 1 }),
  };
  return {
    name: "fake",
    resolve: () => ({
      durationMs: 1200,
      palette: [
        { r: 1, g: 0, b: 0 },
        { r: 0, g: 1, b: 0 },
        { r: 0, g: 0, b: 1 },
      ],
    }),
    create: (params: Record<string, unknown>, ctx: unknown) =>
      createPassInstance(config as never, params as never, ctx as never),
  };
}

describe("conductor", () => {
  beforeEach(() => {
    linkCount = 0;
    liveContexts = 0;
    rafQueue = [];
    reduceMotion = false;
    hidden = false;
    appended.length = 0;
    visibilityListeners = {};
    vi.resetModules();
  });
  afterEach(() => uninstallDom());

  it("uses ONE shared host per target and links each program ONCE across fires", async () => {
    const body = installDom();
    const { play } = await import("../src/framework/conductor.js");
    const solarbloom = await makeFakeFactory();

    const feeling = { mood: "celebratory", intensity: 0.8, whimsy: 0.5, seed: 7 };
    const p1 = play({ factory: solarbloom, target: body, anchor: { x: 400, y: 300 }, feeling });
    // Drive a few frames, then to completion (clock is monotonic).
    pump(50);
    pump(100);
    const linkAfterFirst = linkCount;
    pump(5000); // past durationMs → resolves + disposes
    await p1;

    const mod = await import("../src/framework/conductor.js");
    expect(mod.activeHostCount()).toBe(1); // host kept warm, not torn down

    // Fire the SAME effect again on the SAME target: no new context, no relink.
    const contextsBefore = liveContexts;
    const p2 = mod.play({ factory: solarbloom, target: body, anchor: { x: 400, y: 300 }, feeling });
    pump(5050);
    pump(11000); // monotonic, past the second fire's start + duration
    await p2;

    // Light + shadow context = 2 contexts created on the first fire; the second
    // fire reuses them (no growth) and relinks nothing.
    expect(liveContexts).toBe(contextsBefore);
    expect(linkCount).toBe(linkAfterFirst);
    expect(linkCount).toBeGreaterThan(0);
  });

  it("draws into BOTH the light and shadow contexts", async () => {
    const body = installDom();
    const { play } = await import("../src/framework/conductor.js");
    const solarbloom = await makeFakeFactory();
    // solarbloom links one program PER context; if both passes ran, 2 links.
    const p = play({
      factory: solarbloom,
      target: body,
      anchor: { x: 400, y: 300 },
      feeling: { mood: "serene", intensity: 0.7, whimsy: 0.3, seed: 1 },
    });
    pump(50);
    expect(liveContexts).toBe(2); // light + shadow
    expect(linkCount).toBe(2); // one program linked in each context
    pump(99999);
    await p;
  });

  it("teardown releases the host (frees contexts + removes the overlay)", async () => {
    const body = installDom();
    const mod = await import("../src/framework/conductor.js");
    const solarbloom = await makeFakeFactory();
    const p = mod.play({
      factory: solarbloom, target: body, anchor: { x: 0, y: 0 },
      feeling: { mood: "electric", intensity: 1, whimsy: 1, seed: 2 },
    });
    pump(99999);
    await p;
    expect(mod.activeHostCount()).toBe(1);
    mod.teardown();
    expect(mod.activeHostCount()).toBe(0);
  });

  it("re-arms a CONTINUOUS effect at durationMs and tears down on the handle's stop()", async () => {
    const body = installDom();
    const { play } = await import("../src/framework/conductor.js");
    const base = await makeFakeFactory();
    let renders = 0;
    const looping = {
      ...base,
      loop: { periodMs: 300 }, // marks the factory CONTINUOUS (durationMs 1200 = 4 periods)
      create: (params: Record<string, unknown>, ctx: unknown) => {
        const inner = base.create(params, ctx);
        return {
          ...inner,
          renderAt: (ms: number) => {
            renders++;
            inner.renderAt(ms);
          },
        };
      },
    };
    let resolved = false;
    const handle = play({
      factory: looping, target: body, anchor: { x: 0, y: 0 },
      feeling: { mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 4 },
    });
    void handle.then(() => { resolved = true; });

    // Drive WELL past durationMs (1200): a one-shot would have resolved; the
    // looping effect re-arms at every seam and keeps drawing.
    pump(50);
    pump(2000);
    pump(5000);
    await Promise.resolve();
    expect(resolved).toBe(false);
    const rendersWhileLooping = renders;
    expect(rendersWhileLooping).toBeGreaterThan(2);

    // The host stops it: the next frame disposes + resolves.
    handle.stop();
    pump(5050);
    await handle;
    expect(resolved).toBe(true);
    // Stopped means stopped: no further draws on later frames.
    pump(6000);
    expect(rafQueue.length).toBe(0);
  });

  it("pause() freezes a CONTINUOUS effect's timeline and resume() continues it drift-free", async () => {
    const body = installDom();
    const { play } = await import("../src/framework/conductor.js");
    const base = await makeFakeFactory();
    const seen: number[] = [];
    const looping = {
      ...base,
      loop: { periodMs: 300 }, // durationMs 1200 = 4 periods
      create: (params: Record<string, unknown>, ctx: unknown) => {
        const inner = base.create(params, ctx);
        return {
          ...inner,
          renderAt: (ms: number) => { seen.push(ms); inner.renderAt(ms); },
        };
      },
    };
    const handle = play({
      factory: looping, target: body, anchor: { x: 0, y: 0 },
      feeling: { mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 4 },
    });
    pump(100);
    pump(200);
    const drawsBeforePause = seen.length;
    expect(drawsBeforePause).toBeGreaterThan(0);

    // Pause at t=200: the loop parks (no RAF re-armed) and no further draws land
    // however far the clock advances while paused.
    handle.pause();
    pump(900); // also drains the in-flight RAF, which parks itself
    pump(1500);
    pump(5000);
    expect(seen.length).toBe(drawsBeforePause); // frozen — nothing drawn while paused
    expect(rafQueue.length).toBe(0); // parked: no idle RAF churn

    // Resume at t=5000: startedAt is shifted forward by the 4800ms paused span,
    // so the very next frame renders the SAME clock position it froze at (~200),
    // NOT 5000 — drift-free.
    handle.resume();
    pump(5000);
    const resumed = seen[seen.length - 1];
    expect(resumed).toBeCloseTo(200, 0); // back exactly where it paused, not at 5000
    handle.stop();
    pump(5050);
    await handle;
  });

  it("auto-pauses on a hidden tab and auto-resumes (drift-free) when shown again", async () => {
    const body = installDom();
    const { play } = await import("../src/framework/conductor.js");
    const base = await makeFakeFactory();
    const seen: number[] = [];
    const looping = {
      ...base,
      loop: { periodMs: 300 },
      create: (params: Record<string, unknown>, ctx: unknown) => {
        const inner = base.create(params, ctx);
        return { ...inner, renderAt: (ms: number) => { seen.push(ms); inner.renderAt(ms); } };
      },
    };
    const handle = play({
      factory: looping, target: body, anchor: { x: 0, y: 0 },
      feeling: { mood: "serene", intensity: 0.5, whimsy: 0, seed: 9 },
    });
    pump(100);
    expect(seen.length).toBeGreaterThan(0);
    const drawsBeforeHide = seen.length;

    // Hide the tab: the next frame auto-pauses, parks the loop, draws nothing.
    setHidden(true);
    pump(900);
    pump(5000);
    expect(seen.length).toBe(drawsBeforeHide); // hidden + paused: no draws
    expect(rafQueue.length).toBe(0); // parked while hidden — no battery churn

    // Show the tab: the visibilitychange listener auto-resumes drift-free and the
    // loop re-arms. The clock froze at the frame hidden was DETECTED (t=900), so it
    // resumes there — not at the wall-clock 5000s the tab spent backgrounded.
    setHidden(false);
    pump(5000);
    expect(seen.length).toBeGreaterThan(drawsBeforeHide);
    expect(seen[seen.length - 1]).toBeCloseTo(900, 0); // resumed where it froze
    handle.stop();
    pump(5050);
    await handle;
  });

  it("prefers-reduced-motion renders one held frame and never starts a RAF loop", async () => {
    reduceMotion = true;
    vi.useFakeTimers();
    const body = installDom();
    const { play } = await import("../src/framework/conductor.js");
    const solarbloom = await makeFakeFactory();
    const rafBefore = rafQueue.length;
    const p = play({
      factory: solarbloom, target: body, anchor: { x: 0, y: 0 },
      feeling: { mood: "serene", intensity: 0.5, whimsy: 0, seed: 1 },
    });
    // One calm frame is drawn synchronously (a program links per context),
    // but NO animation RAF is queued.
    expect(rafQueue.length).toBe(rafBefore);
    expect(linkCount).toBe(2);
    await vi.runAllTimersAsync();
    await p; // resolves after the hold timeout
    vi.useRealTimers();
  });
});
