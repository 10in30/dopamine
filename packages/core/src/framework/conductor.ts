/**
 * The conductor — the single runtime that owns everything an effect must NOT:
 * the overlay canvases (light + shadow), their shared WebGL contexts (+ program
 * caches), the RAF loop, device-pixel-ratio + resize handling, document
 * visibility pausing, and the reduced-motion fallback.
 *
 * Key design choices:
 *  - **One persistent host per target.** A target (usually `document.body`) gets
 *    a single overlay (light + shadow canvas) + two GL contexts that live until
 *    explicitly torn down. Firing N effects reuses that one overlay and those
 *    contexts — so the expensive shader LINK happens once per page, not per fire,
 *    and we never leak the per-fire WebGL contexts that browsers cap at ~16.
 *  - **Concurrent effects.** Many effects can play at once on the same host. The
 *    conductor clears each canvas once per frame and composites the active
 *    effects: the light canvas blends ADDITIVELY (`ONE, ONE`) so layers sum as
 *    light (matching the `screen` overlay); the shadow canvas blends with `MIN`
 *    so the darkest occlusion wins (a faithful single-effect identity, a sane
 *    stack for many). For a single effect both reduce to exactly the legacy
 *    output (additive over black == replace; min over white == replace).
 *  - **Frame budgeting.** A single RAF drives every active effect; when nothing
 *    is active the loop stops (no idle RAF churn). Hidden tabs skip the GPU work
 *    but keep timing so effects still resolve.
 *  - **Reduced motion.** When the user prefers reduced motion, an effect renders
 *    a single calm frame held briefly instead of the full animation.
 *  - **SSR-safe.** Every browser global is reached through `runtime.ts`; off-DOM,
 *    `play()` resolves immediately and `prepare()` returns null.
 */

import { createGLContext, type GLContext } from "../engine/context.js";
import { createOverlay, type Overlay } from "../overlay.js";
import type { Anchor, EffectContext, EffectFactory, FeelingInput } from "./effect.js";
import { resolveMood } from "./mood-registry.js";
import {
  deviceDpr,
  isBrowser,
  isDocumentHidden,
  prefersReducedMotion,
} from "./runtime.js";

interface ActiveEffect {
  renderAt(elapsedMs: number): void;
  dispose(): void;
  startedAt: number;
  durationMs: number;
  resolve: () => void;
}

/** A persistent overlay + GL contexts + RAF loop bound to one target element. */
interface Host {
  overlay: Overlay;
  light: GLContext;
  shadow: GLContext | null;
  dpr: number;
  active: Set<ActiveEffect>;
  raf: number;
  resize: () => void;
}

const hosts = new Map<HTMLElement, Host>();

function syncCanvasSize(c: HTMLCanvasElement, dpr: number): void {
  const w = Math.max(1, Math.round(c.clientWidth * dpr));
  const h = Math.max(1, Math.round(c.clientHeight * dpr));
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
}

function syncHostSize(host: Host): void {
  syncCanvasSize(host.light.canvas, host.dpr);
  if (host.shadow) syncCanvasSize(host.shadow.canvas, host.dpr);
}

function getHost(target: HTMLElement, wantShadow: boolean): Host {
  let host = hosts.get(target);
  if (host) {
    // A later effect may need a shadow canvas the host wasn't created with.
    if (wantShadow && !host.shadow) {
      const shadowCanvas = host.overlay.ensureShadow();
      host.shadow = createGLContext(shadowCanvas);
    }
    return host;
  }

  const overlay = createOverlay(target, { shadow: wantShadow });
  const light = createGLContext(overlay.canvas);
  const shadow = overlay.shadow ? createGLContext(overlay.shadow) : null;
  const h: Host = {
    overlay,
    light,
    shadow,
    dpr: deviceDpr(),
    active: new Set(),
    raf: 0,
    resize: () => {},
  };
  h.resize = () => {
    h.dpr = deviceDpr();
    syncHostSize(h);
  };
  syncHostSize(h);
  window.addEventListener("resize", h.resize);
  hosts.set(target, h);
  return h;
}

/** Clear the light canvas to black (screen identity) + arm additive blending. */
function beginLight(host: Host): void {
  const { gl, canvas } = host.light;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.FUNC_ADD);
  gl.blendFunc(gl.ONE, gl.ONE);
}

