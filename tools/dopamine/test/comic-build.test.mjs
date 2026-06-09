/**
 * Toolchain test: the single `effects/comic/comic.dope.json` (data + binding
 * contract + x-build), run through `@dopamine/build`, emits COMPLETE, standalone
 * packages — a SwiftPM package and an npm package — each with a PORTABLE embedded
 * `.dope` (the toolchain keys stripped, not a symlink), plus the gitignored
 * in-workspace `.dope` the web package imports. `swift build` / `tsc` prove they
 * compile (run separately, since they need the platform toolchains).
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildEffect, loadEffect, portableDope } from "../src/build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", ".."); // <repo>
const outDir = join(root, "dist");

describe("dopamine toolchain — comic → standalone platform packages", () => {
  it("loads the unified .dope (data + binding + x-build) as one document", async () => {
    const eff = await loadEffect(root, "effects/comic");
    expect(eff.slug).toBe("comic");
    expect(eff.doc.kind).toBe("panel");
    expect(eff.doc.binding.scatterKey).toBe("comicSeed");
    expect(eff.doc["x-build"].swift.module).toBe("DopamineEffectComic");
    expect(eff.doc["x-build"].web.package).toBe("@dopamine/effect-comic");
  });

  it("strips the toolchain-only keys from the PORTABLE embedded .dope", () => {
    const doc = { fmt: "dopamine-effect", v: "1.0.0", slug: "x", kind: "pass",
                  binding: { a: 1 }, "x-build": { swift: {} }, render: { params: {} } };
    const portable = portableDope(doc);
    expect(portable).toContain('"fmt": "dopamine-effect"');
    expect(portable).toContain('"render"');
    for (const k of ['"slug"', '"kind"', '"binding"', '"x-build"']) {
      expect(portable, k).not.toContain(k);
    }
  });

  it("emits a complete, installable SwiftPM package", async () => {
    const { dist } = await buildEffect({ root, effectDir: "effects/comic", outDir });
    const byPath = new Map(dist.map((a) => [a.path, a.content]));
    const M = "swift/DopamineEffectComic";
    const S = `${M}/Sources/DopamineEffectComic`;
    for (const p of [
      `${M}/Package.swift`, `${S}/Comic.swift`, `${S}/ComicBundle.swift`,
      `${S}/ComicTempo.swift`, `${S}/ComicPanel.swift`, `${S}/ComicUniforms.swift`,
      `${S}/Shaders/Comic.metal`, `${S}/Shaders/DopamineLook.metal`,
      `${S}/Shaders/ComicUniforms.metal`, `${S}/Resources/comic.dope.json`,
    ]) expect(byPath.has(p), p).toBe(true);
    expect(byPath.get(`${M}/Package.swift`)).toContain('product(name: "DopamineCore"');
    const swiftU = byPath.get(`${S}/ComicUniforms.swift`);
    expect(swiftU).toContain("public func packComicUniforms(");
    for (const f of ["exposure", "comicSeed", "presence", "inkBoost"]) {
      expect(swiftU, f).toContain(`public var ${f}:`);
    }
    // embedded .dope is the portable subset.
    const embedded = byPath.get(`${S}/Resources/comic.dope.json`);
    expect(embedded).not.toContain('"x-build"');
    expect(JSON.parse(embedded).render.params.exposure).toBeTruthy();
  });

  it("emits a complete, installable npm package + the in-workspace .dope", async () => {
    const { dist, sync } = await buildEffect({ root, effectDir: "effects/comic", outDir });
    const byPath = new Map(dist.map((a) => [a.path, a.content]));
    const W = "web/effect-comic";
    for (const p of [
      `${W}/package.json`, `${W}/tsconfig.json`, `${W}/src/index.ts`,
      `${W}/src/comic-shader.ts`, `${W}/src/comic-renderer.ts`, `${W}/src/comic-tempo.ts`,
      `${W}/src/comic-fonts.ts`, `${W}/src/comic-params.ts`, `${W}/src/comic.dope.json`,
    ]) expect(byPath.has(p), p).toBe(true);
    const pkg = JSON.parse(byPath.get(`${W}/package.json`));
    expect(pkg.name).toBe("@dopamine/effect-comic");
    expect(pkg.dependencies["@dopamine/core"]).toBeTruthy();
    // the embedded npm .dope is the portable subset.
    expect(byPath.get(`${W}/src/comic.dope.json`)).not.toContain('"x-build"');
    expect(JSON.parse(byPath.get(`${W}/src/comic.dope.json`)).render.params.exposure).toBeTruthy();

    // the in-source (gitignored) workspace .dope is written so the in-repo package
    // builds/tests against source.
    const syncPaths = sync.map((a) => a.path.replace(/\\/g, "/"));
    expect(syncPaths).toContain("effects/comic/web/src/comic.dope.json");
  });
});
