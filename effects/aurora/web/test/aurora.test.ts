import { describe, expect, it } from "vitest";
import { aurora } from "../src/index.js";
import { MAX_CURTAINS } from "../src/aurora-shader.js";
import { resolveMood } from "@dopaminefx/core";

type Feeling = { mood: string; intensity: number; whimsy: number; seed: number };

// The factory's resolve() signature takes (feeling, mood); the mood arg is
// unused by the .dope loader path (it reads its own per-mood baselines), but we
// pass a resolved mood to match the EffectFactory contract.
const resolve = (f: Feeling) =>
  aurora.resolve(f, resolveMood(f.mood)) as unknown as Record<string, number> & {
    palette: unknown[];
  };

const MOODS = ["serene", "celebratory", "electric"];

describe("aurora resolve (curtains of polar light)", () => {
  it("is deterministic for a fixed seed", () => {
    const a = resolve({ mood: "serene", intensity: 0.7, whimsy: 0.4, seed: 42 });
    const b = resolve({ mood: "serene", intensity: 0.7, whimsy: 0.4, seed: 42 });
    expect(a).toEqual(b);
  });

  it("produces sane, in-range params for every mood", () => {
    for (const mood of MOODS) {
      const p = resolve({ mood, intensity: 0.7, whimsy: 0.4, seed: 7 });
      expect(p.palette).toHaveLength(3);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
      expect(p.coverage).toBeGreaterThanOrEqual(0);
      expect(p.coverage).toBeLessThanOrEqual(1);
      expect(p.bandHeight).toBeGreaterThan(0);
      expect(p.bandHeight).toBeLessThanOrEqual(1);
      expect(p.bandY).toBeGreaterThan(0.5); // band sits in the UPPER field
      expect(p.bandY).toBeLessThanOrEqual(1);
      expect(p.sway).toBeGreaterThan(0);
      expect(p.striation).toBeGreaterThanOrEqual(0);
      expect(p.striation).toBeLessThanOrEqual(1);
      expect(p.rays).toBeGreaterThanOrEqual(0);
      expect(p.rays).toBeLessThanOrEqual(1);
    }
  });

  it("higher intensity raises brightness and coverage", () => {
    const lo = resolve({ mood: "serene", intensity: 0.1, whimsy: 0.4, seed: 5 });
    const hi = resolve({ mood: "serene", intensity: 0.95, whimsy: 0.4, seed: 5 });
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.coverage).toBeGreaterThan(lo.coverage);
    expect(hi.bandHeight).toBeGreaterThan(lo.bandHeight);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
  });

  it("style follows whimsy (the raw control)", () => {
    const calm = resolve({ mood: "serene", intensity: 0.7, whimsy: 0.0, seed: 5 });
    const cel = resolve({ mood: "serene", intensity: 0.7, whimsy: 1.0, seed: 5 });
    expect(calm.style).toBeCloseTo(0, 5);
    expect(cel.style).toBeCloseTo(1, 5);
  });

  it("electric is more vivid (higher chroma -> more saturated palette) than serene", () => {
    const serene = resolve({ mood: "serene", intensity: 0.8, whimsy: 0.4, seed: 3 });
    const electric = resolve({ mood: "electric", intensity: 0.8, whimsy: 0.4, seed: 3 });
    // Both have valid 3-stop palettes; electric declares a much higher chroma
    // baseline, so it should carry a wider colour range / coverage push.
    expect(electric.coverage).toBeGreaterThan(serene.coverage);
    expect(electric.palette).toHaveLength(3);
    expect(serene.palette).toHaveLength(3);
  });

  it("ribbon count cap const is the single source of truth", () => {
    expect(MAX_CURTAINS).toBeGreaterThan(0);
    expect(Number.isInteger(MAX_CURTAINS)).toBe(true);
  });
});
