/**
 * Ripple's derived pass config — the `.dope` contract.
 *
 * The per-frame logic, uniforms and bindings are data (ripple.dope.json),
 * derived by the generic `dopePassConfig`. Pin the derived uniform set +
 * binding exceptions so a `.dope` or backbone change that would alter the
 * shader contract fails loudly. (The per-frame evaluator itself is covered by
 * core's frame-expr suite; cross-platform numeric parity by the Swift/Android
 * grids.)
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, parseDope } from "@dopamine/core";
import { RIPPLE_FRAGMENT_SRC, RIPPLE_VERTEX_SRC } from "../src/ripple-shader.js";
import doc from "../src/ripple.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: RIPPLE_VERTEX_SRC, fragment: RIPPLE_FRAGMENT_SRC });

describe("ripple derived pass config", () => {
  it("derives the expected uniforms (as a set) and bindings", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set(["uExposure", "uAmplitude", "uRings", "uWavelength", "uSpeed", "uCaustic", "uSeed"]),
    );
    expect(CONFIG.bindings).toEqual({ rippleSeed: "uSeed", overshoot: null });
    // The droplet lands where the user fired.
    expect(CONFIG.usesOrigin).toBe(true);
  });
});
