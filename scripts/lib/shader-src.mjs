/**
 * Load effects' canonical WEB shader sources (the GLSL ES 3.00 vertex + fragment
 * strings) from Node, by esbuild-bundling the `<name>-shader.ts` (resolving its
 * `@dopaminefx/core` look-chunk imports) and importing the result. This is the same
 * GLSL the Android shader is generated from, so rendering it in a WebGL2 context
 * (SwiftShader speaks GLSL ES 3.00) exercises the shared body for BOTH platforms.
 */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { discoverEffects } from "./effects.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/**
 * effect slug → { file (shader .ts), vertex (export), fragment (export) } — DERIVED
 * from the one folder-discovered list + each effect's `x-build.shader` block, so a
 * new pure-shader effect is covered with no edit here. (Which effects actually get a
 * pixel gate is decided by the FIXTURES map in shader-goldens.mjs — texture-sampling
 * effects the standalone harness can't bind are left out there.)
 */
export const SHADER_EXPORTS = Object.fromEntries(
  discoverEffects(ROOT)
    .filter((e) => e.shader?.web && e.shader.vertexExport && e.shader.fragmentExport)
    .map((e) => [
      e.slug,
      { file: `effects/${e.slug}/${e.shader.web}`, vertex: e.shader.vertexExport, fragment: e.shader.fragmentExport },
    ]),
);

/**
 * @param {string[]} slugs
 * @returns {Promise<Record<string,{vertex:string,fragment:string}>>}
 */
export async function loadShaderSources(slugs) {
  const out = {};
  const dir = mkdtempSync(join(tmpdir(), "dope-shaders-"));
  for (const slug of slugs) {
    const spec = SHADER_EXPORTS[slug];
    if (!spec) throw new Error(`shader-src: no shader export map for "${slug}"`);
    const outfile = join(dir, `${slug}.mjs`);
    await build({
      entryPoints: [join(ROOT, spec.file)],
      bundle: true,
      format: "esm",
      outfile,
      logLevel: "silent",
      alias: { "@dopaminefx/core": join(ROOT, "packages/core/src/index.ts") },
    });
    const mod = await import(pathToFileURL(outfile).href);
    out[slug] = { vertex: mod[spec.vertex], fragment: mod[spec.fragment] };
  }
  return out;
}
