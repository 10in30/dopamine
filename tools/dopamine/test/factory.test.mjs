/**
 * Generated factory-shell gate.
 *
 * A FULLY DECLARATIVE effect (single-source shader + datafied tempo/render/
 * binding) ships NO `swift/` or `android/` sources — the toolchain GENERATES
 * its Swift factory shell (+ resource-bundle accessor) and Kotlin registration
 * shim from the `.dope` (factory.mjs). Inkstroke is the first such effect; its
 * generated shells are gated byte-for-byte against committed snapshots
 * (`golden-factory/`), seeded from — and verified code-equal to — the
 * historical hand-written shims before those were deleted. (The macOS Metal
 * job + the Android build job compile the same output in CI; the Swift package
 * also builds on Linux behind the canImport guards.)
 */

import { test, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assertFactoryGeneratable,
  buildFrameArraysSpec,
  emitKotlinFactory,
  emitSwiftBundle,
  emitSwiftFactory,
} from "../src/factory.mjs";
import { generateSwiftPackage } from "../src/swift.mjs";
import { generateAndroidLibrary } from "../src/android.mjs";
import { loadEffect } from "../src/build.mjs";
import { loadLogic } from "../src/logic.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const golden = (name) => readFileSync(new URL(`./golden-factory/${name}`, import.meta.url), "utf8");

test("inkstroke: the generated factory shells match the committed snapshots", () => {
  expect(emitSwiftFactory("inkstroke")).toBe(golden("Inkstroke.swift"));
  expect(emitSwiftBundle("inkstroke")).toBe(golden("InkstrokeBundle.swift"));
  expect(emitKotlinFactory("inkstroke", "ai.dopamine.effect.inkstroke")).toBe(golden("Inkstroke.kt"));
});

test("lightning: the generated factory shells wire the frameArrays seam (snapshot)", async () => {
  // lightning has generated per-frame-geometry logic (x-build.logic): its shells
  // additionally call the generated renderer and bind the bundle through
  // `binding.arrays` (Metal: PassFrameArray buffers; GL: named uniform arrays).
  const eff = await loadEffect(root, "effects/lightning");
  const spec = buildFrameArraysSpec(eff.doc, "lightning", await loadLogic(eff));
  expect(emitSwiftFactory("lightning", spec)).toBe(golden("Lightning.swift"));
  expect(emitKotlinFactory("lightning", "ai.dopamine.effect.lightning", spec)).toBe(golden("Lightning.kt"));
});

// The fully declarative effects — those that ship NO swift/ or android/
// folder. Their dist packages must carry ONLY generated sources. (fail joined
// when its two code hooks became `.dope` data: `render.pass` + the sampler
// `outline`/`on` SDF source; lightning when its strike/flash tempo became
// `tempo.frame` and its bolt precompute rode `binding.arrays` — its packages
// additionally carry the TRANSPILED `<Name>Renderer` + its parity test.)
const GENERATED = [
  { slug: "aurora" },
  { slug: "ripple" },
  { slug: "inkstroke" },
  { slug: "halo" },
  { slug: "fail" },
  {
    slug: "lightning",
    extraSwift: ["LightningLogicParityTests.swift", "LightningRenderer.swift"],
    extraKt: ["LightningRenderer.kt"],
  },
];

for (const { slug, extraSwift = [], extraKt = [] } of GENERATED) {
  const Name = slug.charAt(0).toUpperCase() + slug.slice(1);
  test(`${slug}: the dist packages carry ONLY generated sources (no hand-written platform files)`, async () => {
    const eff = await loadEffect(root, `effects/${slug}`);
    const logic = await loadLogic(eff);
    const spec = buildFrameArraysSpec(eff.doc, slug, logic);

    const swift = await generateSwiftPackage({ root, eff, outDir: "/tmp/out", logic });
    const swiftSources = swift.filter((f) => f.path.endsWith(".swift") && !f.path.endsWith("Package.swift"));
    expect(swiftSources.map((f) => f.path.split("/").pop()).sort()).toEqual(
      [`${Name}.swift`, `${Name}Bundle.swift`, `${Name}Uniforms.swift`, ...extraSwift].sort(),
    );
    expect(swift.find((f) => f.path.endsWith(`/${Name}.swift`)).content).toBe(emitSwiftFactory(slug, spec));

    const android = await generateAndroidLibrary({ root, eff, logic });
    const ktSources = android.filter((f) => f.path.endsWith(".kt"));
    expect(ktSources.map((f) => f.path.split("/").pop()).sort()).toEqual(
      [`${Name}.kt`, `${Name}Shader.kt`, ...extraKt].sort(),
    );
    expect(android.find((f) => f.path.endsWith(`/${Name}.kt`)).content).toBe(
      emitKotlinFactory(slug, `ai.dopamine.effect.${slug}`, spec),
    );
  });
}

test("a non-declarative effect without platform sources is rejected with a pointer", () => {
  // Strip the datafied sections: generation must refuse rather than emit a
  // shell that would fail at runtime.
  const doc = {
    "x-build": { shader: { web: "web/src/x-shader.ts", generateMSL: true } },
    tempo: {},
    render: {},
    binding: {},
  };
  expect(() => assertFactoryGeneratable(doc, "x", "swift")).toThrow(/tempo\.frame.*shadowHeightFrac.*scatterKey/s);
  // …and a hand-shader effect (no single-source block) is rejected too.
  expect(() => assertFactoryGeneratable({ ...doc, "x-build": {} }, "x", "android")).toThrow(/x-build\.shader/);
});
