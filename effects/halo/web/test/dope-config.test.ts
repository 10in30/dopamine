/**
 * Halo's derived pass config — the `.dope` contract (the CONTINUOUS looping
 * effect).
 *
 * The per-frame logic, uniforms and bindings are data (halo.dope.json), derived
 * by the generic `dopePassConfig`. Pin the derived uniform set + binding
 * exceptions, and halo's defining property: the datafied amp is PERIODIC, so
 * the loop seam is invisible. (The per-frame evaluator itself is covered by
 * core's frame-expr suite; cross-platform numeric parity by the Swift/Android
 * grids.)
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, parseDope, resolveDopeParams } from "@dopaminefx/core";
import { HALO_FRAGMENT_SRC, HALO_VERTEX_SRC } from "../src/halo-shader.js";
import doc from "../src/halo.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: HALO_VERTEX_SRC, fragment: HALO_FRAGMENT_SRC });

describe("halo derived pass config", () => {
  it("the datafied amp keeps the loop-seam contract (t==durationMs matches t==0)", () => {
    const p = resolveDopeParams(
      DOPE, { mood: "electric", intensity: 0.8, whimsy: 0.5, seed: 3 }, {}, "haloSeed",
    ) as Record<string, number> & { durationMs: number };
    const at = (animMs: number) =>
      CONFIG.frame({ animMs, life: Math.min(animMs / p.durationMs, 1), elapsedMs: animMs }, p as never).amp;
    expect(at(p.durationMs)).toBeCloseTo(at(0), 9);
  });

  it("derives the expected uniforms (as a set) and bindings", () => {
    // No uPeriod: the loop clocks (uLoopS/uPhase) are STANDARD uniforms the
    // runner derives from tempo.loop — no per-effect period plumbing.
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set(["uExposure", "uRingRadius", "uRingWidth", "uBreathe", "uSweepArc", "uSweepTurns", "uGlow"]),
    );
    // haloSeed feeds the seeded palette only — no scatterWeb, not a uniform.
    expect(CONFIG.bindings).toEqual({ haloSeed: null });
    expect(CONFIG.usesOrigin).toBe(true);
  });

  it("derives the continuous-loop contract from tempo.loop", () => {
    expect(CONFIG.loopPeriodMs).toBe(1500);
    // The frame derivation feeds the SAME loop clocks to the amp expression the
    // runner feeds the shader: a quarter period in, the breathe gate peaks.
    const p = resolveDopeParams(
      DOPE, { mood: "celebratory", intensity: 0.7, whimsy: 0, seed: 1 }, {}, "haloSeed",
    ) as Record<string, number> & { durationMs: number };
    const at = (animMs: number) =>
      CONFIG.frame({ animMs, life: Math.min(animMs / p.durationMs, 1), elapsedMs: animMs }, p as never).amp;
    expect(at(375)).toBeCloseTo(1.0, 9); // phase 0.25 → 0.85 + 0.15·sin(π/2)
    expect(at(0)).toBeCloseTo(0.85, 9); // phase 0 → calm baseline
  });
});
