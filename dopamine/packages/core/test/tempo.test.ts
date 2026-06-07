import { describe, expect, it } from "vitest";
import { easeOutBack, easeOutCubic, envelope } from "../src/engine/tempo.js";

describe("easeOutCubic", () => {
  it("spans 0..1 and is monotonic", () => {
    expect(easeOutCubic(0)).toBeCloseTo(0);
    expect(easeOutCubic(1)).toBeCloseTo(1);
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = easeOutCubic(t);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe("easeOutBack", () => {
  it("settles exactly to 1 at x=1 and overshoots before that", () => {
    expect(easeOutBack(1, 1)).toBeCloseTo(1);
    // somewhere in the run it should exceed 1 (the overshoot)
    let peak = 0;
    for (let t = 0; t <= 1; t += 0.02) peak = Math.max(peak, easeOutBack(t, 1));
    expect(peak).toBeGreaterThan(1);
  });
});

describe("envelope", () => {
  it("starts and ends at zero", () => {
    expect(envelope(0)).toBe(0);
    expect(envelope(1)).toBe(0);
  });

  it("peaks above 1 during the attack (held-breath overshoot)", () => {
    let peak = 0;
    let peakT = 0;
    for (let t = 0; t <= 1; t += 0.005) {
      const v = envelope(t, 1);
      if (v > peak) {
        peak = v;
        peakT = t;
      }
    }
    expect(peak).toBeGreaterThan(1);
    expect(peakT).toBeLessThan(0.25); // peak happens early
  });

  it("decays monotonically after the attack", () => {
    let prev = Infinity;
    for (let t = 0.2; t <= 1.0; t += 0.02) {
      const v = envelope(t, 1);
      expect(v).toBeLessThanOrEqual(prev + 1e-9);
      prev = v;
    }
  });

  it("larger overshoot yields a higher peak", () => {
    const peakAt = (o: number) => {
      let p = 0;
      for (let t = 0; t <= 1; t += 0.005) p = Math.max(p, envelope(t, o));
      return p;
    };
    expect(peakAt(1.4)).toBeGreaterThan(peakAt(0.6));
  });
});
