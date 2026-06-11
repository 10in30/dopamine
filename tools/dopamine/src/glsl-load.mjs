/**
 * Load an effect's canonical WEB GLSL ES 3.00 shader for the toolchain, by
 * esbuild-bundling its `<name>-shader.ts` (resolving the `@dopamine/core` look-chunk
 * imports) and importing the result. This makes the web GLSL the SINGLE SOURCE the
 * generated MSL (and Android `.kt`) are derived from — no hand-port to drift. Driven
 * by the effect's `x-build.shader` block:
 *   { web: "web/src/<name>-shader.ts", vertexExport, fragmentExport, generateMSL }
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile } from "node:fs/promises";

/**
 * esbuild-bundle the web shader module and import it — returns the full module
 * namespace (the *_SRC strings + any exported consts like MAX_CURTAINS).
 */
export async function importWebShaderModule(root, dir, shaderCfg) {
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
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Resolved vertex + fragment GLSL (chunks inlined) — what the MSL transpiler consumes. */
export async function loadWebGLSL(root, dir, shaderCfg) {
  const mod = await importWebShaderModule(root, dir, shaderCfg);
  const vertex = mod[shaderCfg.vertexExport];
  const fragment = mod[shaderCfg.fragmentExport];
  if (typeof vertex !== "string" || typeof fragment !== "string") {
    throw new Error(`glsl-load: ${shaderCfg.web} missing ${shaderCfg.vertexExport}/${shaderCfg.fragmentExport}`);
  }
  return { vertex, fragment };
}

/**
 * The raw web shader `.ts` SOURCE text + the imported module — for the Android
 * generator, which keeps the `${GLSL_*}` chunk interpolations (so the look stays in
 * Look.kt once) and only resolves the non-chunk consts (e.g. MAX_CURTAINS) by value.
 */
export async function loadWebShaderSource(root, dir, shaderCfg) {
  const srcText = await readFile(join(dir, shaderCfg.web), "utf8");
  const mod = await importWebShaderModule(root, dir, shaderCfg);
  return { srcText, mod };
}
