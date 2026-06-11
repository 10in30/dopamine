/**
 * Fail's derived pass config — the `.dope` contract.
 *
 * The per-frame logic, uniforms and bindings are data (fail.dope.json), derived
 * by the generic `dopePassConfig` (+ fail's code-shaped SDF/passUniforms hooks).
 * Pin the derived uniform set + binding exceptions + the bare-number shadow so
 * a `.dope` or backbone change that would alter the shader contract fails
 * loudly. (The per-frame evaluator itself is covered by core's frame-expr
 * suite; cross-platform numeric parity by the Swift/Android grids. Fail's
 * stamp/shake read the REAL un-stepped `elapsedMs` — the cross-platform clock
 * convention — which fail.test.ts exercises.)
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, parseDope } from "@dopamine/core";
import { FAIL_FRAGMENT_SRC, FAIL_VERTEX_SRC } from "../src/fail-shader.js";
import doc from "../src/fail.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: FAIL_VERTEX_SRC, fragment: FAIL_FRAGMENT_SRC });

describe("fail derived pass config", () => {
  it("derives the expected uniforms (as a set), bindings and shadow", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set(["uStamp", "uShake", "uExposure", "uSeverity", "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx", "uBoxPx"]),
    );
    expect(CONFIG.bindings).toEqual({ shakeAmount: null, failSeed: null, seed: null });
    expect(CONFIG.usesOrigin).toBe(true);
    expect(CONFIG.shadowHeightFrac).toBe(0.42); // bare-number passthrough
  });
});
