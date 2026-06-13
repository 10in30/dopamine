/**
 * Fail's derived pass config — the `.dope` contract.
 *
 * The per-frame logic, uniforms, bindings AND the ✗ plumbing are data
 * (fail.dope.json), derived by the generic `dopePassConfig` with NO hooks:
 * `render.pass` supplies the box/stroke/range per-pass uniforms (sized to
 * `targetMinDimPx`) and the `binding.samplers` `outline`/`on` source supplies
 * the baked-SDF aux texture. Pin the derived uniform set + binding exceptions
 * + the bare-number shadow + the pass/aux derivations so a `.dope` or backbone
 * change that would alter the shader contract fails loudly. (The per-frame/
 * per-pass evaluators are covered by core's frame-expr suite; cross-platform
 * numeric parity by the Swift/Android grids.)
 */

import { describe, expect, it } from "vitest";
import { dopePassConfig, parseDope, type PassParams } from "@dopaminefx/core";
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

  it("derives the ✗ box/stroke/range per-pass uniforms from render.pass", () => {
    // 600×400 target box (device px, canvas fallback already applied by the
    // runner): boxPx = 0.15·400, strokePx = boxPx·0.13, rangePx = the baked
    // SDF's range(18) mapped through 2·boxPx over its viewBox width (100).
    const out = CONFIG.passUniforms!(null as unknown as HTMLCanvasElement, {} as PassParams, {
      width: 600,
      height: 400,
    });
    expect(out).toEqual({
      uBoxPx: 0.15 * 400,
      uSdfStrokePx: 0.15 * 400 * 0.13,
      uSdfRangePx: 18 * ((2 * (0.15 * 400)) / 100),
    });
  });

  it("derives the baked-✗ SDF aux texture from the sampler outline/on source", () => {
    const aux = CONFIG.auxTextures!({} as PassParams, null as never);
    expect(aux).toHaveLength(1);
    const spec = aux[0]!;
    expect(spec.kind).toBe("sdf");
    expect(spec.unit).toBe(1);
    expect(spec.sampler).toBe("uSdfTex");
    expect(spec.onUniform).toBe("uSdfOn");
    if (spec.kind === "sdf") {
      expect(spec.sdf.size * spec.sdf.size).toBe(spec.sdf.bytes.length);
      expect(spec.sdf.range).toBe(18);
      expect(spec.sdf.viewBox[2]).toBe(100);
    }
  });
});
