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
 * Inject `u` into bespoke call sites, rename look calls (incl. the palette-stop
 * append), rewrite `texture(uX, uv)` → `<name>.sample(texSampler, uv)`, and thread
 * the texture(s) + sampler — and the buffer ARRAYS (`binding.arrays`) — into
 * bespoke calls that need them. `sigs` maps fnName → { needsU, needsTex, arrs,
 * firstOutIdx }; `ctx` = { samplerMap (uX→mslName), samplerArgs (the trailing
 * `<name>…, texSampler` call args), arrayOrder (binding.arrays web names) }.
 */
function rewriteCalls(code, sigs, ctx = { samplerMap: {}, samplerArgs: [], arrayOrder: [] }) {
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
    const args = argText.trim() === "" ? [] : splitArgs(argText).map((a) => rewriteCalls(a, sigs, ctx));

    if (name === "texture" && ctx.samplerMap[args[0]?.trim()]) {
      // GLSL texture(uX, uv) → MSL <name>.sample(texSampler, uv).
      const texName = ctx.samplerMap[args[0].trim()];
      result = result.slice(0, -("texture(".length)) + `${texName}.sample(`;
      result += ["texSampler", ...args.slice(1)].join(",");
    } else if (name === "atan" && args.length === 2) {
      // GLSL 2-arg atan(y, x) is MSL atan2(y, x) (1-arg atan stays atan).
      result = result.slice(0, -("atan(".length)) + "atan2(";
      result += args.join(",");
    } else if (/^float([234])x\1$/.test(name) && args.length === Number(name[5]) ** 2) {
      // GLSL matN(scalars…) is COLUMN-major; MSL has no scalar matrix constructor,
      // so group the N*N scalars into N floatN columns.
      const N = Number(name[5]);
      const cols = [];
      for (let c = 0; c < N; c++) cols.push(`float${N}(${args.slice(c * N, c * N + N).map((s) => s.trim()).join(", ")})`);
      result += cols.join(", ");
    } else if (name === "paletteMix") {
      // dop_paletteMix(t, u.c0, u.c1, u.c2)
      result = result.slice(0, -("paletteMix(".length)) + "dop_paletteMix(";
      args.push(" u.c0", " u.c1", " u.c2");
      result += args.join(",");
    } else if (LOOK_FNS[name]) {
      result = result.slice(0, -((name + "(").length)) + LOOK_FNS[name] + "(";
      result += args.join(",");
    } else if (sigs[name] && (sigs[name].needsU || sigs[name].needsTex || sigs[name].arrs?.size)) {
      if (sigs[name].needsU) {
        const idx = sigs[name].firstOutIdx; // insert u BEFORE the first out-arg
        const at = idx < 0 ? args.length : idx;
        args.splice(at, 0, args.length ? " u" : "u");
      }
      // buffer arrays, then texture(s) + sampler, thread in at the very end
      // (after u + out-args), in declared binding order.
      for (const w of ctx.arrayOrder ?? []) if (sigs[name].arrs?.has(w)) args.push(` ${w}`);
      if (sigs[name].needsTex) for (const a of ctx.samplerArgs) args.push(` ${a}`);
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
 * Find the GLSL `uniform vecN name[SIZE];` ARRAY declarations and validate them
 * against the `.dope` `binding.arrays` contract (the cross-platform home for
 * per-frame array plumbing — web/GL bind these by NAME as uniform arrays, Metal
 * binds each as a `constant floatN *` FRAGMENT BUFFER at the declared index).
 * Returns the binding entries in DECLARED `binding.arrays` order, each with its
 * MSL pointer type.
 */
function resolveUniformArrays(fragment, arrays) {
  const declared = new Map(); // web name → vecN
  const re = /\buniform\s+(\w+)\s+(\w+)\s*\[[^\]]*\]\s*;/g;
  for (const m of stripComments(fragment).matchAll(re)) declared.set(m[2], m[1]);
  const out = [];
  for (const a of arrays) {
    const vecType = declared.get(a.web);
    if (!vecType) throw new Error(`shader: binding.arrays "${a.web}" is not a declared uniform array`);
    if (vecType !== `vec${a.size}`) {
      throw new Error(`shader: uniform array ${a.web} is ${vecType} but binding.arrays declares size ${a.size}`);
    }
    if (!(a.buffer >= 1)) throw new Error(`shader: binding.arrays "${a.web}" needs a fragment buffer index >= 1`);
    out.push({ ...a, msl: `float${a.size}` });
    declared.delete(a.web);
  }
  if (declared.size) {
    throw new Error(`shader: uniform array(s) without a binding.arrays entry: ${[...declared.keys()].join(", ")}`);
  }
  return out;
}

/**
 * Transpile a GLSL ES 3.00 fragment shader to MSL.
 * @param {object} a
 * @param {string} a.slug              effect slug (entry-point prefix)
 * @param {string} a.fragment          resolved GLSL fragment source (chunks inlined)
 * @param {Record<string,string>} a.uniformMap  GLSL uniform token → `u.<field>`
 * @param {Array<{name:string,web:string,size:number,buffer:number}>} [a.arrays]
 *        the `.dope` `binding.arrays` contract: declared GLSL uniform ARRAYS that
 *        become `constant floatN *<web> [[buffer(idx)]]` fragment params, threaded
 *        through the call graph like the texture samplers.
 * @returns {string} MSL source (comment-free; gated by token-equivalence)
 */
export function glslToMSL({ slug, fragment, uniformMap, samplers = [], arrays = [] }) {
  const Name = pascal(slug);
  const bufferArrays = resolveUniformArrays(fragment, arrays);
  const { defines, fns } = parseFunctions(fragment);

  // Texture samplers (from the .dope binding): GLSL `uniform sampler2D uX` → an MSL
  // `texture2d<float> <name> [[texture(idx)]]` param + one shared `sampler texSampler
  // [[sampler(0)]]`. `samplerMap` rewrites `texture(uX,…)`; `samplerArgs` are the
  // trailing call args threaded into sampling helpers; `texParams` the signature decls.
  const samplerMap = Object.fromEntries(samplers.map((s) => [s.web, s.name]));
  const samplerArgs = [...samplers.map((s) => s.name), ...(samplers.length ? ["texSampler"] : [])];
  const texParams = samplers.map((s) => `texture2d<float> ${s.name}`);
  const arrayOrder = bufferArrays.map((a) => a.web);
  const ctx = { samplerMap, samplerArgs, arrayOrder };

  // Avoid the `u` collision: effect functions gain a `constant <Name>Uniforms &u`
  // param, so any GLSL identifier literally named `u` (e.g. inkstroke's arc-fraction
  // param) must be renamed (→ `uu`) so it doesn't shadow the uniform struct. Uniform
  // reads are spelled `uName` (longer ⇒ unaffected by the `\bu\b` word match).
  for (const f of fns) {
    f.paramStr = f.paramStr.replace(/\bu\b/g, "uu");
    f.bodyText = f.bodyText.replace(/\bu\b/g, "uu");
  }

  // Pass 1: signatures — which bespoke fns take `u`, and where their first out-arg is.
  const bespoke = fns.filter((f) => !LOOK_FNS[f.name] && f.name !== "main");
  const sigInfo = {};
  for (const f of bespoke) {
    const params = parseParams(f.paramStr);
    sigInfo[f.name] = {
      params,
      firstOutIdx: params.findIndex((p) => p.isOut),
      needsU: false,
      needsTex: false,
      arrs: new Set(),
    };
  }
  // A fn samples if it calls `texture(uX,…)` on a declared sampler.
  const samplesTex = (body) => samplers.some((s) => new RegExp(`\\btexture\\s*\\(\\s*${s.web}\\b`).test(body));
  // Fixpoint: a fn needs u if it reads a uniform / calls paletteMix / calls a needsU
  // fn; it needs the texture(s)+sampler if it samples or calls a needsTex fn; it
  // needs a buffer ARRAY if it indexes it or calls a fn that needs it.
  const uniformTokens = new Set(Object.values(uniformMap)); // e.g. u.resolution
  let changed = true;
  while (changed) {
    changed = false;
    for (const f of bespoke) {
      const info = sigInfo[f.name];
      const rewritten = rewriteTokens(f.bodyText, { uniformMap });
      const readsUniform = [...uniformTokens].some((t) => rewritten.includes(t));
      const usesPalette = /\bpaletteMix\s*\(/.test(f.bodyText);
      const calls = (pred) => bespoke.some(
        (g) => g.name !== f.name && pred(g.name) && new RegExp(`\\b${g.name}\\s*\\(`).test(f.bodyText),
      );
      if (!info.needsU && (readsUniform || usesPalette || calls((nm) => sigInfo[nm].needsU))) {
        info.needsU = true; changed = true;
      }
      if (!info.needsTex && (samplesTex(f.bodyText) || calls((nm) => sigInfo[nm].needsTex))) {
        info.needsTex = true; changed = true;
      }
      for (const a of bufferArrays) {
        if (info.arrs.has(a.web)) continue;
        if (new RegExp(`\\b${a.web}\\b`).test(f.bodyText) || calls((nm) => sigInfo[nm].arrs.has(a.web))) {
          info.arrs.add(a.web); changed = true;
        }
      }
    }
  }

  // Pass 2: emit each bespoke fn (non-main) with inline + u param + thread& outs.
  const emitFn = (f) => {
    const info = sigInfo[f.name];
    // `vUv` is reconstructed as a LOCAL of the fragment entry (see emitFragment);
    // a helper reading the varying directly is outside the supported subset.
    if (/\bvUv\b/.test(f.bodyText)) {
      throw new Error(`shader: ${f.name}() reads vUv — pass it as a parameter instead`);
    }
    const params = info.params.map((p) => {
      const ty = TYPE_MAP[p.type] ?? p.type;
      return p.isOut ? `thread ${ty} &${p.name}` : `${ty} ${p.name}`;
    });
    if (info.needsU) {
      const at = info.firstOutIdx < 0 ? params.length : info.firstOutIdx;
      params.splice(at, 0, `constant ${Name}Uniforms &u`);
    }
    for (const a of bufferArrays) if (info.arrs.has(a.web)) params.push(`constant ${a.msl} *${a.web}`);
    if (info.needsTex) params.push(...texParams, "sampler texSampler");
    let body = rewriteCalls(rewriteTokens(f.bodyText, { uniformMap }), sigInfo, ctx);
    const ret = TYPE_MAP[f.ret] ?? f.ret;
    return `inline ${ret} ${f.name}(${params.join(", ")}) ${body}`;
  };

  const mainFn = fns.find((f) => f.name === "main");
  if (!mainFn) throw new Error("shader: no main()");
  const fragBody = emitFragment(mainFn, { uniformMap, sigInfo, ctx });

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
  out.push(`    constant ${Name}Uniforms &u [[buffer(0)]]${samplers.length || bufferArrays.length ? "," : ""}`);
  // Per-frame buffer ARRAYS (`binding.arrays`) at their declared fragment
  // [[buffer(idx)]] (0 is the uniforms struct) — the Metal transport of the
  // web/GL `uniform vecN name[…]` arrays.
  bufferArrays.forEach((a, i) => {
    const last = i === bufferArrays.length - 1 && !samplers.length;
    out.push(`    constant ${a.msl} *${a.web} [[buffer(${a.buffer})]]${last ? "" : ","}`);
  });
  // Texture(s) at their declared [[texture(idx)]] (0 reserved for the panel slot) +
  // one shared sampler at [[sampler(0)]].
  samplers.forEach((s, i) => {
    out.push(`    texture2d<float> ${s.name} [[texture(${s.texture})]],`);
    if (i === samplers.length - 1) out.push("    sampler texSampler [[sampler(0)]]");
  });
  out.push(`) ${fragBody}`);
  out.push("");
  return out.join("\n");
}

/** Emit the fragment-entry BODY: y-flip preamble, shadow early-returns, light-out tail. */
function emitFragment(mainFn, { uniformMap, sigInfo, ctx }) {
  let body = rewriteCalls(rewriteTokens(mainFn.bodyText, { uniformMap }), sigInfo, ctx);
  // y-flip: gl_FragCoord.xy reads Metal's top-left [[position]] flipped to y-up.
  body = body.replace(/gl_FragCoord\.xy/g, "float2(in.position.x, u.resolution.y - in.position.y)");
  // The standard fullscreen-triangle varying: at a fragment, the web's `vUv`
  // equals gl_FragCoord.xy / uResolution (y-up). Metal's VSOut carries only
  // [[position]], so reconstruct it as a local at the top of the body.
  if (/\bvUv\b/.test(body)) {
    body = body.replace(
      /^\{/,
      "{\n    float2 vUv = float2(in.position.x, u.resolution.y - in.position.y) / u.resolution;",
    );
  }
  // `fragColor = X; return;` (early outs, e.g. shadow) → `return X;`
  body = body.replace(/fragColor\s*=\s*([^;]+);\s*return\s*;/g, "return $1;");
  // Terminal light-out: the web returns opaque `fragColor = vec4(<rgb>, 1.0)` over a
  // black, `screen`-blended canvas; the self-contained Metal overlay encodes that
  // brightness as PREMULTIPLIED alpha (alpha = the max channel). Two web spellings:
  //   `vec4(max(col, 0.0), 1.0)` → pre-clamp col, then premultiply (aurora/ripple/…);
  //   `vec4(col, 1.0)`           → premultiply directly (fail, which clamps earlier).
  body = body.replace(
    /fragColor\s*=\s*float4\(\s*max\(\s*(\w+)\s*,\s*0\.0\s*\)\s*,\s*1\.0\s*\)\s*;/,
    (_m, v) =>
      `${v} = max(${v}, 0.0);\n` +
      `    float outA = clamp(max(max(${v}.r, ${v}.g), ${v}.b), 0.0, 1.0);\n` +
      `    return float4(${v}, outA);`,
  );
  body = body.replace(
    /fragColor\s*=\s*float4\(\s*(\w+)\s*,\s*1\.0\s*\)\s*;/,
    (_m, v) =>
      `float outA = clamp(max(max(${v}.r, ${v}.g), ${v}.b), 0.0, 1.0);\n` +
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
