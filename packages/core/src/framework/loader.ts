/**
 * `.dope` effect loader.
 *
 * Parses a `.dope` JSON document (per docs/effect-format.md) and evaluates its
 * `controls → render.params` mapping grammar, the OKLCH golden-angle palette,
 * and the per-mood baseline table into the SAME flat render-param bag the engine
 * consumes. Shader bodies stay referenced GLSL (the format references them); the
 * loader is NOT a GLSL transpiler.
 *
 * The single load-bearing invariant (the correctness anchor): the PRNG is
 * consumed in the SAME order as the legacy `resolve*Params` — `buildPalette`
 * draws the base hue first (one `rng()` inside it), then the per-fire scatter
 * (`rng() * 1000`). So a pinned seed reproduces the legacy output byte-for-byte;
 * a vitest asserts this across a mood × intensity × whimsy × seed grid.
 *
 * The grammar is intentionally tiny + non-Turing-complete (no loops, no user
 * functions) so it is safe to evaluate from an untrusted file and trivial to
 * port to Swift for the Metal backend.
 */

import { buildPalette, oklchToLinearSrgb, type OKLCH, type RGB } from "../engine/color.js";
import { mulberry32, type Rng } from "../engine/seed.js";
import { NPR_TIME_STEP_MS } from "../engine/tempo.js";
import type { BakedSdf } from "../engine/sdf.js";
import type { FrameExprNode } from "./frame-expr.js";

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * clamp01(t);

/**
 * The per-frame logic spec (`tempo.frame`): the datafied form of an effect's
 * hand-written `frame()` hook. `amp` feeds shadowGeometry; `extras` are keyed by
 * the CANONICAL extra name (matching `binding.extras[].name`) and map to each
 * platform's uniform via the binding contract.
 */
export interface DopeFrameSpec {
  amp: FrameExprNode;
  extras?: Record<string, FrameExprNode>;
}

/**
 * The continuous-loop contract (`tempo.loop`): the effect repeats seamlessly
 * with period `periodMs`. `parseDope` validates the two seam invariants that
 * used to be per-effect convention: the period tiles the "animate on twos"
 * grid (unless `snapAligned` is false) and every baseline `durationMs` is a
 * whole number of periods — so the frame at `t == durationMs` matches `t == 0`
 * at every whimsy. Runners surface the standard periodic clock uniforms
 * `uLoopS` / `uPhase` (and the `loopS` / `phase` frame-expr inputs) from it,
 * and conductors re-arm at `durationMs` instead of tearing down.
 */
export interface DopeLoopSpec {
  /** The seamless loop period, ms. */
  periodMs: number;
  /**
   * Whether `periodMs` must be a whole number of `NPR_TIME_STEP_MS` steps so
   * the "animate on twos" snapped clock is also periodic. Default true.
   */
  snapAligned?: boolean;
}

/**
 * The cross-platform uniform-binding contract. SHIPS in the portable doc: the
 * runtime derives which resolved params bind to which shader uniforms from it
 * (and the toolchain consumes it for the Metal struct codegen).
 */
export interface DopeBinding {
  note?: string;
  /** `render.params` (or resolved-bag) names that are NOT shader uniforms. */
  excludeParams?: string[];
  /** The per-fire seed-keyed scatter field (auroraSeed / inkSeed / …). */
  scatterKey?: string | null;
  /** The web uniform the scatter binds to (absent = not a shader uniform). */
  scatterWeb?: string;
  /** Per-frame/host extras (filled by `tempo.frame.extras` or host hooks). */
  extras?: Array<{ name: string; type?: string; web?: string; note?: string }>;
  /** Texture samplers the shader reads. */
  samplers?: Array<string | { web: string; name?: string; texture?: number }>;
}

/** A `.dope` document (the parts the loader consumes — others are ignored). */
export interface DopeDoc {
  fmt: string;
  v: string;
  id: string;
  meta?: { name?: string; description?: string; tags?: string[] };
  palette: DopePalette;
  tempo: {
    durationMs?: DopeParamSpec;
    /** Continuous-loop contract (seamless period); see {@link DopeLoopSpec}. */
    loop?: DopeLoopSpec;
    /** Per-frame logic (amp + extras) as frame-expression trees. */
    frame?: DopeFrameSpec;
    /** Reduced-motion peak/hold the factories used to hardcode. */
    reducedMotion?: { peakMs?: number; holdMs?: number };
  };
  render: {
    params: Record<string, DopeParamSpec>;
    /** Shadow occluder height: a params-only frame expression (or a bare number). */
    shadowHeightFrac?: FrameExprNode;
    /** Loop-cap consts the param mapping's clampMax/clampMin reference. */
    consts?: Record<string, number>;
    /** Runner config (today: whether the shader reads `uOrigin`). */
    config?: { usesOrigin?: boolean };
    backends?: unknown;
    fallbackOrder?: string[];
  };
  /** The uniform-binding contract (see {@link DopeBinding}). */
  binding?: DopeBinding;
  /** Per-mood baseline table (color + non-color baselines), keyed by mood name. */
  baselines: Record<string, Record<string, number>>;
  /** Outline geometry — icon paths + (after the pack/bake step) baked SDFs. */
  geometry?: DopeGeometry;
  /** Free-form per-effect content (word sets, tokens) consumed by renderers. */
  content?: Record<string, unknown>;
  /** Typography tables (mood→face + whimsy/intensity curves) for letter effects. */
  typography?: Record<string, unknown>;
}

