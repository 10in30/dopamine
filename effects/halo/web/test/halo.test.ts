import { describe, expect, it } from "vitest";
import { parseDope, resolveDopeParams, NPR_TIME_STEP_MS } from "@dopamine/core";
import doc from "../src/halo.dope.json";

// The breathe gate now lives in halo.dope.json (`tempo.frame.amp` — a steady
// periodic sine, evaluated by the generic dope factory; the frame-parity suite
// pins it). Local mirror for the loop-seam property checks below.
const haloBreathe = (timeS: number, periodS: number): number =>
  0.85 + 0.15 * Math.sin((Math.PI * 2 * timeS) / Math.max(periodS, 1e-3));

// Halo is a brand-new effect with NO legacy oracle (per the authoring guide,
// §7.5): we exercise the production loader path directly and pin a seed to assert
// the params + mood/intensity/whimsy mapping we expect — PLUS the property that
// makes Halo special: it LOOPS SEAMLESSLY.
const DOPE = parseDope(doc as object);
const CONSTS = {};

const resolve = (mood: string, intensity: number, whimsy: number, seed: number) =>
  resolveDopeParams(DOPE, { mood, intensity, whimsy, seed }, CONSTS, "haloSeed") as unknown as {
    palette: unknown[];
    durationMs: number;
    style: number;
    exposure: number;
    ringRadius: number;
    ringWidth: number;
    breathe: number;
    sweepArc: number;
    sweepTurns: number;
    glow: number;
    period: number;
    haloSeed: number;
  };

const MOODS = ["serene", "celebratory", "electric"];
const TAU = Math.PI * 2;

describe("halo resolve (calm looping loader)", () => {
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
      expect(p.ringRadius).toBeGreaterThan(0);
      expect(p.ringWidth).toBeGreaterThan(0);
      expect(p.sweepArc).toBeGreaterThan(0);
      expect(p.glow).toBeGreaterThan(0);
      expect(Number.isInteger(p.sweepTurns)).toBe(true);
      expect(p.sweepTurns).toBeGreaterThanOrEqual(1);
    }
  });

  it("intensity drives brightness, glow and sweep presence", () => {
    const lo = resolve("celebratory", 0.05, 0.5, 5);
    const hi = resolve("celebratory", 0.98, 0.5, 5);
    expect(hi.exposure).toBeGreaterThan(lo.exposure);
    expect(hi.glow).toBeGreaterThan(lo.glow);
    expect(hi.sweepArc).toBeGreaterThan(lo.sweepArc);
    // higher intensity tightens the ring wall (brighter, tighter loop)
    expect(hi.ringWidth).toBeLessThan(lo.ringWidth);
  });

  it("whimsy is the stylization axis (style == raw whimsy)", () => {
    expect(resolve("celebratory", 0.7, 0.0, 5).style).toBe(0);
    expect(resolve("celebratory", 0.7, 1.0, 5).style).toBe(1);
  });

  it("electric sweeps livelier (more turns) and tighter than serene", () => {
    const electric = resolve("electric", 0.7, 0.5, 1);
    const serene = resolve("serene", 0.7, 0.5, 1);
    expect(electric.sweepTurns).toBeGreaterThan(serene.sweepTurns);
    expect(electric.ringWidth).toBeLessThan(serene.ringWidth); // tighter bright ring
    expect(electric.glow).toBeGreaterThan(serene.glow);
  });

  it("degrades an undeclared mood to its own default", () => {
    const p = resolve("nonexistent-mood", 0.7, 0.5, 3);
    const def = resolve("celebratory", 0.7, 0.5, 3); // controls.mood.default
    expect(p).toEqual(def);
  });
});

describe("halo loops seamlessly (the continuous-effect contract)", () => {
  it("period is a fixed 1.5s and duration is an integer number of periods", () => {
    for (const mood of MOODS) {
      const p = resolve(mood, 0.6, 0.5, 11);
      expect(p.period).toBe(1.5);
      const loops = p.durationMs / 1000 / p.period;
      expect(loops).toBe(Math.round(loops)); // whole number of loops
      expect(loops).toBeGreaterThanOrEqual(2); // a few periods per fire
    }
  });

  it("the loop period is an integer number of animate-on-twos steps", () => {
    // 1.5 s / (1000/12 ms) == 18 steps exactly, so the on-twos-snapped clock is
    // ALSO periodic with the loop period -> seam survives at full whimsy.
    const periodMs = 1.5 * 1000;
    expect(periodMs / NPR_TIME_STEP_MS).toBe(18);
  });

  it("the breathe gate returns to its t=0 value at the loop boundary", () => {
    const p = resolve("celebratory", 0.7, 0.5, 1);
    const periodS = p.period;
    const durS = p.durationMs / 1000;
    expect(haloBreathe(durS, periodS)).toBeCloseTo(haloBreathe(0, periodS), 9);
    // and at each intermediate period boundary
    for (let n = 1; n * periodS <= durS + 1e-9; n++) {
      expect(haloBreathe(n * periodS, periodS)).toBeCloseTo(haloBreathe(0, periodS), 9);
    }
  });

  it("every periodic driver matches at t==durationMs vs t==0, at EVERY whimsy", () => {
    // Reproduce the runner's "on twos" snap: animMs = elapsed + (stepped-elapsed)*style.
    const snap = (elapsedMs: number, style: number) => {
      const stepped = Math.floor(elapsedMs / NPR_TIME_STEP_MS) * NPR_TIME_STEP_MS;
      return elapsedMs + (stepped - elapsedMs) * style;
    };
    const p = resolve("electric", 0.8, 0.5, 3);
    const periodS = p.period;
    const turns = p.sweepTurns;
    // The three periodic drivers the shader uses, as pure functions of timeS:
    const drivers = (timeS: number) => ({
      breathe: Math.sin((TAU * timeS) / periodS),
      rotation: ((TAU * timeS) / periodS) % TAU,
      sweepHead: ((timeS / periodS) * turns) % 1,
      amp: haloBreathe(timeS, periodS),
    });
    for (const style of [0, 0.25, 0.5, 0.75, 1]) {
      const a = drivers(snap(0, style) / 1000);
      const b = drivers(snap(p.durationMs, style) / 1000);
      expect(b.breathe).toBeCloseTo(a.breathe, 9);
      expect(b.rotation).toBeCloseTo(a.rotation, 9);
      expect(b.sweepHead).toBeCloseTo(a.sweepHead, 9);
      expect(b.amp).toBeCloseTo(a.amp, 9);
    }
  });
});
