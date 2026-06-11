/**
 * Inkstroke's (Calligraphic Verdict) derived pass config — the `.dope` contract.
 *
 * The per-frame logic, uniforms and bindings are data (inkstroke.dope.json),
 * derived by the generic `dopePassConfig`. Pin the derived uniform set +
 * binding exceptions so a `.dope` or backbone change that would alter the
 * shader contract fails loudly. (The per-frame evaluator itself is covered by
 * core's frame-expr suite; cross-platform numeric parity by the Swift/Android
 * grids.)
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, parseDope } from "@dopamine/core";
import { INK_FRAGMENT_SRC, INK_VERTEX_SRC } from "../src/inkstroke-shader.js";
import doc from "../src/inkstroke.dope.json";

const DOPE = parseDope(doc as object);
const CONFIG = dopePassConfig(DOPE, { vertex: INK_VERTEX_SRC, fragment: INK_FRAGMENT_SRC });

describe("inkstroke derived pass config", () => {
  it("derives the expected uniforms (as a set) and bindings", () => {
    expect(new Set(CONFIG.uniforms)).toEqual(
      new Set(["uDraw", "uExposure", "uScale", "uPressure", "uWetness", "uBristle", "uDroplets", "uSeed"]),
    );
    expect(CONFIG.bindings).toEqual({ inkSeed: "uSeed", overshoot: null });
    // The gesture centres on the targeted element.
    expect(CONFIG.usesOrigin).toBe(true);
  });
});
