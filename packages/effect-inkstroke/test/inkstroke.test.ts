import { describe, expect, it } from "vitest";
import { resolveInkParams, MAX_DROPS } from "../src/inkstroke-oracle.js";
import { strokeProgress, STROKE_DRAW_MS } from "../src/inkstroke-tempo.js";
import type { DopamineMood } from "@dopamine/core";
// Importing the effect registers it (self-registers on import).
import "../src/index.js";

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

describe("resolveInkParams (Calligraphic Verdict)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = resolveInkParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 42 });
    const b = resolveInkParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 42 });
    expect(a).toEqual(b);
  });

  it("produces sane, in-range params for every mood", () => {
    for (const mood of MOODS) {
      const p = resolveInkParams({ mood, intensity: 0.7, whimsy: 0.5, seed: 7 });
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
    const lo = resolveInkParams({ mood: "celebratory", intensity: 0.1, whimsy: 0.5, seed: 5 });
    const hi = resolveInkParams({ mood: "celebratory", intensity: 0.95, whimsy: 0.5, seed: 5 });
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.pressure).toBeGreaterThan(lo.pressure);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
  });

  it("whimsy is the stylization axis: dries the ink (less wetness) and tracks style", () => {
    const lo = resolveInkParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.0, seed: 5 });
    const hi = resolveInkParams({ mood: "celebratory", intensity: 0.7, whimsy: 1.0, seed: 5 });
    expect(lo.style).toBe(0);
    expect(hi.style).toBe(1);
    // Toward the cel/neon end the wet bleed recedes (drier, flatter mark).
    expect(hi.wetness).toBeLessThan(lo.wetness);
  });

  it("electric is faster than serene", () => {
    const electric = resolveInkParams({ mood: "electric", intensity: 0.7, whimsy: 0.5, seed: 1 });
    const serene = resolveInkParams({ mood: "serene", intensity: 0.7, whimsy: 0.5, seed: 1 });
    expect(electric.durationMs).toBeLessThan(serene.durationMs);
  });

  it("electric rakes harder and wetter-serene bleeds more (mood character)", () => {
    const electric = resolveInkParams({ mood: "electric", intensity: 0.7, whimsy: 0.5, seed: 3 });
    const serene = resolveInkParams({ mood: "serene", intensity: 0.7, whimsy: 0.5, seed: 3 });
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
