import { describe, expect, it } from "vitest";
import { parseDope, resolveDopeParams, NPR_TIME_STEP_MS } from "@dopaminefx/core";
import { MAX_DOTS } from "../src/dots-shader.js";
import doc from "../src/dots.dope.json";

// The breathe gate lives in dots.dope.json (`tempo.frame.amp` — a steady
// periodic sine of the loop PHASE, evaluated by the generic dope factory).
// Local mirror for the loop-seam property checks below.
const dotsBreathe = (phase: number): number => 0.85 + 0.15 * Math.sin(Math.PI * 2 * phase);

// Per the authoring guide we exercise the production loader path directly and
// pin a seed to assert the params + mood/intensity/whimsy mapping we expect —
// PLUS the property that makes Dots (like Halo) special: it LOOPS SEAMLESSLY via
// the first-class `tempo.loop` contract.
const DOPE = parseDope(doc as object);
const MIN_DOTS = 2;
const CONSTS = { MAX_DOTS, MIN_DOTS };
const PERIOD_MS = DOPE.tempo.loop!.periodMs;

const resolve = (mood: string, intensity: number, whimsy: number, seed: number) =>
  resolveDopeParams(DOPE, { mood, intensity, whimsy, seed }, CONSTS, "dotsSeed") as unknown as {
    palette: unknown[];
    durationMs: number;
    style: number;
    exposure: number;
    dotCount: number;
    dotRadius: number;
    dotGap: number;
    breathe: number;
    chase: number;
    glow: number;
    dotsSeed: number;
  };

const MOODS = ["serene", "celebratory", "electric"];

describe("dots resolve (calm looping thinking-row)", () => {
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
      expect(p.exposure).toBeGreaterThan(0);
      expect(p.dotRadius).toBeGreaterThan(0);
      expect(p.dotGap).toBeGreaterThan(0);
      expect(p.glow).toBeGreaterThan(0);
      expect(p.chase).toBeGreaterThan(0);
      expect(Number.isInteger(p.dotCount)).toBe(true);
      expect(p.dotCount).toBeGreaterThanOrEqual(MIN_DOTS);
      expect(p.dotCount).toBeLessThanOrEqual(MAX_DOTS);
    }
  });

  it("intensity drives brightness and glow, but NOT speed/timing", () => {
    const lo = resolve("celebratory", 0.05, 0.5, 5);
    const hi = resolve("celebratory", 0.98, 0.5, 5);
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.glow).toBeGreaterThan(lo.glow);
    // chase is a motion rate (speed) -> baseline-only, identical at any intensity
    expect(hi.chase).toBe(lo.chase);
    expect(hi.chase).toBe(resolve("celebratory", 0.5, 0.5, 5).chase);
  });

  it("intensity grows SIZE: dotRadius scales ~0.4x baseline (low) -> baseline (1.0)", () => {
    const baseline = 0.03; // celebratory dotRadius
    const lo = resolve("celebratory", 0.0, 0.5, 5);
    const hi = resolve("celebratory", 1.0, 0.5, 5);
    expect(lo.dotRadius).toBeCloseTo(baseline * 0.4, 9);
    expect(hi.dotRadius).toBeCloseTo(baseline, 9);
    expect(hi.dotRadius).toBeGreaterThan(lo.dotRadius);
  });

  it("intensity grows COUNT: floors at MIN(2) low -> baseline at 1.0", () => {
    const baselineCount = 4; // celebratory dotCount
    const lo = resolve("celebratory", 0.0, 0.5, 5);
    const hi = resolve("celebratory", 1.0, 0.5, 5);
    expect(lo.dotCount).toBe(MIN_DOTS);
    expect(hi.dotCount).toBe(baselineCount);
    expect(hi.dotCount).toBeGreaterThan(lo.dotCount);
  });

  it("whimsy is the stylization axis (style == raw whimsy)", () => {
    expect(resolve("celebratory", 0.7, 0.0, 5).style).toBe(0);
    expect(resolve("celebratory", 0.7, 1.0, 5).style).toBe(1);
  });

  it("electric shows more, tighter dots than serene", () => {
    const electric = resolve("electric", 0.7, 0.5, 1);
    const serene = resolve("serene", 0.7, 0.5, 1);
    expect(electric.dotCount).toBeGreaterThan(serene.dotCount);
    expect(electric.dotRadius).toBeLessThan(serene.dotRadius);
    expect(electric.glow).toBeGreaterThan(serene.glow);
  });

  it("degrades an undeclared mood to its own default", () => {
    const p = resolve("nonexistent-mood", 0.7, 0.5, 3);
    const def = resolve("celebratory", 0.7, 0.5, 3); // controls.mood.default
    expect(p).toEqual(def);
  });
});

