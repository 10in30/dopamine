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

test("heartburst: the generated factory shells wire the panel-draw seam (snapshot)", () => {
  // heartburst is the PANEL-class prover: its shells are generated like any
  // declarative effect, plus the `render.panel` wiring — the Swift shell hands
  // `drawHeartburstPanel` to `DopePanelPassConfig`, the Kotlin shell to
  // `dopePanelConfig`/`createPanelInstance` (the hand-written panel draw is
  // the ONLY per-effect platform source).
  expect(emitSwiftFactory("heartburst", null, "panel")).toBe(golden("Heartburst.swift"));
  expect(emitKotlinFactory("heartburst", "ai.dopamine.effect.heartburst", null, "panel")).toBe(
    golden("Heartburst.kt"),
  );
});

test("solarbloom: the generated factory shells wire the SPRITE-PANEL seam (snapshot)", () => {
  // solarbloom is the PASS-HYBRID prover: a sprite panel at an ARBITRARY unit
  // (texture(3)) ALONGSIDE the baked-SDF ✓ aux (texture(1)). The Swift shell
  // hands `drawSolarbloomPanel` to `DopeSpritePanelPassConfig` (the PASS runner
  // with the sprite-panel + aux seam), the Kotlin shell to
  // `dopePassConfig(draw=)`/`createPassInstance` — distinct from the panel-KIND
  // path (DopePanelPassConfig/dopePanelConfig) heartburst/comic/confetti use.
  expect(emitSwiftFactory("solarbloom", null, "sprite")).toBe(golden("Solarbloom.swift"));
  expect(emitKotlinFactory("solarbloom", "ai.dopamine.effect.solarbloom", null, "sprite")).toBe(
    golden("Solarbloom.kt"),
  );
});

test("solarbloom: the dist packages carry ONLY the sprite-panel draw beyond the generated sources", async () => {
  // The PASS-hybrid prover: like heartburst, exactly one hand-written file per
  // platform (the sprite-panel mote draw); factory, bundle, shader + uniforms
  // are all generated.
  const eff = await loadEffect(root, "effects/solarbloom");
  const swift = await generateSwiftPackage({ root, eff, outDir: "/tmp/out" });
  const swiftSources = swift.filter((f) => f.path.endsWith(".swift") && !f.path.endsWith("Package.swift"));
  expect(swiftSources.map((f) => f.path.split("/").pop()).sort()).toEqual(
    ["Solarbloom.swift", "SolarbloomBundle.swift", "SolarbloomPanel.swift", "SolarbloomUniforms.swift"].sort(),
  );
  expect(swift.find((f) => f.path.endsWith("/Solarbloom.swift")).content).toContain("DopeSpritePanelPassConfig");
  expect(swift.find((f) => f.path.endsWith("/Solarbloom.swift")).content).toContain("drawSolarbloomPanel");
  const android = await generateAndroidLibrary({ root, eff });
  const ktSources = android.filter((f) => f.path.endsWith(".kt"));
  expect(ktSources.map((f) => f.path.split("/").pop()).sort()).toEqual(
    ["Solarbloom.kt", "SolarbloomPanel.kt", "SolarbloomShader.kt"].sort(),
  );
  expect(android.find((f) => f.path.endsWith("/Solarbloom.kt")).content).toContain("draw = ::drawSolarbloomPanel");
});

test("heartburst: the dist packages carry ONLY the panel draw beyond the generated sources", async () => {
  const eff = await loadEffect(root, "effects/heartburst");
  const swift = await generateSwiftPackage({ root, eff, outDir: "/tmp/out" });
  const swiftSources = swift.filter((f) => f.path.endsWith(".swift") && !f.path.endsWith("Package.swift"));
  expect(swiftSources.map((f) => f.path.split("/").pop()).sort()).toEqual(
    ["Heartburst.swift", "HeartburstBundle.swift", "HeartburstPanel.swift", "HeartburstUniforms.swift"].sort(),
  );
  const android = await generateAndroidLibrary({ root, eff });
  const ktSources = android.filter((f) => f.path.endsWith(".kt"));
  expect(ktSources.map((f) => f.path.split("/").pop()).sort()).toEqual(
    ["Heartburst.kt", "HeartburstPanel.kt", "HeartburstShader.kt"].sort(),
  );
});

test("confetti: the dist packages carry ONLY the panel draw beyond the generated sources", async () => {
  // confetti CONVERGED onto the heartburst panel-hybrid path: the web Canvas2D
  // panel is now mirrored by per-platform panel draws, the procedural Metal/GLSL
  // shaders retired for the single-source GLSL, and the factory/tempo/uniforms
  // are generated — so each platform ships exactly one hand-written file (the
  // panel draw).
  const eff = await loadEffect(root, "effects/confetti");
  const swift = await generateSwiftPackage({ root, eff, outDir: "/tmp/out" });
  const swiftSources = swift.filter((f) => f.path.endsWith(".swift") && !f.path.endsWith("Package.swift"));
  expect(swiftSources.map((f) => f.path.split("/").pop()).sort()).toEqual(
    ["Confetti.swift", "ConfettiBundle.swift", "ConfettiPanel.swift", "ConfettiUniforms.swift"].sort(),
  );
  expect(swift.find((f) => f.path.endsWith("/Confetti.swift")).content).toContain("drawConfettiPanel");
  const android = await generateAndroidLibrary({ root, eff });
  const ktSources = android.filter((f) => f.path.endsWith(".kt"));
  expect(ktSources.map((f) => f.path.split("/").pop()).sort()).toEqual(
    ["Confetti.kt", "ConfettiPanel.kt", "ConfettiShader.kt"].sort(),
  );
  expect(android.find((f) => f.path.endsWith("/Confetti.kt")).content).toContain("drawConfettiPanel");
});

test("a render.panel effect without its panel-draw file is rejected with a pointer", async () => {
  // The generated factory wires draw<Name>Panel; emitting a shell without the
  // hand-written draw would fail at compile time — refuse with a pointer.
  const eff = await loadEffect(root, "effects/heartburst");
  const broken = { ...eff, dir: "/tmp/nonexistent-heartburst" };
  await expect(generateSwiftPackage({ root, eff: broken, outDir: "/tmp/out" })).rejects.toThrow(
    /HeartburstPanel\.swift/,
  );
  await expect(generateAndroidLibrary({ root, eff: broken })).rejects.toThrow(/HeartburstPanel\.kt/);
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
  { slug: "dots" },
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
