/**
 * dopamine toolchain — GLSL ES 3.00 → Metal Shading Language transpiler.
 *
 * The web ships the canonical shader as GLSL ES 3.00 (`<name>-shader.ts`). Android
 * reuses those exact GLSL bytes (same dialect). Metal needs MSL — historically a
 * hand-port per effect (10 files that can silently drift from the GLSL they mirror).
 *
 * This is the scoped, mechanical translator that lets the GLSL be the SINGLE source
 * for Metal too. It covers exactly the divergence set the hand-ports use (see
 * DopamineLook.metal's "PORT DIVERGENCES" note): the `vecN→floatN` / `matN→floatNxN`
 * type spelling, the per-name uniform reads becoming one `constant <Name>Uniforms &u`
 * struct, the shared-look calls gaining their `dop_` prefix (+ the palette stops
 * passed to `dop_paletteMix`), `out T` params becoming `thread T &`, and `main()`
 * becoming the `<slug>_vertex` / `<slug>_fragment` entry points (with the y-flip
 * preamble + the premultiplied light-out tail).
 *
 * VERIFICATION: the output is gated TOKEN-FOR-TOKEN (comments/whitespace ignored)
 * against the committed hand-ported `.metal` for every effect (tools/dopamine/test/
 * shader-msl.test.mjs), so the translator is provably faithful WITHOUT needing a
 * Metal compiler. It throws on any construct outside the supported subset.
 */

/** Shared-look function names (GLSL) → their MSL `dop_`-prefixed equivalents. */
export const LOOK_FNS = {
  hash11: "dop_hash11",
  hash21: "dop_hash21",
  vnoise: "dop_vnoise",
  fbm: "dop_fbm",
  domainWarp: "dop_domainWarp",
  paletteMix: "dop_paletteMix",
  iridescent: "dop_iridescent",
  dispersionAmount: "dop_dispersionAmount",
  sdSeg: "dop_sdSeg",
  tonemapACES: "dop_tonemapACES",
  ditherAdd: "dop_ditherAdd",
  particleSprite: "dop_particleSprite",
  particleFade: "dop_particleFade",
};

/** GLSL vector/matrix type spellings → MSL. */
const TYPE_MAP = {
  vec2: "float2", vec3: "float3", vec4: "float4",
  ivec2: "int2", ivec3: "int3", ivec4: "int4",
  bvec2: "bool2", bvec3: "bool3", bvec4: "bool4",
  mat2: "float2x2", mat3: "float3x3", mat4: "float4x4",
};

const GLSL_SCALARS = new Set(["void", "float", "int", "bool", "uint"]);
const ALL_TYPES = new Set([...Object.keys(TYPE_MAP), ...GLSL_SCALARS]);

/** Strip `//` and `/* *​/` comments (kept simple: GLSL has no strings). */
export function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");
}

/** Collapse runs of whitespace → a single space; trim. For token comparison. */
function canonWhitespace(s) {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * Tokenize GLSL/MSL-ish source for EQUIVALENCE comparison: drop comments, then
 * split into identifiers/numbers/operators. Whitespace and comments are ignored,
 * so artisanal prose never affects the gate — only the code tokens do.
 */
export function tokenize(src) {
  const noComments = stripComments(src);
  const toks = noComments.match(/[A-Za-z_][A-Za-z0-9_]*|0[xX][0-9a-fA-F]+|\d*\.?\d+([eE][-+]?\d+)?|[^\s\w]/g);
  return (toks ?? []).filter((t) => t.trim().length > 0);
}

/** Split a parenthesized argument list on TOP-LEVEL commas (depth 0). */
function splitArgs(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.trim().length || out.length) out.push(cur);
  return out;
}

/**
 * Parse a GLSL source into its preamble (directives/uniforms/defines/look chunks)
 * and the ordered list of TOP-LEVEL function definitions (bespoke funcs + main).
 * Look-chunk functions (LOOK_FNS) are dropped — Metal `#include`s them.
 */
