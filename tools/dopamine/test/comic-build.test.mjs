/**
 * Toolchain test: the single `effects/comic/comic.dope.json` (data + binding
 * contract + x-build), run through `@dopamine/build`, emits a COMPLETE, standalone
 * SwiftPM package — real `Package.swift`, the hand-written sources, the generated
 * binding glue, and a PORTABLE embedded `.dope` (the toolchain keys stripped, not
 * a symlink). `swift build dist/swift/DopamineEffectComic` proves it compiles (run
 * separately, since it needs the Swift toolchain).
 */
import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { buildEffect, loadEffect, portableDope } from "../src/build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..", ".."); // <repo>
const outDir = join(root, "dist");

describe("dopamine toolchain — comic → standalone SwiftPM package", () => {
  it("loads the unified .dope (data + binding + x-build) as one document", async () => {
    const eff = await loadEffect(root, "effects/comic");
    expect(eff.slug).toBe("comic");
    expect(eff.doc.kind).toBe("panel");
    expect(eff.doc.binding.scatterKey).toBe("comicSeed");
    expect(eff.doc["x-build"].swift.module).toBe("DopamineEffectComic");
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

  it("emits a complete, installable Swift package from the single folder", async () => {
    const artifacts = await buildEffect({ root, effectDir: "effects/comic", outDir });
    const byPath = new Map(artifacts.map((a) => [a.path, a.content]));

    const M = "swift/DopamineEffectComic";
    const S = `${M}/Sources/DopamineEffectComic`;

    const expected = [
      `${M}/Package.swift`,
      `${S}/Comic.swift`,
      `${S}/ComicBundle.swift`,
      `${S}/ComicTempo.swift`,
      `${S}/ComicPanel.swift`,
      `${S}/ComicUniforms.swift`,
      `${S}/Shaders/Comic.metal`,
      `${S}/Shaders/DopamineLook.metal`,
      `${S}/Shaders/ComicUniforms.metal`,
      `${S}/Resources/comic.dope.json`,
    ];
    for (const p of expected) expect(byPath.has(p), p).toBe(true);

    // Package.swift is a real standalone manifest depending on DopamineCore.
    expect(byPath.get(`${M}/Package.swift`)).toContain('.library(name: "DopamineEffectComic"');
    expect(byPath.get(`${M}/Package.swift`)).toContain('product(name: "DopamineCore"');

    // The embedded .dope is the PORTABLE runtime subset: parses, has render.params,
    // and carries NONE of the toolchain-only keys (standalone-safe).
    const embedded = byPath.get(`${S}/Resources/comic.dope.json`);
    expect(embedded).not.toContain('"x-build"');
    expect(embedded).not.toContain('"binding"');
    const parsed = JSON.parse(embedded);
    expect(parsed.fmt).toBe("dopamine-effect");
    expect(parsed.render.params.exposure).toBeTruthy();
    expect(parsed.baselines.celebratory).toBeTruthy();

    // The generated binding glue declares the expected fields + the packer.
    const swiftU = byPath.get(`${S}/ComicUniforms.swift`);
    expect(swiftU).toContain("public struct ComicUniforms {");
    for (const f of ["resolution", "exposure", "actionLines", "halftone", "saturation",
                     "comicSeed", "presence", "flash", "dotSize", "inkBoost"]) {
      expect(swiftU, f).toContain(`public var ${f}:`);
    }
    expect(swiftU).toContain("public func packComicUniforms(");
    const mslU = byPath.get(`${S}/Shaders/ComicUniforms.metal`);
    expect(mslU).toContain("struct ComicUniforms {");
    expect(mslU).toContain("float  exposure;");
    expect(mslU).toContain("float  comicSeed;");
  });
});