/** An outline entry: an authored `svgPath` and/or its baked SDF + a role tag. */
export interface DopeOutline {
  role?: string;
  source?: string;
  svgPath?: string;
  /** Inline baked signed-distance field (a `data:` URI blob); see engine/sdf.ts. */
  sdf?: BakedSdf;
  note?: string;
}

export interface DopeGeometry {
  kind?: string;
  viewBox?: [number, number, number, number];
  outlines?: Record<string, DopeOutline>;
}

/** Read a named outline from a doc's geometry, or undefined. */
export function getOutline(doc: DopeDoc, name: string): DopeOutline | undefined {
  return doc.geometry?.outlines?.[name];
}

/**
 * The mood a doc degrades to when asked for one it doesn't declare.
 *
 * Each effect declares its OWN moods (the success trio declares
 * serene/celebratory/electric; the fail effect declares try-again/error/denied),
 * so there is no single hardcoded fallback mood that exists for every effect.
 * An effect's own default is, in order of preference:
 *   1. its `controls.mood.default`, if that mood actually has a baseline, else
 *   2. the first mood key in its `baselines` table.
 * This keeps EVERY declared mood resolvable and makes an unknown mood degrade to
 * the effect's own sensible default instead of throwing on a missing baseline.
 */
export function defaultMoodKey(doc: DopeDoc): string {
  const controls = (doc as { controls?: { mood?: { default?: unknown } } }).controls;
  const declared = controls?.mood?.default;
  if (typeof declared === "string" && doc.baselines[declared]) return declared;
  const first = Object.keys(doc.baselines)[0];
  if (!first) throw new Error("dope: document has no baselines to resolve a mood against");
  return first;
}

/**
 * Resolve a requested mood name against a doc to a key the doc actually declares:
 * the requested mood if it has a baseline, otherwise the doc's own default mood
 * ({@link defaultMoodKey}). Returned key is used for BOTH the baseline table and
 * the palette `perMood` register, so they always agree.
 */
function resolveMoodKey(doc: DopeDoc, mood: string): string {
  return doc.baselines[mood] ? mood : defaultMoodKey(doc);
}

interface DopePalette {
  hueSpread: number;
  lightness: { baseline: string; perStop: [number, number, number] };
  chroma: { from: ExprNode; perStop: [number, number, number] };
  /** Color register fields per mood: hueCenter, hueRange, lightness, chroma. */
  perMood: Record<string, { hueCenter: number; hueRange: number; lightness: number; chroma: number }>;
}

interface DopeParamSpec {
  type?: "float" | "int";
  from: ExprNode;
  clamp01?: boolean;
  clampMax?: string;
  clampMin?: string;
}

/** The mapping mini-grammar (§4.1) — an expression tree. */
export type ExprNode =
  | number
  | { const: number }
  | { control: string }
  | { baseline: string }
  | { lerp: [string, number, number] }
  | { mul: ExprNode[] }
  | { add: ExprNode[] }
  | { sub: ExprNode[] }
  | { round: ExprNode }
  | { floor: ExprNode }
  // Extensions (§10: nodes may grow without a major bump as long as old nodes
  // keep their meaning). Used by the typography tables (Phase 3) so curves whose
  // endpoints are themselves expressions stay declarative.
  | { mix: [ExprNode, ExprNode, string] } // a + (b-a)*clamp01(control)
  | { max: ExprNode[] }
  | { min: ExprNode[] };

/** Evaluation context for the grammar. */
export interface EvalCtx {
  controls: Record<string, number>;
  baseline: Record<string, number>;
  consts: Record<string, number>;
}

