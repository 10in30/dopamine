/**
 * Load effects' canonical WEB shader sources (the GLSL ES 3.00 vertex + fragment
 * strings) from Node, by esbuild-bundling the `<name>-shader.ts` (resolving its
 * `@dopamine/core` look-chunk imports) and importing the result. This is the same
 * GLSL the Android shader is generated from, so rendering it in a WebGL2 context
 * (SwiftShader speaks GLSL ES 3.00) exercises the shared body for BOTH platforms.
 */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** effect slug → { file (shader .ts), vertex (export), fragment (export) }. */
export const SHADER_EXPORTS = {
  aurora: { file: "effects/aurora/web/src/aurora-shader.ts", vertex: "AURORA_VERTEX_SRC", fragment: "AURORA_FRAGMENT_SRC" },
  ripple: { file: "effects/ripple/web/src/ripple-shader.ts", vertex: "RIPPLE_VERTEX_SRC", fragment: "RIPPLE_FRAGMENT_SRC" },
  inkstroke: { file: "effects/inkstroke/web/src/inkstroke-shader.ts", vertex: "INK_VERTEX_SRC", fragment: "INK_FRAGMENT_SRC" },
  halo: { file: "effects/halo/web/src/halo-shader.ts", vertex: "HALO_VERTEX_SRC", fragment: "HALO_FRAGMENT_SRC" },
  // fail/solarbloom/confetti sample textures the harness can't bind standalone — they're
  // gated by the MSL/Android snapshots + CI's macOS sim / android emulator instead.
};

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
      alias: { "@dopamine/core": join(ROOT, "packages/core/src/index.ts") },
    });
    const mod = await import(pathToFileURL(outfile).href);
    out[slug] = { vertex: mod[spec.vertex], fragment: mod[spec.fragment] };
  }
  return out;
}
