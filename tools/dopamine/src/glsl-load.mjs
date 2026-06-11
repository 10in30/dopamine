/**
 * Load an effect's canonical WEB GLSL ES 3.00 shader for the toolchain — the SINGLE
 * SOURCE the generated MSL + Android `.kt` are derived from (no hand-port to drift).
 *
 * We esbuild-bundle the shader `.ts` (resolving its `@dopamine/core` look-chunk
 * imports + evaluating the template literal) and import the result, so the resolved
 * GLSL is exactly what the web ships — escapes, interpolation and all. (esbuild is a
 * declared toolchain dependency; CI installs it before `dopamine build`.)
 *
 * Driven by `x-build.shader`: { web, vertexExport, fragmentExport, generateMSL }.
 */
import { build } from "esbuild";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp, rm, readFile } from "node:fs/promises";

const ROOT_CORE = "packages/core/src/index.ts";

/** esbuild-bundle the shader module and import it → the module namespace (SRC strings + consts). */
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
      alias: { "@dopamine/core": join(root, ROOT_CORE) },
    });
    return await import(pathToFileURL(outfile).href);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

/** Fully-resolved vertex + fragment GLSL (chunks inlined) — what the MSL transpiler consumes. */
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
 * The raw web shader `.ts` source text + the imported module — for the Android
 * generator, which keeps the `${GLSL_*}` chunk refs (look stays in Look.kt once) so
 * it needs the SOURCE template, and resolves the non-chunk consts (e.g. MAX_CURTAINS)
 * from the module's exported values.
 */
export async function loadWebShaderSource(root, dir, shaderCfg) {
  const srcText = await readFile(join(dir, shaderCfg.web), "utf8");
  const mod = await importWebShaderModule(root, dir, shaderCfg);
  return { srcText, mod };
}

/**
 * Extract one named `export const NAME = /* glsl *​/ `…`` template body (raw, with its
 * `${…}` interpolations intact). The `(?:\\.|[^`])*` body allows escaped backticks so
 * a chunk/comment containing `\`x\`` isn't truncated.
 */
export function extractTemplate(text, name) {
  const m = text.match(new RegExp(`export const ${name}\\s*=\\s*(?:/\\* glsl \\*/\\s*)?\`((?:\\\\.|[^\`])*)\``));
  if (!m) throw new Error(`glsl-load: template ${name} not found`);
  return m[1];
}