/** Evaluate a grammar node to a number. Pure; matches mood.ts arithmetic. */
export function evalExpr(node: ExprNode, ctx: EvalCtx): number {
  if (typeof node === "number") return node;
  if ("const" in node) return node.const;
  if ("control" in node) return clamp01(ctx.controls[node.control] ?? 0);
  if ("baseline" in node) {
    const v = ctx.baseline[node.baseline];
    if (v === undefined) throw new Error(`dope: unknown baseline "${node.baseline}"`);
    return v;
  }
  if ("lerp" in node) {
    const [c, a, b] = node.lerp;
    return lerp(a, b, ctx.controls[c] ?? 0);
  }
  if ("mul" in node) return node.mul.reduce((p: number, n) => p * evalExpr(n, ctx), 1);
  if ("add" in node) return node.add.reduce((p: number, n) => p + evalExpr(n, ctx), 0);
  if ("sub" in node) {
    const parts: number[] = node.sub.map((n) => evalExpr(n, ctx));
    return parts.slice(1).reduce((p: number, n: number) => p - n, parts[0] ?? 0);
  }
  if ("round" in node) return Math.round(evalExpr(node.round, ctx));
  if ("floor" in node) return Math.floor(evalExpr(node.floor, ctx));
  if ("mix" in node) {
    const [a, b, c] = node.mix;
    const va = evalExpr(a, ctx);
    const vb = evalExpr(b, ctx);
    return va + (vb - va) * clamp01(ctx.controls[c] ?? 0);
  }
  if ("max" in node) return Math.max(...node.max.map((n) => evalExpr(n, ctx)));
  if ("min" in node) return Math.min(...node.min.map((n) => evalExpr(n, ctx)));
  throw new Error(`dope: unknown expr node ${JSON.stringify(node)}`);
}

/** Apply a param spec's post-clamp flags. */
function applyFlags(v: number, spec: DopeParamSpec, consts: Record<string, number>): number {
  if (spec.clamp01) v = clamp01(v);
  if (spec.clampMax) v = Math.min(v, consts[spec.clampMax] ?? Infinity);
  if (spec.clampMin) v = Math.max(v, consts[spec.clampMin] ?? -Infinity);
  return v;
}

export interface DopeResolveInput {
  mood: string;
  intensity: number;
  whimsy: number;
  seed: number;
}

/**
 * Resolve a `.dope` doc + a feeling into the flat render-param bag (palette,
 * style, durationMs, seed, scatter seed, and every `render.params` entry). The
 * `scatterKey` is the name the legacy code gave the per-fire scatter offset
 * (`moteSeed` / `inkSeed` / `comicSeed`) so the output keys match exactly.
 *
 * RNG order (the parity anchor): baseHue via buildPalette FIRST, then the
 * scatter `rng()*1000` — identical to `resolve*Params`.
 */
export function resolveDopeParams(
  doc: DopeDoc,
  input: DopeResolveInput,
  consts: Record<string, number>,
  scatterKey: string,
  /**
   * Host theme override: three explicit OKLCH stops that REPLACE the generated
   * golden-angle palette (a pinned brand palette). The base-hue rng() is still
   * consumed first, so the per-fire scatter offset stays identical to the
   * generated path — pinning the palette never shifts the mote/spray layout.
   */
  paletteOverride?: [OKLCH, OKLCH, OKLCH],
): Record<string, number | RGB[] | number[]> {
  const i = clamp01(input.intensity);
  const w = clamp01(input.whimsy);
  // Degrade an undeclared mood to THIS effect's own default mood (not a hardcoded
  // "celebratory", which the fail effect — and any non-success effect — has no
  // baseline for). Declared moods always resolve to themselves, so parity holds.
  const moodKey = resolveMoodKey(doc, input.mood);
  const baseline = doc.baselines[moodKey];
  const rng: Rng = mulberry32(input.seed);

  const ctx: EvalCtx = {
    controls: { intensity: i, whimsy: w },
    baseline,
    consts,
  };

  const out: Record<string, number | RGB[] | number[]> = {
    seed: input.seed,
    style: w,
  };

  // durationMs (tempo)
  if (doc.tempo.durationMs) {
    out.durationMs = applyFlags(evalExpr(doc.tempo.durationMs.from, ctx), doc.tempo.durationMs, consts);
  }

  // render.params
  for (const [name, spec] of Object.entries(doc.render.params)) {
    if (name === "style") continue; // style is the raw whimsy control, set above
    out[name] = applyFlags(evalExpr(spec.from, ctx), spec, consts);
  }

  // Palette FIRST (consumes one rng() for the base hue inside buildPalette),
  // matching the engine's call order exactly.
  // Same resolved key as the baseline lookup, so palette + baselines always agree
  // (an undeclared mood uses the effect's own default for both).
  const reg = doc.palette.perMood[moodKey] ?? doc.palette.perMood[defaultMoodKey(doc)];
  const chroma = evalExpr(doc.palette.chroma.from, { ...ctx, baseline: reg as Record<string, number> });
  const generated = buildPalette(rng, {
    lightness: reg.lightness,
    chroma,
    hueCenter: reg.hueCenter,
    hueRange: reg.hueRange,
    hueSpread: doc.palette.hueSpread,
  }) as RGB[];
  // A host palette override REPLACES the generated stops (the base-hue rng() above
  // was still consumed, so scatter parity holds), pinning a brand palette.
  out.palette = paletteOverride ? (paletteOverride.map(oklchToLinearSrgb) as RGB[]) : generated;

  // THEN the per-fire scatter offset (same rng() * 1000 as the engine).
  out[scatterKey] = rng() * 1000;

  return out;
}

