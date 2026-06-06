import { describe, expect, it } from "vitest";
import { resolveParams } from "../src/engine/mood.js";
import type { DopamineMood } from "../src/types.js";

const MOODS: DopamineMood[] = ["serene", "celebratory", "electric"];

describe("resolveParams", () => {
  it("is deterministic for a fixed seed", () => {
    const a = resolveParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 99 });
    const b = resolveParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 99 });
    expect(a).toEqual(b);
  });

  it("produces sane, in-range params for every mood", () => {
    for (const mood of MOODS) {
      const p = resolveParams({ mood, intensity: 0.7, whimsy: 0.5, seed: 7 });
      expect(p.palette).toHaveLength(3);
      expect(p.durationMs).toBeGreaterThan(0);
      expect(Number.isInteger(p.moteCount)).toBe(true);
      expect(p.moteCount).toBeGreaterThan(0);
      expect(p.moteCount).toBeLessThanOrEqual(80); // shader MAX_MOTES
      expect(p.exposure).toBeGreaterThan(0);
    }
  });

  it("higher intensity raises exposure (brighter == more arousing)", () => {
    const lo = resolveParams({ mood: "celebratory", intensity: 0.1, whimsy: 0.5, seed: 5 });
    const hi = resolveParams({ mood: "celebratory", intensity: 0.95, whimsy: 0.5, seed: 5 });
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.overshoot).toBeGreaterThan(lo.overshoot);
  });

  it("higher whimsy raises turbulence and mote count", () => {
    const lo = resolveParams({ mood: "celebratory", intensity: 0.7, whimsy: 0.0, seed: 5 });
    const hi = resolveParams({ mood: "celebratory", intensity: 0.7, whimsy: 1.0, seed: 5 });
    expect(hi.turbulence).toBeGreaterThan(lo.turbulence);
    expect(hi.moteCount).toBeGreaterThanOrEqual(lo.moteCount);
  });

  it("electric is faster than serene", () => {
    const electric = resolveParams({ mood: "electric", intensity: 0.7, whimsy: 0.5, seed: 1 });
    const serene = resolveParams({ mood: "serene", intensity: 0.7, whimsy: 0.5, seed: 1 });
    expect(electric.durationMs).toBeLessThan(serene.durationMs);
  });
});
