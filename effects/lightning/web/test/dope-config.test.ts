/**
 * Lightning's derived pass config — the `.dope` contract.
 *
 * The per-frame logic, uniforms and bindings are data (lightning.dope.json),
 * derived by the generic `dopePassConfig`; the CPU bolt precompute rides the
 * `binding.arrays` / `frameArrays` seam. Pin the derived uniform set + binding
 * exceptions so a `.dope` or backbone change that would alter the shader
 * contract fails loudly — and pin the datafied `tempo.frame` against the exact
 * hand-written `lightning-tempo.ts` formulas it replaced (bit-identical, the
 * datafication guarantee).
 */

import { describe, expect, it } from "vitest";
import { clamp01, dopePassConfig, envelope, parseDope } from "@dopaminefx/core";
import { LIGHTNING_FRAGMENT_SRC, LIGHTNING_VERTEX_SRC } from "../src/lightning-shader.js";
import { strikeProgress } from "../src/lightning-logic.js";
import doc from "../src/lightning.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: LIGHTNING_VERTEX_SRC, fragment: LIGHTNING_FRAGMENT_SRC });

/** The hand-written flash/strobe this `.dope` datafied (lightning-tempo.ts). */
function flashStrobeReference(life: number, flicker: number): number {
  const t = clamp01(life);
  const primary = Math.exp(-t / 0.035);
  const beats = 6;
  const phase = t * beats * Math.PI * 2;
  const spike = Math.max(0, Math.sin(phase));
  const sharp = Math.pow(spike, 8);
  const tail = Math.pow(1 - t, 2.2) * 0.28 * flicker;
  return primary + sharp * tail;
}

describe("lightning derived pass config", () => {
  it("derives the expected uniforms (as a set) and bindings", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set([
        "uExposure", "uThickness", "uFlashBright", "uSeed", "uStrike", "uFlash",
        "uVerts", "uBoltMeta", // the binding.arrays frame arrays
      ]),
    );
    expect(CONFIG.bindings).toEqual({
      boltSeed: "uSeed", overshoot: null, flicker: null, jagged: null, branches: null,
    });
    // The strike is anchored on the action point.
    expect(CONFIG.usesOrigin).toBe(true);
  });

  it("shadowHeightFrac is the bolt-silhouette expression (thickness * 14 + 0.4)", () => {
    const frac = CONFIG.shadowHeightFrac as (p: Record<string, number>) => number;
    expect(frac({ thickness: 0.02 })).toBeCloseTo(0.02 * 14 + 0.4, 15);
  });

  it("tempo.frame is BIT-IDENTICAL to the hand-written tempo it replaced", () => {
    const params = { overshoot: 1.3, flicker: 0.65 };
    for (const life of [0, 0.01, 0.05, 0.2, 0.45, 0.7, 0.9, 1]) {
      const animMs = life * 850;
      const out = CONFIG.frame({ animMs, life, elapsedMs: animMs }, params);
      expect(out.amp).toBe(envelope(life, params.overshoot));
      expect(out.uStrike).toBe(strikeProgress(animMs));
      expect(out.uFlash).toBe(flashStrobeReference(life, params.flicker));
    }
  });
});
