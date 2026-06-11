/**
 * GLSL→MSL transpiler gate.
 *
 * MIGRATED effects (those with `x-build.shader.generateMSL`) no longer ship a
 * hand-ported `.metal` — the toolchain TRANSPILES it from the single canonical web
 * GLSL. Their transpiler output is gated byte-for-byte against a committed snapshot
 * (`golden-msl/<slug>.metal`), so a transpiler regression shows up as a reviewable
 * diff. Each snapshot was seeded from — and verified token-equal to — the effect's
 * historical hand-port before that hand-port was deleted (and is independently
 * compiled by the macOS Metal job + pixel-checked by the golden frame gate).
 *
 * NOT-YET-MIGRATED effects must still TRANSPILE cleanly; exact parity with their
 * (still hand-ported) `.metal` is out of scope — those hand-ports took manual
 * liberties (see notes) that CI's Metal compile + the reel adjudicate.
 */

import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { glslToMSL, buildUniformMap } from "../src/shader.mjs";
import { buildFields } from "../src/uniforms.mjs";

import { AURORA_FRAGMENT_SRC } from "../../../effects/aurora/web/src/aurora-shader.ts";
import { RIPPLE_FRAGMENT_SRC } from "../../../effects/ripple/web/src/ripple-shader.ts";
import { LIGHTNING_FRAGMENT_SRC } from "../../../effects/lightning/web/src/lightning-shader.ts";
import { INK_FRAGMENT_SRC } from "../../../effects/inkstroke/web/src/inkstroke-shader.ts";

const root = new URL("../../../", import.meta.url);
const readDope = (slug) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`effects/${slug}/${slug}.dope.json`, root)), "utf8"));
const readSnapshot = (slug) =>
  readFileSync(new URL(`./golden-msl/${slug}.metal`, import.meta.url), "utf8");

// Migrated effects: transpiler output must byte-match the committed snapshot oracle.
const SNAPSHOT = [
  { slug: "aurora", fragment: AURORA_FRAGMENT_SRC },
];

// Not yet migrated (still hand-ported); their hand-ports diverge from a mechanical
// transpile — NOT translator bugs, recorded so the divergence is tracked:
//   • ripple    — hand-port INLINES `u.resolution` (drops the `float2 res =` local).
//   • inkstroke — hand-port orders `inkDraw()` BEFORE the vertex entry (ordering).
//   • lightning — hand-port fragment takes a `constant float2 *verts [[buffer]]` (its
//                 CPU bolt-precompute seam) — a Metal-specific binding (P3).
const PENDING = [
  { slug: "ripple", fragment: RIPPLE_FRAGMENT_SRC },
  { slug: "lightning", fragment: LIGHTNING_FRAGMENT_SRC },
  { slug: "inkstroke", fragment: INK_FRAGMENT_SRC },
];

const transpile = (slug, fragment) => {
  const dope = readDope(slug);
  const fields = buildFields(dope, dope.binding ?? {});
  return glslToMSL({ slug, fragment, uniformMap: buildUniformMap(fields) });
};

for (const { slug, fragment } of SNAPSHOT) {
  test(`${slug}: transpiled MSL matches the committed snapshot`, () => {
    expect(transpile(slug, fragment)).toBe(readSnapshot(slug));
  });
}

for (const { slug, fragment } of PENDING) {
  test(`${slug}: transpiles to plausible MSL (CI-gated for exactness)`, () => {
    const msl = transpile(slug, fragment);
    expect(msl).toContain(`fragment float4 ${slug}_fragment(`);
    expect(msl).toContain('#include "DopamineLook.metal"');
  });
}
