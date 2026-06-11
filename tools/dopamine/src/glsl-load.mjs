/**
 * Load an effect's canonical WEB GLSL ES 3.00 shader for the toolchain — the SINGLE
 * SOURCE the generated MSL + Android `.kt` are derived from (no hand-port to drift).
 *
 * Done with pure TEXT extraction (no bundler) so the build toolchain stays
 * DEPENDENCY-FREE: swift.yml / android.yml run `dopamine build` on a bare Node with
 * no `npm install`. We read the shader `.ts` source, inline the `${GLSL_*}` look
 * chunks (their template strings live in packages/core/.../look/*.ts) and substitute
 * the numeric `${CONST}`s (e.g. MAX_CURTAINS) — exactly what evaluating the JS
 * template literal would yield, so the resolved GLSL is byte-identical.
 *
 * Driven by `x-build.shader`: { web, vertexExport, fragmentExport, generateMSL }.
 */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

// The shared look-chunk libraries (GLSL_* template-string consts).
const LOOK_FILES = [
  "packages/core/src/engine/look/glsl.ts",
  "packages/core/src/engine/look/particles.glsl.ts",
];

// A template-literal body: any escaped char (`\``, `\$`, `\\`) or non-backtick run.
// The `(?:\\.|[^`])*` form does NOT stop at an escaped backtick (e.g. the `\`d\``
// in GLSL_PARTICLES' comments) the way a naive `[\s\S]*?` would, which truncated it.
const TEMPLATE_BODY = "`((?:\\\\.|[^`])*)`";
/** Unescape the JS template-literal escapes a chunk uses (`\\\``→`` ` ``, `\\$`→`$`). */
const unescapeTemplate = (s) => s.replace(/\\([`$\\])/g, "$1");

/** Extract every `export const NAME = /* glsl *​/ `BODY`` → { NAME: BODY } (unescaped). */
function extractTemplateConsts(text) {
  const out = {};
  const re = new RegExp(`export const (\\w+)\\s*=\\s*(?:/\\* glsl \\*/\\s*)?${TEMPLATE_BODY}`, "g");
  let m;
  while ((m = re.exec(text))) out[m[1]] = unescapeTemplate(m[2]);
  return out;
}

/** Extract one named `export const NAME = `…`` template body (unescaped). */
export function extractTemplate(text, name) {
  const m = text.match(new RegExp(`export const ${name}\\s*=\\s*(?:/\\* glsl \\*/\\s*)?${TEMPLATE_BODY}`));
  if (!m) throw new Error(`glsl-load: template ${name} not found`);
  return unescapeTemplate(m[1]);
}

/** Extract numeric `export const NAME = 7;` → { NAME: "7" } (string, as interpolated). */
function extractNumberConsts(text) {
  const out = {};
  const re = /export const (\w+)\s*=\s*(-?\d+(?:\.\d+)?)\s*;/g;
  let m;
  while ((m = re.exec(text))) out[m[1]] = m[2];
  return out;
}

async function loadLookChunks(root) {
  const chunks = {};
  for (const f of LOOK_FILES) Object.assign(chunks, extractTemplateConsts(await readFile(join(root, f), "utf8")));
  return chunks;
}

/** Substitute `${GLSL_*}` chunk bodies + `${CONST}` values into a template body. */
function resolveTemplate(body, chunks, consts) {
  return body.replace(/\$\{(\w+)\}/g, (_m, id) => {
    if (id.startsWith("GLSL_")) {
      if (!(id in chunks)) throw new Error(`glsl-load: unknown look chunk \${${id}}`);
      return chunks[id];
    }
    if (id in consts) return consts[id];
    throw new Error(`glsl-load: cannot resolve \${${id}}`);
  });
}

/**
 * The raw web shader `.ts` source text + its numeric consts — for the Android
 * generator, which keeps the `${GLSL_*}` chunk refs (look stays in Look.kt once)
 * and only resolves the non-chunk consts by value.
 */
export async function loadWebShaderSource(root, dir, shaderCfg) {
  const srcText = await readFile(join(dir, shaderCfg.web), "utf8");
  return { srcText, consts: extractNumberConsts(srcText) };
}

/** Fully-resolved vertex + fragment GLSL (chunks inlined) — what the MSL transpiler consumes. */
export async function loadWebGLSL(root, dir, shaderCfg) {
  const { srcText, consts } = await loadWebShaderSource(root, dir, shaderCfg);
  const chunks = await loadLookChunks(root);
  const templates = extractTemplateConsts(srcText);
  const get = (name) => {
    if (!(name in templates)) throw new Error(`glsl-load: ${name} not found in ${shaderCfg.web}`);
    return resolveTemplate(templates[name], chunks, consts);
  };
  return { vertex: get(shaderCfg.vertexExport), fragment: get(shaderCfg.fragmentExport) };
}
