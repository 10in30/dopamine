/**
 * Load an effect's canonical WEB GLSL ES 3.00 shader (vertex + fragment strings)
 * for the toolchain, by esbuild-bundling its `<name>-shader.ts` (resolving the
 * `@dopamine/core` look-chunk imports) and importing the result. This makes the
 * web GLSL the SINGLE SOURCE the generated MSL is derived from — no hand-ported
 * `.metal` to drift. Driven by the effect's `x-build.shader` block:
 *   { web: "web/src/<name>-shader.ts", vertexExport, fragmentExport, generateMSL }
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm } from "node:fs/promises";

/**
 * @param {string} root      repo root (to resolve @dopamine/core source)
 * @param {string} dir       the effect folder (absolute)
 * @param {object} shaderCfg x-build.shader: { web, vertexExport, fragmentExport }
 * @returns {Promise<{vertex:string, fragment:string}>}
 */
export async function loadWebGLSL(root, dir, shaderCfg) {
  const tmp = await mkdtemp(join(tmpdir(), "dope-glsl-"));
  try {
    const outfile = join(tmp, "shader.mjs");
    await build({
      entryPoints: [join(dir, shaderCfg.web)],
      bundle: true,
      format: "esm",
      outfile,
      logLevel: "silent",
      alias: { "@dopamine/core": join(root, "packages/core/src/index.ts") },
    });
    const mod = await import(pathToFileURL(outfile).href);
    const vertex = mod[shaderCfg.vertexExport];
    const fragment = mod[shaderCfg.fragmentExport];
    if (typeof vertex !== "string" || typeof fragment !== "string") {
      throw new Error(`glsl-load: ${shaderCfg.web} missing ${shaderCfg.vertexExport}/${shaderCfg.fragmentExport}`);
    }
    return { vertex, fragment };
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}
