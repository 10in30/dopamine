import { describe, expect, it } from "vitest";
import { parseDope, resolveDopeParams } from "../src/framework/loader.js";
import { MAX_RINGS } from "../src/engine/ripple-shader.js";
import doc from "../src/effects/ripple.dope.json";

// Ripple is a brand-new effect with NO legacy oracle (per the authoring guide,
// §7.5): we exercise the production loader path directly and pin a seed to assert
// the params + mood/intensity/whimsy mapping we expect.
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

  it("intensity drives wave amplitude, ring count and caustic brightness", () => {
    const lo = resolve("celebratory", 0.05, 0.5, 5);
    const hi = resolve("celebratory", 0.98, 0.5, 5);
    expect(hi.amplitude).toBeGreaterThan(lo.amplitude);
    expect(hi.rings).toBeGreaterThan(lo.rings);
    expect(hi.caustic).toBeGreaterThan(lo.caustic);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
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
    // electric baseline 5 + intensity*2 = 7 == MAX_RINGS at full intensity.
    expect(resolve("electric", 1.0, 0.5, 9).rings).toBeLessThanOrEqual(MAX_RINGS);
    // serene baseline 3 + 0 at zero intensity stays >= MIN_RINGS.
    expect(resolve("serene", 0.0, 0.5, 9).rings).toBeGreaterThanOrEqual(MIN_RINGS);
  });

  it("degrades an undeclared mood to its own default", () => {
    const p = resolve("nonexistent-mood", 0.7, 0.5, 3);
    const def = resolve("celebratory", 0.7, 0.5, 3); // controls.mood.default
    expect(p).toEqual(def);
  });
});
