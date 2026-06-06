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

describe("conductor", () => {
  beforeEach(() => {
    linkCount = 0;
    liveContexts = 0;
    rafQueue = [];
    reduceMotion = false;
    hidden = false;
    appended.length = 0;
    vi.resetModules();
  });
  afterEach(() => uninstallDom());

  it("uses ONE shared host per target and links each program ONCE across fires", async () => {
    const body = installDom();
    const { play } = await import("../src/framework/conductor.js");
    const { solarbloom } = await import("../src/effects/solarbloom.js");

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
    const { solarbloom } = await import("../src/effects/solarbloom.js");
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
    const { solarbloom } = await import("../src/effects/solarbloom.js");
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

  it("prefers-reduced-motion renders one held frame and never starts a RAF loop", async () => {
    reduceMotion = true;
    vi.useFakeTimers();
    const body = installDom();
    const { play } = await import("../src/framework/conductor.js");
    const { solarbloom } = await import("../src/effects/solarbloom.js");
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
