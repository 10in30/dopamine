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
import { DOTS_FRAGMENT_SRC } from "../../../effects/dots/web/src/dots-shader.ts";
import { FAIL_FRAGMENT_SRC } from "../../../effects/fail/web/src/fail-shader.ts";
import { HEARTBURST_FRAGMENT_SRC } from "../../../effects/heartburst/web/src/heartburst-shader.ts";
import { COMIC_FRAGMENT_SRC } from "../../../effects/comic/web/src/comic-shader.ts";

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
  // dots exercises the dynamic-count loop seam: a `for (i < MAX_DOTS) if (i >= count)
  // break;` row, the int-as-float uDotCount uniform, and a fully declarative looper.
  { slug: "dots", fragment: DOTS_FRAGMENT_SRC },
  { slug: "fail", fragment: FAIL_FRAGMENT_SRC },
  { slug: "lightning", fragment: LIGHTNING_FRAGMENT_SRC },
  // heartburst exercises the PANEL seams: the `vUv` reconstruction (the panel
  // shaders sample in a y-up vUv) and the panel sampler at texture(0).
  { slug: "heartburst", fragment: HEARTBURST_FRAGMENT_SRC },
  // comic is the heaviest panel hybrid: the panel sampler at texture(0), the
  // 2-arg atan→atan2, radians() inlining, and the scatter `uSeed`→u.comicSeed map.
  { slug: "comic", fragment: COMIC_FRAGMENT_SRC },
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

// The single-source guard: a uniform the codegen can't bind (e.g. the panel
// runtime's `uCenter` alias — which compiles on web but is undeclared in the
// generated MSL struct, the comic/heartburst macOS-only failure class) must
// THROW at transpile time, not slip through to the Metal compiler.
test("glslToMSL throws on a uniform the codegen can't bind (uCenter → uOrigin hint)", () => {
  const fragment = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec2 uCenter;
void main() {
  vec2 d = gl_FragCoord.xy - uCenter;
  fragColor = vec4(length(d) / uResolution.x, 0.0, 0.0, 1.0);
}`;
  const fields = buildFields({ render: { params: {} }, binding: {} }, {});
  expect(() => glslToMSL({ slug: "probe", fragment, uniformMap: buildUniformMap(fields), samplers: [], arrays: [] }))
    .toThrow(/uCenter[\s\S]*uOrigin/);
});

// A buffer-array param (binding.arrays — lightning's uVerts/uBoltMeta) is a
// LEGITIMATE bare `u<Name>` in the MSL (a `constant floatN *` fragment param),
// so the guard must NOT flag it. (Covered transitively by lightning's snapshot,
// pinned here directly so the guard's array exclusion can't silently regress.)
test("glslToMSL does not flag declared buffer-array params as unbindable", () => {
  const fragment = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec2 uResolution;
uniform vec2 uVerts[2];
void main() { fragColor = vec4(uVerts[0] / uResolution, 0.0, 1.0); }`;
  const fields = buildFields({ render: { params: {} }, binding: {} }, {});
  expect(() => glslToMSL({
    slug: "probe", fragment, uniformMap: buildUniformMap(fields), samplers: [],
    arrays: [{ name: "verts", web: "uVerts", size: 2, buffer: 1 }],
  })).not.toThrow();
});