describe("dots loops seamlessly (the tempo.loop contract)", () => {
  it("declares the first-class loop contract: 1s period, whole periods per fire", () => {
    expect(PERIOD_MS).toBe(1000);
    for (const mood of MOODS) {
      const p = resolve(mood, 0.6, 0.5, 11);
      const loops = p.durationMs / PERIOD_MS;
      expect(loops).toBe(Math.round(loops)); // whole number of loops (parser-gated too)
      expect(loops).toBeGreaterThanOrEqual(2); // a few periods per fire
    }
  });

  it("the loop period is an integer number of animate-on-twos steps", () => {
    // 1 s / (1000/12 ms) == 12 steps exactly, so the on-twos-snapped clock is
    // ALSO periodic with the loop period -> seam survives at full whimsy. The
    // parser enforces this (snapAligned defaults true); pin it here too.
    expect(PERIOD_MS / NPR_TIME_STEP_MS).toBe(12);
  });

  it("the parser rejects a loop period off the on-twos grid or a ragged duration", () => {
    const raw = JSON.parse(JSON.stringify(doc));
    raw.tempo.loop.periodMs = 100; // not a multiple of 1000/12
    expect(() => parseDope(raw)).toThrow(/animate-on-twos/);

    const ragged = JSON.parse(JSON.stringify(doc));
    ragged.tempo.loop.periodMs = 1500; // 18 on-twos steps, but 4000/1500 isn't whole
    expect(() => parseDope(ragged)).toThrow(/whole number of tempo.loop periods/);
  });

  it("the breathe gate returns to its t=0 value at every loop boundary", () => {
    const p = resolve("celebratory", 0.7, 0.5, 1);
    const phaseAt = (ms: number) => (ms % PERIOD_MS) / PERIOD_MS;
    for (let n = 1; n * PERIOD_MS <= p.durationMs + 1e-9; n++) {
      expect(dotsBreathe(phaseAt(n * PERIOD_MS))).toBeCloseTo(dotsBreathe(phaseAt(0)), 9);
    }
  });

  it("every periodic driver matches at t==durationMs vs t==0, at EVERY whimsy", () => {
    // Reproduce the runner's "on twos" snap, then the loop clocks.
    const snap = (elapsedMs: number, style: number) => {
      const stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS;
      return elapsedMs + (stepped - elapsedMs) * style;
    };
    const phaseOf = (animMs: number) => (animMs % PERIOD_MS) / PERIOD_MS;
    const p = resolve("electric", 0.8, 0.5, 3);
    const count = p.dotCount;
    const TAU = Math.PI * 2;
    // The periodic drivers the shader uses, as pure functions of uPhase:
    const drivers = (phase: number) => ({
      breathe: Math.sin(TAU * phase),
      chaseHead: (phase % 1) * count % count,
      amp: dotsBreathe(phase),
    });
    for (const style of [0, 0.25, 0.5, 0.75, 1]) {
      const a = drivers(phaseOf(snap(0, style)));
      const b = drivers(phaseOf(snap(p.durationMs, style)));
      expect(b.breathe).toBeCloseTo(a.breathe, 9);
      expect(b.chaseHead).toBeCloseTo(a.chaseHead, 9);
      expect(b.amp).toBeCloseTo(a.amp, 9);
    }
  });
});
