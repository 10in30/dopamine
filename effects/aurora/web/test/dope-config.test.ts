/**
 * Aurora's derived pass config — the `.dope` contract.
 *
 * The per-frame logic, uniforms and bindings are data (aurora.dope.json),
 * derived by the generic `dopePassConfig`. Pin the derived uniform set +
 * binding exceptions so a `.dope` or backbone change that would alter the
 * shader contract fails loudly. (The per-frame evaluator itself is covered by
 * core's frame-expr suite; cross-platform numeric parity by the Swift/Android
 * grids.)
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, parseDope } from "@dopamine/core";
import { AURORA_FRAGMENT_SRC, AURORA_VERTEX_SRC } from "../src/aurora-shader.js";
import doc from "../src/aurora.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: AURORA_VERTEX_SRC, fragment: AURORA_FRAGMENT_SRC });

describe("aurora derived pass config", () => {
  it("derives the expected uniforms (as a set) and bindings", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set(["uExposure", "uCoverage", "uBandY", "uBandHeight", "uSway", "uSweep", "uStriation", "uRays", "uSeed"]),
    );
    expect(CONFIG.bindings).toEqual({ auroraSeed: "uSeed", overshoot: null });
    // Aurora paints the whole sky — it ignores the fire origin.
    expect(CONFIG.usesOrigin ?? false).toBe(false);
  });
});
