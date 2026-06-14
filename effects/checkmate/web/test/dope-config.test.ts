/**
 * Checkmate's derived pass config — the `.dope` contract.
 *
 * The per-frame logic, uniforms and bindings are all data (checkmate.dope.json),
 * derived by the generic `dopePassConfig` with NO hooks. Pin the derived uniform
 * set + binding exceptions + the bare-number shadow so a `.dope` or backbone
 * change that would alter the shader contract fails loudly. (The per-frame
 * evaluator is covered by core's frame-expr suite; cross-platform numeric parity
 * by the Swift/Android grids.)
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, parseDope } from "@dopaminefx/core";
import { CHECKMATE_FRAGMENT_SRC, CHECKMATE_VERTEX_SRC } from "../src/checkmate-shader.js";
import doc from "../src/checkmate.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: CHECKMATE_VERTEX_SRC, fragment: CHECKMATE_FRAGMENT_SRC });

describe("checkmate derived pass config", () => {
  it("derives the expected uniforms (as a set), bindings and shadow", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set(["uExposure", "uBling", "uSwoosh", "uRays", "uSpin", "uSizeFrac", "uSeed", "uPop"]),
    );
    expect(CONFIG.bindings).toEqual({ overshoot: null, checkmateSeed: "uSeed" });
    expect(CONFIG.usesOrigin).toBe(true);
    expect(CONFIG.shadowHeightFrac).toBe(0.5); // bare-number passthrough
  });

  it("has no samplers and no per-pass uniforms (the queen is analytic)", () => {
    expect(CONFIG.auxTextures).toBeUndefined();
    expect(CONFIG.passUniforms).toBeUndefined();
  });
});
