import { describe, expect, it } from "vitest";
import { parseDope, resolveDopeParams } from "@dopaminefx/core";
import { MAX_RINGS } from "../src/ripple-shader.js";
import doc from "../src/ripple.dope.json";

// Per the authoring guide (§7.5) we exercise the production loader path directly
// and pin a seed to assert the params + mood/intensity/whimsy mapping we expect.
const DOPE = parseDope(doc as object);
const MIN_RINGS = 2;
const CONSTS = { MAX_RINGS, MIN_RINGS };

const resolve = (mood: string, intensity: number, whimsy: number, seed: number) =>
  resolveDopeParams(DOPE, { mood, intensity, whimsy, seed }, CONSTS, "rippleSeed") as unknown as {
    palette: unknown[];
    durationMs: number;
    style: number;
    exposure: number;
    amplitude: number;
    rings: number;
    wavelength: number;
    speed: number;
    caustic: number;
    overshoot: number;
    rippleSeed: number;
  };

const MOODS = ["serene", "celebratory", "electric"];

describe("ripple resolve (droplet-in-a-pool)", () => {
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
      expect(Number.isInteger(p.rings)).toBe(true);
      expect(p.rings).toBeGreaterThanOrEqual(MIN_RINGS);
      expect(p.rings).toBeLessThanOrEqual(MAX_RINGS);
      expect(p.exposure).toBeGreaterThan(0);
      expect(p.amplitude).toBeGreaterThan(0);
      expect(p.wavelength).toBeGreaterThan(0);
      expect(p.speed).toBeGreaterThan(0);
      expect(p.caustic).toBeGreaterThan(0);
    }
  });

  it("intensity drives wave amplitude (size), ring count and caustic brightness", () => {
    const lo = resolve("celebratory", 0.05, 0.5, 5);
    const hi = resolve("celebratory", 0.98, 0.5, 5);
    // SIZE: amplitude scales baseline by ~0.4x (low) up to baseline (intensity 1).
    expect(hi.amplitude).toBeGreaterThan(lo.amplitude);
    expect(hi.rings).toBeGreaterThan(lo.rings);
    expect(hi.caustic).toBeGreaterThan(lo.caustic);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
  });

  it("amplitude grows from ~0.4x baseline (low intensity) to baseline (intensity 1)", () => {
    const base = 0.5; // celebratory baseline amplitude
    const lo = resolve("celebratory", 0.0, 0.5, 5);
    const hi = resolve("celebratory", 1.0, 0.5, 5);
    expect(lo.amplitude).toBeCloseTo(base * 0.4, 6);
    expect(hi.amplitude).toBeCloseTo(base, 6);
  });

  it("rings grow from MIN_RINGS to baseline as intensity rises (intensity 1 == baseline)", () => {
    // celebratory baseline rings = 4: intensity 0 -> 2 (MIN), intensity 1 -> 4 (baseline).
    expect(resolve("celebratory", 0.0, 0.5, 5).rings).toBe(MIN_RINGS);
    expect(resolve("celebratory", 1.0, 0.5, 5).rings).toBe(4);
  });

  it("intensity does NOT affect speed or durationMs (baseline-only timing)", () => {
    const lo = resolve("celebratory", 0.05, 0.5, 5);
    const hi = resolve("celebratory", 0.98, 0.5, 5);
    expect(hi.speed).toBe(lo.speed);
    expect(hi.durationMs).toBe(lo.durationMs);
  });

  it("whimsy is the stylization axis (style == raw whimsy)", () => {
    expect(resolve("celebratory", 0.7, 0.0, 5).style).toBe(0);
    expect(resolve("celebratory", 0.7, 1.0, 5).style).toBe(1);
  });

  it("electric is faster, tighter and more caustic than serene (mood character)", () => {
    const electric = resolve("electric", 0.7, 0.5, 1);
    const serene = resolve("serene", 0.7, 0.5, 1);
    expect(electric.durationMs).toBeLessThan(serene.durationMs);
    expect(electric.wavelength).toBeLessThan(serene.wavelength); // tighter rings
    expect(electric.caustic).toBeGreaterThan(serene.caustic);
    expect(electric.speed).toBeGreaterThan(serene.speed);
  });

  it("ring count clamps to [MIN_RINGS, MAX_RINGS]", () => {
    // electric baseline 5: intensity 1 -> 2+(5-2)*1 = 5 (== baseline) <= MAX_RINGS.
    expect(resolve("electric", 1.0, 0.5, 9).rings).toBeLessThanOrEqual(MAX_RINGS);
    // serene baseline 3: intensity 0 floors at MIN_RINGS.
    expect(resolve("serene", 0.0, 0.5, 9).rings).toBeGreaterThanOrEqual(MIN_RINGS);
  });

  it("degrades an undeclared mood to its own default", () => {
    const p = resolve("nonexistent-mood", 0.7, 0.5, 3);
    const def = resolve("celebratory", 0.7, 0.5, 3); // controls.mood.default
    expect(p).toEqual(def);
  });
});
