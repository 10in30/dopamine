import { describe, expect, it } from "vitest";
import {
  heartbeatScale,
  heartburstEnvelope,
  heartPresence,
  burstProgress,
  HEARTBEAT_PHASE,
} from "../src/heartburst-renderer.js";
import { heartburst } from "../src/index.js";

describe("heartbeatScale (lub-dub)", () => {
  it("rests at ~1 at the very start and end", () => {
    expect(heartbeatScale(0, 1, 1)).toBeCloseTo(1, 2);
    // tail sags slightly below rest as it dissolves
    expect(heartbeatScale(1, 1, 1)).toBeLessThan(1);
    expect(heartbeatScale(1, 1, 1)).toBeGreaterThan(0.9);
  });

  it("has TWO distinct beats with a full double-beat (lub louder than dub)", () => {
    const lub = heartbeatScale(0.1, 1, 1);
    const valley = heartbeatScale(0.16, 1, 1); // between the two beats
    const dub = heartbeatScale(0.21, 1, 1);
    expect(lub).toBeGreaterThan(1.1); // a clear swell
    expect(lub).toBeGreaterThan(dub); // lub is the loud one
    expect(dub).toBeGreaterThan(valley); // the dub is a second swell after a dip
    expect(valley).toBeLessThan(lub);
  });

  it("serene (doubleBeat=0) is a single gentle pulse — no second beat", () => {
    const single = heartbeatScale(0.1, 0.6, 0);
    const where2nd = heartbeatScale(0.21, 0.6, 0);
    expect(single).toBeGreaterThan(1.0);
    // with no double-beat the dub region has all but decayed
    expect(where2nd).toBeLessThan(single);
    expect(where2nd).toBeLessThan(1.05);
  });

  it("stronger beat strength swells more", () => {
    expect(heartbeatScale(0.1, 1.35, 1)).toBeGreaterThan(heartbeatScale(0.1, 0.6, 1));
  });
});

describe("burstProgress", () => {
  it("is 0 through the beat phase then eases to 1", () => {
    expect(burstProgress(0)).toBe(0);
    expect(burstProgress(HEARTBEAT_PHASE)).toBe(0);
    expect(burstProgress(HEARTBEAT_PHASE + 0.001)).toBeGreaterThan(0);
    expect(burstProgress(1)).toBeCloseTo(1, 5);
    // monotonic non-decreasing
    let prev = -1;
    for (let t = 0; t <= 1.0001; t += 0.05) {
      const v = burstProgress(t);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe("heartburstEnvelope", () => {
  it("starts and ends at zero, stays within [0,1]", () => {
    expect(heartburstEnvelope(0, 1, 1)).toBe(0);
    expect(heartburstEnvelope(1, 1, 1)).toBe(0);
    for (let t = 0; t <= 1; t += 0.02) {
      const v = heartburstEnvelope(t, 1, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("has energy during the beats AND during the burst", () => {
    expect(heartburstEnvelope(0.1, 1, 1)).toBeGreaterThan(0.2); // a beat
    // somewhere in the burst phase there is a flare
    let burstPeak = 0;
    for (let t = HEARTBEAT_PHASE; t <= 0.7; t += 0.01) {
      burstPeak = Math.max(burstPeak, heartburstEnvelope(t, 1, 1));
    }
    expect(burstPeak).toBeGreaterThan(0.2);
  });
});

describe("heartburst effect factory", () => {
  it("is named and resolves a pinned-seed param bag deterministically", () => {
    expect(heartburst.name).toBe("heartburst");
    const feeling = { mood: "celebratory", intensity: 0.8, whimsy: 0.4, seed: 123 };
    const a = heartburst.resolve(feeling, {} as never) as Record<string, unknown>;
    const b = heartburst.resolve(feeling, {} as never) as Record<string, unknown>;
    expect(a.durationMs).toBe(b.durationMs);
    expect(a.palette).toEqual(b.palette);
    // style is the raw whimsy control
    expect(a.style).toBeCloseTo(0.4);
    // declared draw params are present
    expect(typeof a.heartScale).toBe("number");
    expect(typeof a.burstCount).toBe("number");
    expect(typeof a.beatStrength).toBe("number");
    expect(a.palette).toHaveLength(3);
  });

  it("serene resolves doubleBeat 0 (single pulse), celebratory resolves a full double-beat", () => {
    const serene = heartburst.resolve(
      { mood: "serene", intensity: 0.7, whimsy: 0.4, seed: 1 },
      {} as never,
    ) as Record<string, unknown>;
    const celeb = heartburst.resolve(
      { mood: "celebratory", intensity: 0.7, whimsy: 0.4, seed: 1 },
      {} as never,
    ) as Record<string, unknown>;
    expect(serene.doubleBeat).toBe(0);
    expect(celeb.doubleBeat).toBe(1);
  });

  it("declares reduced motion from tempo.reducedMotion", () => {
    expect(heartburst.reducedMotion).toEqual({ peakMs: 180, holdMs: 360 });
  });
});

describe("heartburst intensity contract", () => {
  const at = (intensity: number) =>
    heartburst.resolve(
      { mood: "celebratory", intensity, whimsy: 0.4, seed: 1 },
      {} as never,
    ) as Record<string, unknown>;

  // celebratory baselines: heartScale 0.3, burstSpread 0.46, burstCount 18, durationMs 2000
  const BASE_HEART_SCALE = 0.3;
  const BASE_BURST_SPREAD = 0.46;
  const BASE_BURST_COUNT = 18;
  const MIN_BURST_COUNT = 4;

  it("intensity does NOT affect timing — durationMs is identical across intensities", () => {
    const lo = at(0).durationMs;
    const mid = at(0.5).durationMs;
    const hi = at(1).durationMs;
    expect(lo).toBe(2000);
    expect(mid).toBe(2000);
    expect(hi).toBe(2000);
  });

  it("heartScale scales from ~0.4x baseline (low) to baseline (intensity 1) and grows monotonically", () => {
    const lo = at(0).heartScale as number;
    const hi = at(1).heartScale as number;
    expect(lo).toBeCloseTo(BASE_HEART_SCALE * 0.4, 6);
    expect(hi).toBeCloseTo(BASE_HEART_SCALE, 6);
    expect(hi).toBeGreaterThan(lo);
    expect(at(0.5).heartScale as number).toBeGreaterThan(lo);
    expect(at(0.5).heartScale as number).toBeLessThan(hi);
  });

  it("burstSpread scales from ~0.4x baseline (low) to baseline (intensity 1) and grows monotonically", () => {
    const lo = at(0).burstSpread as number;
    const hi = at(1).burstSpread as number;
    expect(lo).toBeCloseTo(BASE_BURST_SPREAD * 0.4, 6);
    expect(hi).toBeCloseTo(BASE_BURST_SPREAD, 6);
    expect(hi).toBeGreaterThan(lo);
    expect(at(0.5).burstSpread as number).toBeGreaterThan(lo);
    expect(at(0.5).burstSpread as number).toBeLessThan(hi);
  });

  it("burstCount floors at MIN(4) at intensity 0 and reaches baseline at intensity 1", () => {
    expect(at(0).burstCount).toBe(MIN_BURST_COUNT);
    expect(at(1).burstCount).toBe(BASE_BURST_COUNT);
    // grows with intensity: floor → baseline
    expect(at(0.5).burstCount as number).toBeGreaterThan(MIN_BURST_COUNT);
    expect(at(0.5).burstCount as number).toBeLessThan(BASE_BURST_COUNT);
  });
});