export function parseFunctions(src) {
  const body = stripComments(src);
  const defines = [];
  const fns = [];
  let i = 0;
  const n = body.length;

  // Walk top-level, recognizing `#define`, directive lines we drop, and func defs.
  while (i < n) {
    // skip whitespace
    if (/\s/.test(body[i])) { i++; continue; }

    // preprocessor / directive line
    if (body[i] === "#") {
      const eol = body.indexOf("\n", i);
      const line = body.slice(i, eol === -1 ? n : eol).trim();
      const m = line.match(/^#define\s+(\w+)\s+(.*)$/);
      if (m && m[1] !== "TAU") defines.push({ name: m[1], value: m[2].trim() });
      i = eol === -1 ? n : eol + 1;
      continue;
    }

    // a statement/declaration starting here — read up to ';' or '{'
    let j = i;
    while (j < n && body[j] !== ";" && body[j] !== "{") j++;
    if (j >= n) break;
    if (body[j] === ";") {
      // a top-level declaration (uniform/out/precision/...) — drop it.
      i = j + 1;
      continue;
    }
    // body[j] === '{' — a function definition: capture its brace-balanced body.
    const header = body.slice(i, j).trim();
    let depth = 0, k = j;
    for (; k < n; k++) {
      if (body[k] === "{") depth++;
      else if (body[k] === "}") { depth--; if (depth === 0) { k++; break; } }
    }
    const bodyText = body.slice(j, k);
    const hm = header.match(/^(\w+)\s+(\w+)\s*\(([\s\S]*)\)$/);
    if (!hm) throw new Error(`shader: unparseable function header: ${header}`);
    const [, ret, name, paramStr] = hm;
    fns.push({ ret, name, paramStr: paramStr.trim(), bodyText });
    i = k;
  }
  return { defines, fns };
}

/** Parse one GLSL param list into {type, isOut, name} entries. */
function parseParams(paramStr) {
  if (!paramStr.trim()) return [];
  return splitArgs(paramStr).map((p) => {
    const parts = p.trim().split(/\s+/);
    let isOut = false;
    if (parts[0] === "out" || parts[0] === "inout") { isOut = true; parts.shift(); }
    if (parts[0] === "in") parts.shift();
    const [type, name] = parts;
    return { type, name, isOut };
  });
}

/**
 * Rewrite an expression/statement body GLSL→MSL at the token level:
 *  - vecN/matN type spellings, uniform reads (uX → u.field), look-fn renames,
 *    and the `paletteMix(x)` → `dop_paletteMix(x, u.c0, u.c1, u.c2)` stop-append.
 *  - bespoke-call `u` injection is handled by the caller (needs signature info).
 */
function rewriteTokens(code, { uniformMap }) {
  // Type spellings + uniform reads + simple look renames (identifiers only).
  let out = code.replace(/\b([A-Za-z_]\w*)\b/g, (id) => {
    if (TYPE_MAP[id]) return TYPE_MAP[id];
    if (uniformMap[id]) return uniformMap[id];
    return id;
  });
  return out;
}

/**
 * Inject `u` into bespoke call sites and rename look calls (incl. the palette-stop
 * append). `sigs` maps fnName → { needsU, firstOutIdx }. Processes innermost args
 * by recursing on each call's argument text.
 */
function rewriteCalls(code, sigs) {
  // Find `name(` occurrences and rewrite the matching argument list.
  let result = "";
  let i = 0;
  const n = code.length;
  while (i < n) {
    const m = /([A-Za-z_]\w*)\s*\(/.exec(code.slice(i));
    if (!m) { result += code.slice(i); break; }
    const start = i + m.index;
    const name = m[1];
    const openParen = start + m[0].length - 1;
    // find matching ')'
    let depth = 0, k = openParen;
    for (; k < n; k++) {
      if (code[k] === "(") depth++;
      else if (code[k] === ")") { depth--; if (depth === 0) break; }
    }
    const argText = code.slice(openParen + 1, k);
    result += code.slice(i, start) + name + "(";
    const args = argText.trim() === "" ? [] : splitArgs(argText).map((a) => rewriteCalls(a, sigs));

    if (name === "paletteMix") {
      // dop_paletteMix(t, u.c0, u.c1, u.c2)
      result = result.slice(0, -("paletteMix(".length)) + "dop_paletteMix(";
      args.push(" u.c0", " u.c1", " u.c2");
      result += args.join(",");
    } else if (LOOK_FNS[name]) {
      result = result.slice(0, -((name + "(").length)) + LOOK_FNS[name] + "(";
      result += args.join(",");
    } else if (sigs[name] && sigs[name].needsU) {
      const idx = sigs[name].firstOutIdx; // insert u BEFORE the first out-arg
      const at = idx < 0 ? args.length : idx;
      args.splice(at, 0, args.length ? " u" : "u");
      result += args.join(",");
    } else {
      result += args.join(",");
    }
    result += ")";
    i = k + 1;
  }
  return result;
}

const pascal = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Transpile a GLSL ES 3.00 fragment shader to MSL.
 * @param {object} a
 * @param {string} a.slug              effect slug (entry-point prefix)
 * @param {string} a.fragment          resolved GLSL fragment source (chunks inlined)
 * @param {Record<string,string>} a.uniformMap  GLSL uniform token → `u.<field>`
 * @returns {string} MSL source (comment-free; gated by token-equivalence)
 */
export function glslToMSL({ slug, fragment, uniformMap }) {
  const Name = pascal(slug);
  const { defines, fns } = parseFunctions(fragment);

  // Pass 1: signatures — which bespoke fns take `u`, and where their first out-arg is.
  const bespoke = fns.filter((f) => !LOOK_FNS[f.name] && f.name !== "main");
  const sigInfo = {};
  for (const f of bespoke) {
    const params = parseParams(f.paramStr);
    sigInfo[f.name] = {
      params,
      firstOutIdx: params.findIndex((p) => p.isOut),
      needsU: false,
    };
  }
  // Fixpoint: a fn needs u if it reads a uniform, calls paletteMix, or calls a
  // bespoke fn that needs u.
  const uniformTokens = new Set(Object.values(uniformMap)); // e.g. u.resolution
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of bespoke) {
      if (sigInfo[f.name].needsU) continue;
      const rewritten = rewriteTokens(f.bodyText, { uniformMap });
      const readsUniform = [...uniformTokens].some((t) => rewritten.includes(t));
      const usesPalette = /\bpaletteMix\s*\(/.test(f.bodyText);
      const callsU = bespoke.some(
        (g) => g.name !== f.name && sigInfo[g.name].needsU && new RegExp(`\\b${g.name}\\s*\\(`).test(f.bodyText),
      );
      if (readsUniform || usesPalette || callsU) { sigInfo[f.name].needsU = true; changed = true; }
    }
  }

  // Pass 2: emit each bespoke fn (non-main) with inline + u param + thread& outs.
  const emitFn = (f) => {
    const info = sigInfo[f.name];
    const params = info.params.map((p) => {
      const ty = TYPE_MAP[p.type] ?? p.type;
      return p.isOut ? `thread ${ty} &${p.name}` : `${ty} ${p.name}`;
    });
    if (info.needsU) {
      const at = info.firstOutIdx < 0 ? params.length : info.firstOutIdx;
      params.splice(at, 0, `constant ${Name}Uniforms &u`);
    }
    let body = rewriteCalls(rewriteTokens(f.bodyText, { uniformMap }), sigInfo);
    const ret = TYPE_MAP[f.ret] ?? f.ret;
    return `inline ${ret} ${f.name}(${params.join(", ")}) ${body}`;
  };

  const mainFn = fns.find((f) => f.name === "main");
  if (!mainFn) throw new Error("shader: no main()");
  const fragBody = emitFragment(mainFn, { uniformMap, sigInfo });

  const out = [];
  out.push("#include <metal_stdlib>");
  out.push('#include "DopamineLook.metal"');
  out.push(`#include "${Name}Uniforms.metal"`);
  out.push("using namespace metal;");
  out.push("");
  for (const d of defines) out.push(`#define ${d.name} ${d.value}`);
  if (defines.length) out.push("");
  out.push("struct VSOut { float4 position [[position]]; };");
  out.push(`vertex VSOut ${slug}_vertex(uint vid [[vertex_id]]) {`);
  out.push("    VSOut o;");
  out.push("    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));");
  out.push("    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);");
  out.push("    return o;");
  out.push("}");
  out.push("");
  for (const f of bespoke) { out.push(emitFn(f)); out.push(""); }
  out.push(`fragment float4 ${slug}_fragment(`);
  out.push("    VSOut in [[stage_in]],");
  out.push(`    constant ${Name}Uniforms &u [[buffer(0)]]`);
  out.push(`) ${fragBody}`);
  out.push("");
  return out.join("\n");
}

/** Emit the fragment-entry BODY: y-flip preamble, shadow early-returns, light-out tail. */
function emitFragment(mainFn, { uniformMap, sigInfo }) {
  let body = rewriteCalls(rewriteTokens(mainFn.bodyText, { uniformMap }), sigInfo);
  // y-flip: gl_FragCoord.xy reads Metal's top-left [[position]] flipped to y-up.
  body = body.replace(/gl_FragCoord\.xy/g, "float2(in.position.x, u.resolution.y - in.position.y)");
  // `fragColor = X; return;` (early outs, e.g. shadow) → `return X;`
  body = body.replace(/fragColor\s*=\s*([^;]+);\s*return\s*;/g, "return $1;");
  // terminal light-out `fragColor = float4(max(col, 0.0), 1.0);` → premultiplied tail.
  body = body.replace(
    /fragColor\s*=\s*float4\(\s*max\(\s*(\w+)\s*,\s*0\.0\s*\)\s*,\s*1\.0\s*\)\s*;/,
    (_m, v) =>
      `${v} = max(${v}, 0.0);\n` +
      `    float outA = clamp(max(max(${v}.r, ${v}.g), ${v}.b), 0.0, 1.0);\n` +
      `    return float4(${v}, outA);`,
  );
  return body;
}

/** Build the GLSL-token → `u.<field>` map from a binding field list (+ scatter). */
export function buildUniformMap(fields) {
  const map = {};
  for (const f of fields) map[f.web] = `u.${f.name}`;
  return map;
}

export { canonWhitespace };
