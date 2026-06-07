import { describe, expect, it } from "vitest";
import { lightning } from "../src/effects/lightning.js";
import { resolveMood } from "../src/framework/mood-registry.js";
import { strikeProgress, flashStrobe, STRIKE_MS } from "../src/engine/tempo.js";
import { MAX_FORKS } from "../src/engine/lightning-shader.js";
import type { FeelingInput } from "../src/framework/effect.js";

const MOODS = ["serene", "celebratory", "electric"] as const;

const resolve = (f: Partial<FeelingInput>) =>
  lightning.resolve(
    { mood: "electric", intensity: 0.85, whimsy: 0.5, seed: 7, ...f },
    resolveMood(f.mood ?? "electric"),
  ) as unknown as {
    palette: unknown[];
    durationMs: number;
    thickness: number;
    jagged: number;
    branches: number;
    flashBright: number;
    flicker: number;
    overshoot: number;
    exposure: number;
    style: number;
  };

describe("lightning.resolve", () => {
  it("is deterministic for a fixed seed", () => {
    const a = resolve({ seed: 42 });
    const b = resolve({ seed: 42 });
    expect(a).toEqual(b);
  });

  it("produces sane, in-range params for every declared mood", () => {
    for (const mood of MOODS) {
      const p = resolve({ mood, seed: 3 });
      expect(p.palette).toHaveLength(3);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(p.thickness).toBeGreaterThan(0);
      expect(p.exposure).toBeGreaterThan(0);
      expect(Number.isInteger(p.branches)).toBe(true);
      expect(p.branches).toBeGreaterThanOrEqual(0);
      expect(p.branches).toBeLessThanOrEqual(MAX_FORKS); // shader MAX_FORKS cap
      expect(p.flicker).toBeGreaterThanOrEqual(0);
      expect(p.flicker).toBeLessThanOrEqual(1);
    }
  });

  it("intensity drives thickness, branch count and flash brightness", () => {
    const lo = resolve({ mood: "electric", intensity: 0.1, seed: 5 });
    const hi = resolve({ mood: "electric", intensity: 0.95, seed: 5 });
    expect(hi.thickness).toBeGreaterThan(lo.thickness);
    expect(hi.branches).toBeGreaterThan(lo.branches);
    expect(hi.flashBright).toBeGreaterThan(lo.flashBright);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
  });

  it("mood is the register: electric forks + flashes hardest, serene is a calm single arc", () => {
    const serene = resolve({ mood: "serene", seed: 9 });
    const electric = resolve({ mood: "electric", seed: 9 });
    expect(electric.branches).toBeGreaterThan(serene.branches);
    expect(serene.branches).toBe(0); // serene = a soft single arc, no forks
    expect(electric.flashBright).toBeGreaterThan(serene.flashBright);
    expect(electric.jagged).toBeGreaterThan(serene.jagged);
    expect(electric.durationMs).toBeLessThan(serene.durationMs); // electric is curt/fast
  });

  it("whimsy maps to style 0..1 (photoreal plasma -> cel comic bolt)", () => {
    expect(resolve({ whimsy: 0 }).style).toBe(0);
    expect(resolve({ whimsy: 1 }).style).toBe(1);
  });
});

describe("strikeProgress", () => {
  it("cracks in fast: 0 at start, ~1 by the strike window", () => {
    expect(strikeProgress(0)).toBeCloseTo(0);
    expect(strikeProgress(STRIKE_MS)).toBeCloseTo(1);
    expect(strikeProgress(STRIKE_MS * 2)).toBeCloseTo(1);
    // Well past halfway almost immediately — a strike, not a slow draw.
    expect(strikeProgress(STRIKE_MS * 0.25)).toBeGreaterThan(0.5);
  });

  it("is monotonic", () => {
    let prev = -1;
    for (let t = 0; t <= STRIKE_MS * 1.5; t += 5) {
      const v = strikeProgress(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("flashStrobe", () => {
  it("peaks hard at the strike instant and decays to ~0 by end of life", () => {
    expect(flashStrobe(0, 1)).toBeGreaterThan(0.9); // hot white flash on contact
    expect(flashStrobe(1, 1)).toBeCloseTo(0, 1); // gone by the end
    expect(flashStrobe(0.02, 1)).toBeLessThan(flashStrobe(0, 1)); // primary decays
  });

  it("more flicker = a stronger afterglow strobe in the tail", () => {
    // Sample the tail at several phases; the higher-flicker curve should reach a
    // higher peak somewhere in the afterglow window.
    const peak = (flicker: number) => {
      let m = 0;
      for (let t = 0.3; t < 0.95; t += 0.001) m = Math.max(m, flashStrobe(t, flicker));
      return m;
    };
    expect(peak(1)).toBeGreaterThan(peak(0.2));
  });
});
