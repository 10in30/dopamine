import { describe, expect, it } from "vitest";
import { lightning } from "../src/index.js";
import { dopePassConfig, parseDope, resolveMood, type FeelingInput } from "@dopaminefx/core";
import { strikeProgress, STRIKE_MS } from "../src/lightning-logic.js";
import {
  LIGHTNING_FRAGMENT_SRC,
  LIGHTNING_VERTEX_SRC,
  MAX_FORKS,
} from "../src/lightning-shader.js";
import doc from "../src/lightning.dope.json";

// The flash/strobe shape now lives in the `.dope` (`tempo.frame.extras.flash`);
// evaluate it through the same derived config the runner uses.
const CONFIG = dopePassConfig(parseDope(doc as object), {
  vertex: LIGHTNING_VERTEX_SRC,
  fragment: LIGHTNING_FRAGMENT_SRC,
});
const flashStrobe = (life: number, flicker = 1): number =>
  CONFIG.frame({ animMs: 0, life, elapsedMs: 0 }, { overshoot: 1, flicker }).uFlash;

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

  it("intensity scales thickness/extent ~0.4x baseline (low) -> baseline (1.0), not timing", () => {
    const base = 0.02; // electric baseline thickness
    const lo = resolve({ mood: "electric", intensity: 0, seed: 5 });
    const hi = resolve({ mood: "electric", intensity: 1, seed: 5 });
    expect(lo.thickness).toBeCloseTo(base * 0.4, 6);
    expect(hi.thickness).toBeCloseTo(base, 6);
  });

  it("intensity floors branch count at MIN=1 and reaches the mood baseline at intensity 1", () => {
    // electric baseline = 6 forks; MIN floor = 1.
    const lo = resolve({ mood: "electric", intensity: 0, seed: 5 });
    const hi = resolve({ mood: "electric", intensity: 1, seed: 5 });
    expect(lo.branches).toBe(1); // floored at MIN, never 0 for a forking mood
    expect(hi.branches).toBe(6); // baseline at full intensity
    // serene has 0 forks at baseline; the floor formula yields 0 at intensity 1.
    expect(resolve({ mood: "serene", intensity: 1, seed: 5 }).branches).toBe(0);
  });

  it("intensity does NOT affect timing: durationMs is identical across intensities", () => {
    const dur = (intensity: number) =>
      resolve({ mood: "electric", intensity, seed: 5 }).durationMs;
    expect(dur(0)).toBe(dur(1));
    expect(dur(0.1)).toBe(dur(0.95));
    expect(dur(0.5)).toBe(850); // electric baseline durationMs, unscaled
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
