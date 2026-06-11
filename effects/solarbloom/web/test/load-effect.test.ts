/**
 * Phase 2 — public loadEffect() + host overrides.
 *
 * loadEffect binds an arbitrary `.dope` to a bundled render program and returns a
 * registered, resolvable factory. We assert: a doc loads + registers + resolves
 * params byte-identical to the bundled effect; host overrides (control clamp,
 * palette pin, outline swap) are applied + RE-VALIDATED (out-of-range / remote
 * refs rejected); a palette override replaces stops while keeping scatter parity;
 * an outline swap re-bakes the SDF so the icon data actually changes.
 */

import { describe, expect, it } from "vitest";

import { loadEffectSync, resolveDopeParams, parseDope, getOutline, oklchToLinearSrgb, resolveMood } from "@dopamine/core";
import { MAX_MOTES } from "../src/solarbloom-shader.js";
// Importing the effect registers its render program ("solarbloom").
import { solarbloom } from "../src/index.js";
import solarbloomDoc from "../src/solarbloom.dope.json";

const FEEL = { mood: "electric", intensity: 0.8, whimsy: 0.4, seed: 12345 };

describe("loadEffect — bind a .dope to its bundled program", () => {
  it("loads, registers, and resolves numeric params == the bundled effect", () => {
    const { factory, name } = loadEffectSync(solarbloomDoc as object, { name: "test.sb.basic" });
    expect(name).toBe("test.sb.basic");
    const params = factory.resolve(FEEL, {} as never) as Record<string, unknown>;
    const bundled = solarbloom.resolve(FEEL, resolveMood(FEEL.mood)) as unknown as Record<string, unknown>;
    for (const k of ["durationMs", "exposure", "bloomRadius", "moteCount", "moteSeed", "style"]) {
      expect(params[k], `field ${k}`).toEqual(bundled[k]);
    }
    expect(params.palette).toEqual(bundled.palette);
    // composeParams adds the whimsy-picked check glyph.
    expect(params.checkGlyph).toBeDefined();
  });

  it("rejects a doc with no/unknown program key", () => {
    const bad = JSON.parse(JSON.stringify(solarbloomDoc));
    delete bad.render.backends;
    expect(() => loadEffectSync(bad, { name: "x" })).toThrow(/program/);
  });
});

describe("host overrides", () => {
  it("clamps a control range + default, rejecting an out-of-range default", () => {
    const { doc } = loadEffectSync(solarbloomDoc as object, {
      name: "test.sb.clamp",
      overrides: { controls: { intensity: { max: 0.8, default: 0.6 } } },
    });
    const c = (doc as { controls: Record<string, { max: number; default: number }> }).controls
      .intensity;
    expect(c.max).toBe(0.8);
    expect(c.default).toBe(0.6);
    expect(() =>
      loadEffectSync(solarbloomDoc as object, {
        name: "test.sb.bad",
        overrides: { controls: { intensity: { max: 0.5, default: 0.9 } } },
      }),
    ).toThrow(/out of range/);
  });

  it("palette override replaces stops but keeps scatter (moteSeed) parity", () => {
    const stops: [
      { L: number; C: number; h: number },
      { L: number; C: number; h: number },
      { L: number; C: number; h: number },
    ] = [
      { L: 0.82, C: 0.12, h: 265 },
      { L: 0.86, C: 0.1, h: 25 },
      { L: 0.78, C: 0.18, h: 200 },
    ];
    const { factory } = loadEffectSync(solarbloomDoc as object, {
      name: "test.sb.brand",
      overrides: { palette: stops },
    });
    const params = factory.resolve(FEEL, {} as never) as Record<string, unknown>;
    // Palette == the explicit brand stops (converted to linear sRGB).
    expect(params.palette).toEqual(stops.map(oklchToLinearSrgb));
    // moteSeed scatter unchanged vs the generated path (rng order preserved).
    const generated = resolveDopeParams(parseDope(solarbloomDoc as object), FEEL, { MAX_MOTES }, "moteSeed");
    expect(params.moteSeed).toEqual(generated.moteSeed);
  });

  it("pinning seed locks the generated palette across fires", () => {
    const { factory } = loadEffectSync(solarbloomDoc as object, {
      name: "test.sb.seedpin",
      overrides: { seed: 777 },
    });
    const a = factory.resolve({ ...FEEL, seed: 1 }, {} as never) as Record<string, unknown>;
    const b = factory.resolve({ ...FEEL, seed: 99999 }, {} as never) as Record<string, unknown>;
    expect(a.palette).toEqual(b.palette);
    expect(a.moteSeed).toEqual(b.moteSeed);
  });

  it("swaps an outline path and RE-BAKES its SDF (icon data changes)", () => {
    const before = getOutline(parseDope(solarbloomDoc as object), "checkmark")!.sdf!.data;
    const { doc } = loadEffectSync(solarbloomDoc as object, {
      name: "test.sb.icon",
      overrides: { outlines: { checkmark: "M 20 20 L 80 80 M 80 20 L 20 80" } },
    });
    const o = getOutline(doc, "checkmark")!;
    expect(o.svgPath).toBe("M 20 20 L 80 80 M 80 20 L 20 80");
    expect(o.sdf?.data).toBeDefined();
    expect(o.sdf!.data).not.toBe(before); // a different shape → a different SDF
    expect(o.sdf!.data.startsWith("data:")).toBe(true);
  });

  it("rejects a swapped outline that smuggles a remote/absolute ref", () => {
    expect(() =>
      loadEffectSync(solarbloomDoc as object, {
        name: "test.sb.evil",
        overrides: { outlines: { checkmark: "https://evil.example/x.svg" } },
      }),
    ).toThrow(/self-contained|svgPath|ref/);
  });
});