// A `.dope` must be SELF-CONTAINED — it may inline assets (e.g. `data:` URIs) or
// reference bundled programs/assets by key or by a path RELATIVE to the package
// (resolved inside a `.dope` zip), but it must never point at the network or an
// absolute filesystem path. This keeps every effect portable and offline.
const REMOTE_REF_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i; // http(s)://, ftp://, //host
const ABS_PATH_RE = /^(?:\/|[A-Za-z]:[\\/])/; // /etc/..., C:\...

function assertStandalone(node: unknown, path = "$"): void {
  if (typeof node === "string") {
    if (REMOTE_REF_RE.test(node) || ABS_PATH_RE.test(node)) {
      throw new Error(
        `dope: external asset reference is not allowed — a .dope must be ` +
          `self-contained (inline or bundle assets). Offending value at ${path}: "${node}"`,
      );
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => assertStandalone(v, `${path}[${i}]`));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) assertStandalone(v, `${path}.${k}`);
  }
}

// Tolerance for the loop whole-multiple checks (the step 1000/12 is not exactly
// representable, so an exact `% === 0` would be float-fragile).
const LOOP_EPS = 1e-6;
const isWhole = (x: number): boolean => Math.abs(x - Math.round(x)) < LOOP_EPS;

/**
 * Validate a `tempo.loop` block against the doc's baselines: the period must be
 * positive, must tile the "animate on twos" grid (unless `snapAligned` is
 * false), and every per-mood baseline `durationMs` must be a whole number of
 * periods — the seam guarantee, moved from per-effect convention into the
 * parser (identical on every platform).
 */
function assertValidLoop(loop: DopeLoopSpec, baselines: DopeDoc["baselines"]): void {
  const p = loop.periodMs;
  if (typeof p !== "number" || !Number.isFinite(p) || p <= 0) {
    throw new Error(`dope: tempo.loop.periodMs must be a positive number (got ${JSON.stringify(p)})`);
  }
  if (loop.snapAligned !== false && !isWhole(p / NPR_TIME_STEP_MS)) {
    throw new Error(
      `dope: tempo.loop.periodMs (${p}) is not a whole number of animate-on-twos steps (1000/12 ms)`,
    );
  }
  for (const [mood, row] of Object.entries(baselines)) {
    const d = row.durationMs;
    if (d !== undefined && !isWhole(d / p)) {
      throw new Error(
        `dope: baselines.${mood}.durationMs (${d}) is not a whole number of tempo.loop periods (${p} ms)`,
      );
    }
  }
}

/**
 * Parse + validate a `.dope` document from a JSON string or already-parsed
 * object. Rejects a wrong/absent magic or major version, any external
 * (remote / absolute-path) asset reference — a `.dope` must be self-contained —
 * and a `tempo.loop` that breaks the seam invariants.
 * (A fuller JSON-Schema validation lives in CI against effect-format.schema.json.)
 */
export function parseDope(src: string | object): DopeDoc {
  const doc = (typeof src === "string" ? JSON.parse(src) : src) as DopeDoc;
  if (doc.fmt !== "dopamine-effect") {
    throw new Error(`dope: not a Dopamine effect document (fmt="${(doc as DopeDoc).fmt}")`);
  }
  const major = Number(doc.v?.split(".")[0]);
  if (!Number.isFinite(major) || major > 1) {
    throw new Error(`dope: unsupported format version "${doc.v}"`);
  }
  if (!doc.render?.params || !doc.palette?.perMood || !doc.baselines) {
    throw new Error("dope: document missing render.params / palette.perMood / baselines");
  }
  if (doc.tempo?.loop) assertValidLoop(doc.tempo.loop, doc.baselines);
  assertStandalone(doc);
  return doc;
}
