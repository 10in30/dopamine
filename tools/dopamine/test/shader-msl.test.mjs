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
import { generateAndroidShaderKt } from "../src/android-shader.mjs";

import { AURORA_FRAGMENT_SRC } from "../../../effects/aurora/web/src/aurora-shader.ts";
import { RIPPLE_FRAGMENT_SRC } from "../../../effects/ripple/web/src/ripple-shader.ts";
import { LIGHTNING_FRAGMENT_SRC } from "../../../effects/lightning/web/src/lightning-shader.ts";
import { INK_FRAGMENT_SRC } from "../../../effects/inkstroke/web/src/inkstroke-shader.ts";
import { HALO_FRAGMENT_SRC } from "../../../effects/halo/web/src/halo-shader.ts";
import { FAIL_FRAGMENT_SRC } from "../../../effects/fail/web/src/fail-shader.ts";

const root = new URL("../../../", import.meta.url);
const readDope = (slug) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(`effects/${slug}/${slug}.dope.json`, root)), "utf8"));
const readSnapshot = (slug) =>
  readFileSync(new URL(`./golden-msl/${slug}.metal`, import.meta.url), "utf8");

// Migrated effects: transpiler output must byte-match the committed snapshot oracle.
// (lightning exercises the buffer-array seam: its `binding.arrays` uniform arrays
// become `constant floatN *` fragment buffers, threaded through the call graph.)
const SNAPSHOT = [
  { slug: "aurora", fragment: AURORA_FRAGMENT_SRC },
  { slug: "ripple", fragment: RIPPLE_FRAGMENT_SRC },
  { slug: "inkstroke", fragment: INK_FRAGMENT_SRC },
  { slug: "halo", fragment: HALO_FRAGMENT_SRC },
  { slug: "fail", fragment: FAIL_FRAGMENT_SRC },
  { slug: "lightning", fragment: LIGHTNING_FRAGMENT_SRC },
];

const transpile = (slug, fragment) => {
  const dope = readDope(slug);
  const fields = buildFields(dope, dope.binding ?? {});
  return glslToMSL({
    slug,
    fragment,
    uniformMap: buildUniformMap(fields),
    samplers: dope.binding?.samplers ?? [],
    arrays: dope.binding?.arrays ?? [],
  });
};

for (const { slug, fragment } of SNAPSHOT) {
  test(`${slug}: transpiled MSL matches the committed snapshot`, () => {
    expect(transpile(slug, fragment)).toBe(readSnapshot(slug));
  });
}

// The buffer-array seam throws on contract drift (a declared uniform array with
// no binding.arrays entry, or a size/buffer mismatch) instead of emitting MSL
// that would miscompile.
test("lightning: a uniform array outside the binding.arrays contract throws", () => {
  const dope = readDope("lightning");
  const fields = buildFields(dope, dope.binding ?? {});
  const uniformMap = buildUniformMap(fields);
  expect(() => glslToMSL({ slug: "lightning", fragment: LIGHTNING_FRAGMENT_SRC, uniformMap, arrays: [] }))
    .toThrow(/binding\.arrays/);
  const bad = dope.binding.arrays.map((a) => ({ ...a, size: a.web === "uVerts" ? 3 : a.size }));
  expect(() => glslToMSL({ slug: "lightning", fragment: LIGHTNING_FRAGMENT_SRC, uniformMap, arrays: bad }))
    .toThrow(/size/);
});

// Android `<Name>Shader.kt` is generated from the same web GLSL (look chunks kept as
// `${GLSL_*}` refs, + dopLightOut). Gated byte-for-byte against the committed snapshot
// (also Kotlin-compiled by android.yml + pixel-checked by the golden frame).
const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);
for (const { slug } of SNAPSHOT) {
  test(`${slug}: generated Android shader matches the committed snapshot`, async () => {
    const dope = readDope(slug);
    const Name = pascal(slug);
    const gen = await generateAndroidShaderKt({
      root: fileURLToPath(root),
      dir: fileURLToPath(new URL(`effects/${slug}`, root)),
      slug,
      namespace: dope["x-build"].android.namespace ?? `ai.dopamine.effect.${slug}`,
      shaderCfg: dope["x-build"].shader,
    });
    const want = readFileSync(new URL(`./golden-android/${Name}Shader.kt`, import.meta.url), "utf8");
    expect(gen.content).toBe(want);
  });
}
