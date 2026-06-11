import { describe, expect, it } from "vitest";
import { easeOutCubic, resolveMood, type DopamineMood } from "@dopamine/core";
// The droplet cap is owned by the shader that `#define`s it (single source of truth).
import { MAX_DROPS } from "../src/inkstroke-shader.js";
// Importing the effect registers it (self-registers on import).
import { inkstroke } from "../src/index.js";

// The stroke-draw timing lives in inkstroke.dope.json (`tempo.frame.extras.
// draw` — easeOutCubic of animMs/360, evaluated by the generic dope factory; the
// dope-config suite pins the derived pass config). These are local mirrors for
// the property checks.
const STROKE_DRAW_MS = 360;
const strokeProgress = (elapsedMs: number): number => easeOutCubic(elapsedMs / STROKE_DRAW_MS);

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

/** The production path: the factory's `.dope`-driven resolve. */
const resolve = (mood: DopamineMood, intensity: number, whimsy: number, seed: number) =>
  inkstroke.resolve({ mood, intensity, whimsy, seed }, resolveMood(mood));

describe("inkstroke resolve (Calligraphic Verdict)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = resolve("celebratory", 0.7, 0.5, 42);
    const b = resolve("celebratory", 0.7, 0.5, 42);
    expect(a).toEqual(b);
  });

  it("produces sane, in-range params for every mood", () => {
    for (const mood of MOODS) {
      const p = resolve(mood, 0.7, 0.5, 7);
      expect(p.palette).toHaveLength(3);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(Number.isInteger(p.droplets)).toBe(true);
      expect(p.droplets).toBeGreaterThan(0);
      expect(p.droplets).toBeLessThanOrEqual(MAX_DROPS); // shader MAX_DROPS
      expect(p.exposure).toBeGreaterThan(0);
      expect(p.scale).toBeGreaterThan(0);
      expect(p.pressure).toBeGreaterThan(0);
      expect(p.wetness).toBeGreaterThanOrEqual(0);
      expect(p.wetness).toBeLessThanOrEqual(1);
      expect(p.bristle).toBeGreaterThanOrEqual(0);
      expect(p.bristle).toBeLessThanOrEqual(1);
    }
  });

  it("higher intensity raises exposure and gesture boldness", () => {
    const lo = resolve("celebratory", 0.1, 0.5, 5);
    const hi = resolve("celebratory", 0.95, 0.5, 5);
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.pressure).toBeGreaterThan(lo.pressure);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
  });

  it("whimsy is the stylization axis: dries the ink (less wetness) and tracks style", () => {
    const lo = resolve("celebratory", 0.7, 0.0, 5);
    const hi = resolve("celebratory", 0.7, 1.0, 5);
    expect(lo.style).toBe(0);
    expect(hi.style).toBe(1);
    // Toward the cel/neon end the wet bleed recedes (drier, flatter mark).
    expect(hi.wetness).toBeLessThan(lo.wetness);
  });

  it("electric is faster than serene", () => {
    const electric = resolve("electric", 0.7, 0.5, 1);
    const serene = resolve("serene", 0.7, 0.5, 1);
    expect(electric.durationMs).toBeLessThan(serene.durationMs);
  });

  it("electric rakes harder and wetter-serene bleeds more (mood character)", () => {
    const electric = resolve("electric", 0.7, 0.5, 3);
    const serene = resolve("serene", 0.7, 0.5, 3);
    expect(electric.bristle).toBeGreaterThan(serene.bristle);
    expect(serene.wetness).toBeGreaterThan(electric.wetness);
  });
});

describe("strokeProgress", () => {
  it("is 0 at start and reaches 1 by the draw window (fast confirm)", () => {
    expect(strokeProgress(0)).toBeCloseTo(0);
    expect(strokeProgress(STROKE_DRAW_MS)).toBeCloseTo(1);
    expect(strokeProgress(STROKE_DRAW_MS * 2)).toBeCloseTo(1);
  });

  it("draws within the ~250-360ms confirmation band", () => {
    expect(STROKE_DRAW_MS).toBeLessThanOrEqual(360);
    // Well past halfway by ~150ms — the gesture lands quickly, no slow build.
    expect(strokeProgress(150)).toBeGreaterThan(0.5);
  });

  it("is monotonic", () => {
    let prev = -1;
    for (let t = 0; t <= STROKE_DRAW_MS * 1.2; t += 20) {
      const v = strokeProgress(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});