/** Clear the shadow canvas to white (multiply identity) + arm MIN blending. */
function beginShadow(host: Host): void {
  if (!host.shadow) return;
  const { gl, canvas } = host.shadow;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(1, 1, 1, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.enable(gl.BLEND);
  gl.blendEquation(gl.MIN);
  gl.blendFunc(gl.ONE, gl.ONE);
}

/** Clear both canvases (no draw) — used to wipe the last held frame on idle. */
function clearHost(host: Host): void {
  beginLight(host);
  beginShadow(host);
}

/**
 * Stop the RAF loop and clear the last frame when a host goes idle, but KEEP the
 * overlay + contexts (and thus the compiled-program caches) alive for the page's
 * lifetime. Re-firing reuses everything — the expensive shader link happens once
 * per page, not once per fire.
 */
function quiesce(host: Host): void {
  if (host.raf) {
    cancelAnimationFrame(host.raf);
    host.raf = 0;
  }
  if (!isDocumentHidden()) {
    syncHostSize(host);
    clearHost(host);
  }
}

function ensureLoop(host: Host): void {
  if (host.raf) return;
  const frame = (now: number): void => {
    host.raf = 0;
    if (host.active.size === 0) return;
    const hidden = isDocumentHidden();
    if (!hidden) {
      syncHostSize(host);
      beginLight(host);
      beginShadow(host);
    }
    for (const fx of [...host.active]) {
      const elapsed = now - fx.startedAt;
      // Skip the (invisible) draw on hidden tabs, but keep the timeline moving.
      if (!hidden) fx.renderAt(Math.min(elapsed, fx.durationMs));
      if (elapsed >= fx.durationMs) {
        host.active.delete(fx);
        fx.dispose();
        fx.resolve();
      }
    }
    if (host.active.size > 0) {
      host.raf = requestAnimationFrame(frame);
    } else {
      quiesce(host);
    }
  };
  host.raf = requestAnimationFrame(frame);
}

/**
 * Fully release the persistent host(s): cancel RAF, drop the GL contexts, remove
 * the overlay. Called rarely (test teardown, an SPA route that wants a hard
 * reset, offline capture between effects). With no arg, tears down every host.
 */
export function teardown(target?: HTMLElement): void {
  const release = (t: HTMLElement, host: Host): void => {
    if (host.raf) cancelAnimationFrame(host.raf);
    for (const fx of host.active) {
      fx.dispose();
      fx.resolve();
    }
    host.active.clear();
    if (typeof window !== "undefined") {
      window.removeEventListener("resize", host.resize);
    }
    host.light.destroy();
    host.shadow?.destroy();
    host.overlay.destroy();
    hosts.delete(t);
  };
  if (target) {
    const host = hosts.get(target);
    if (host) release(target, host);
    return;
  }
  for (const [t, host] of [...hosts]) release(t, host);
}

function buildEffectContext(
  host: Host,
  anchor: Anchor,
  targetSize?: { width: number; height: number },
): EffectContext {
  return {
    light: host.light,
    shadow: host.shadow,
    anchor,
    targetSize,
    get dpr() {
      return host.dpr;
    },
  };
}

export interface PlayRequest {
  factory: EffectFactory;
  target: HTMLElement;
  /** Anchor in CSS px relative to the *target's* box (overlay-local). */
  anchor: Anchor;
  /** Targeted element size (CSS px); the centrepiece is sized to this box. */
  targetSize?: { width: number; height: number };
  feeling: FeelingInput;
}

/**
 * Play an effect in real time. Resolves when it has fully played out. The host
 * (overlay + contexts + loop) is created lazily and kept warm for reuse when
 * idle; the RAF loop stops between fires. Call {@link teardown} to release it.
 */
export function play(req: PlayRequest): Promise<void> {
  if (!isBrowser()) return Promise.resolve();

  const wantShadow = req.factory.castsShadow !== false;
  const host = getHost(req.target, wantShadow);
  const mood = resolveMood(req.feeling.mood);
  const params = req.factory.resolve(req.feeling, mood);

  let instance;
  try {
    instance = req.factory.create(params, buildEffectContext(host, req.anchor, req.targetSize));
  } catch (err) {
    if (host.active.size === 0) quiesce(host);
    return Promise.reject(err);
  }

  // Reduced motion: draw one calm frame, hold briefly, done — no animation.
  if (prefersReducedMotion()) {
    return playReduced(host, instance, req.factory);
  }

  let resolve!: () => void;
  const done = new Promise<void>((res) => (resolve = res));
  host.active.add({
    renderAt: (ms) => instance.renderAt(ms),
    dispose: () => instance.dispose(),
    startedAt: performance.now(),
    durationMs: instance.durationMs,
    resolve,
  });
  ensureLoop(host);
  return done;
}

function playReduced(
  host: Host,
  instance: { renderAt(ms: number): void; dispose(): void; durationMs: number },
  factory: EffectFactory,
): Promise<void> {
  const rm = factory.reducedMotion ?? {};
  const peakMs = rm.peakMs ?? Math.min(260, instance.durationMs * 0.18);
  const holdMs = rm.holdMs ?? 360;
  if (!isDocumentHidden()) {
    syncHostSize(host);
    beginLight(host);
    beginShadow(host);
    instance.renderAt(peakMs);
  }
  return new Promise<void>((resolve) => {
    setTimeout(() => {
      instance.dispose();
      // Clear the held frame; keep the (reusable) host alive but quiesced.
      if (host.active.size === 0) quiesce(host);
      resolve();
    }, holdMs);
  });
}

/**
 * Build a frame-perfect, manually-driven instance (no RAF, no auto-teardown) for
 * offline capture or external timelines. The caller owns `renderAt` + `dispose`.
 * Returns `null` off-DOM. The host stays alive until `dispose()`.
 */
export interface PreparedHandle {
  readonly durationMs: number;
  renderAt(elapsedMs: number): void;
  dispose(): void;
}

export function prepare(req: PlayRequest): PreparedHandle | null {
  if (!isBrowser()) return null;
  const wantShadow = req.factory.castsShadow !== false;
  const host = getHost(req.target, wantShadow);
  const mood = resolveMood(req.feeling.mood);
  const params = req.factory.resolve(req.feeling, mood);

  let instance;
  try {
    instance = req.factory.create(params, buildEffectContext(host, req.anchor, req.targetSize));
  } catch (err) {
    if (host.active.size === 0) quiesce(host);
    throw err;
  }

  let disposed = false;
  return {
    durationMs: instance.durationMs,
    renderAt(elapsedMs: number): void {
      if (disposed) return;
      syncHostSize(host);
      beginLight(host);
      beginShadow(host);
      instance.renderAt(elapsedMs);
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      instance.dispose();
      // Manually-driven handles fully release their host (offline capture wants
      // a clean slate between effects), unless live effects are still animating.
      if (host.active.size === 0) teardown(req.target);
    },
  };
}

/** Test/SSR helper: how many live hosts (overlay+contexts) currently exist. */
export function activeHostCount(): number {
  return hosts.size;
}
