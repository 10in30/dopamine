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
      // rays is a 0..1 searchlight-pillar strength (a look fraction), clamp01.
      expect(p.rays).toBeGreaterThanOrEqual(0);
      expect(p.rays).toBeLessThanOrEqual(1);
    }
  });

  it("higher intensity raises brightness, coverage and band height", () => {
    const lo = resolve({ mood: "serene", intensity: 0.1, whimsy: 0.4, seed: 5 });
    const hi = resolve({ mood: "serene", intensity: 0.95, whimsy: 0.4, seed: 5 });
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.coverage).toBeGreaterThan(lo.coverage);
    expect(hi.bandHeight).toBeGreaterThan(lo.bandHeight);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
  });

  it("SIZE params scale ~0.4x baseline (low intensity) -> baseline (intensity 1)", () => {
    const baseCoverage = 0.55; // serene baseline.coverage
    const baseBandHeight = 0.28; // serene baseline.bandHeight
    const full = resolve({ mood: "serene", intensity: 1.0, whimsy: 0.4, seed: 5 });
    const low = resolve({ mood: "serene", intensity: 0.0, whimsy: 0.4, seed: 5 });
    // At intensity 1.0 the SIZE multiplier is 1.0 -> exactly the baseline.
    expect(full.coverage).toBeCloseTo(baseCoverage, 5);
    expect(full.bandHeight).toBeCloseTo(baseBandHeight, 5);
    // At intensity 0 the multiplier is 0.4 -> ~0.4x the baseline.
    expect(low.coverage).toBeCloseTo(baseCoverage * 0.4, 5);
    expect(low.bandHeight).toBeCloseTo(baseBandHeight * 0.4, 5);
  });

  it("rays is a 0..1 searchlight strength (a look fraction), clamped to [0,1]", () => {
    // aurora's `rays` is NOT an element count -- the curtain count is fixed at
    // MAX_CURTAINS and modulated by `coverage`. `rays` is the searchlight-pillar
    // strength (serene 0.35, celebratory 0.5, electric 0.7 baselines), kept as a
    // brightness-like look param that rises gently with intensity, clamp01.
    const lo = resolve({ mood: "electric", intensity: 0.1, whimsy: 0.4, seed: 5 });
    const hi = resolve({ mood: "electric", intensity: 0.95, whimsy: 0.4, seed: 5 });
    expect(hi.rays).toBeGreaterThan(lo.rays);
    expect(lo.rays).toBeGreaterThanOrEqual(0);
    expect(hi.rays).toBeLessThanOrEqual(1);
  });

  it("intensity does NOT affect timing/speed (sway and durationMs are baseline-only)", () => {
    const lo = resolve({ mood: "serene", intensity: 0.1, whimsy: 0.4, seed: 5 });
    const hi = resolve({ mood: "serene", intensity: 0.95, whimsy: 0.4, seed: 5 });
    // sway is a motion RATE -> baseline-only, identical across intensities.
    expect(hi.sway).toBe(lo.sway);
    expect(hi.sway).toBeCloseTo(0.06, 5); // serene baseline.sway
    // durationMs is timing -> baseline-only, identical across intensities.
    expect(hi.durationMs).toBe(lo.durationMs);
    expect(hi.durationMs).toBe(3200); // serene baseline.durationMs
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
