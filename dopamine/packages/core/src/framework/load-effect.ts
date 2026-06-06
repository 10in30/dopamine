/**
 * `loadEffect()` — the public, no-code entry point for arbitrary `.dope` effects.
 *
 * A host drops in a `.dope` (a parsed object, a JSON string, or a `.dope` zip),
 * optionally patches it (clamp control ranges, pin a brand palette, swap an
 * outline path), and gets back a registered `EffectFactory` playable via
 * `play()` / `prepare()`. The effect binds to a BUNDLED render program
 * (framework/programs.ts) referenced by the doc's
 * `render.backends.webgl2.shader.program` key — the format carries data + a
 * program key; the runtime owns the GLSL. No new shader/renderer code is needed
 * to ship a recolored / re-iconed / retimed variant of a bundled effect.
 *
 * Overrides are a shallow JSON-pointer-style patch applied to the parsed doc,
 * then the merged doc is RE-VALIDATED (parseDope: magic/version + the
 * standalone guard) so a host can't push the effect into an invalid or
 * non-self-contained state. Swapped outline paths are re-baked to an SDF here so
 * the runtime still only samples.
 */

import { parseDope, type DopeDoc, type DopeOutline } from "./loader.js";
import type { OKLCH } from "../engine/color.js";
import { bakeSdf } from "../engine/sdf.js";
import { getProgram, programNames } from "./programs.js";
import { registerEffect } from "./registry.js";
import { resolveDopeParams } from "./loader.js";
import type { EffectContext, EffectFactory, FeelingInput } from "./effect.js";

/** A control descriptor as it appears in a `.dope` `controls` block. */
interface ControlDesc {
  type?: string;
  min?: number;
  max?: number;
  default?: number | null;
  [k: string]: unknown;
}

/** Host customization patch — all no-code from the host's POV (docs §9.1). */
export interface LoadOverrides {
  /**
   * Clamp/retune a control's range or default, by control name. The loader
   * re-validates that default ∈ [min, max] after merging.
   * e.g. `{ intensity: { max: 0.8, default: 0.6 } }`.
   */
  controls?: Record<string, { min?: number; max?: number; default?: number | null }>;
  /**
   * THEME: replace the generated palette with three explicit OKLCH brand stops
   * (the base-hue rng is still consumed, so per-fire scatter is unchanged), OR
   * pin `seed` to lock the generated palette. `palette` wins over `seed`.
   */
  palette?: [OKLCH, OKLCH, OKLCH];
  /** THEME: pin the seed so the generated palette reproduces every fire. */
  seed?: number;
  /**
   * RESKIN: swap an outline's SVG path by outline name; re-baked to an SDF here.
   * e.g. `{ checkmark: "M5 55 L40 88 L95 8" }`.
   */
  outlines?: Record<string, string>;
}

export interface LoadEffectOptions {
  /** Register the effect under this name (default: the doc's `id`). */
  name?: string;
  /** Host customization patch (§9.1). */
  overrides?: LoadOverrides;
  /** SDF bake resolution for swapped outlines (default 64). */
  sdfSize?: number;
  /** SDF bake distance range in author units for swapped outlines (default 18). */
  sdfRange?: number;
}

/** A loaded, registered effect ready to fire. */
export interface LoadedEffect {
  /** The registered name (use with `play(name, …)`). */
  readonly name: string;
  /** The registered factory. */
  readonly factory: EffectFactory;
  /** The merged, validated `.dope` document. */
  readonly doc: DopeDoc;
}

const REMOTE_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;

/** Apply control range/default overrides, validating default ∈ [min, max]. */
function applyControlOverrides(doc: DopeDoc, overrides: NonNullable<LoadOverrides["controls"]>): void {
  const controls = (doc as { controls?: Record<string, ControlDesc> }).controls;
  if (!controls) throw new Error("dope: cannot override controls — doc has no `controls` block");
  for (const [name, patch] of Object.entries(overrides)) {
    const c = controls[name];
    if (!c) throw new Error(`dope: cannot override unknown control "${name}"`);
    if (patch.min !== undefined) c.min = patch.min;
    if (patch.max !== undefined) c.max = patch.max;
    if (patch.default !== undefined) c.default = patch.default;
    const lo = typeof c.min === "number" ? c.min : -Infinity;
    const hi = typeof c.max === "number" ? c.max : Infinity;
    if (typeof c.min === "number" && typeof c.max === "number" && c.min > c.max) {
      throw new Error(`dope: control "${name}" override has min > max`);
    }
    if (typeof c.default === "number" && (c.default < lo || c.default > hi)) {
      throw new Error(`dope: control "${name}" default ${c.default} out of range [${lo}, ${hi}]`);
    }
  }
}

/** Swap outline svgPaths and re-bake their SDFs (the runtime still only samples). */
function applyOutlineOverrides(
  doc: DopeDoc,
  outlines: NonNullable<LoadOverrides["outlines"]>,
  size: number,
  range: number,
): void {
  const geo = doc.geometry;
  if (!geo?.outlines) throw new Error("dope: cannot swap outline — doc has no `geometry.outlines`");
  const viewBox = geo.viewBox ?? [0, 0, 100, 100];
  for (const [name, svgPath] of Object.entries(outlines)) {
    const o: DopeOutline | undefined = geo.outlines[name];
    if (!o) throw new Error(`dope: cannot swap unknown outline "${name}"`);
    if (REMOTE_RE.test(svgPath) || svgPath.trim().startsWith("/")) {
      throw new Error(`dope: swapped outline path must be a self-contained svgPath, not a ref`);
    }
    o.svgPath = svgPath;
    o.sdf = bakeSdf(svgPath, viewBox, size, range);
    o.source = "baked-sdf";
  }
}

/**
 * Parse + (optionally) patch a `.dope`, bind it to its bundled render program,
 * register it, and return a playable factory. The merged doc is re-validated.
 */
export function loadEffectSync(
  src: string | object,
  opts: LoadEffectOptions = {},
): LoadedEffect {
  // Parse + validate the base doc first (rejects remote/absolute refs).
  let doc = parseDope(src);
  // Deep-clone so overrides never mutate a caller's object (and so re-bakes land
  // on a private copy).
  doc = JSON.parse(JSON.stringify(doc)) as DopeDoc;

  const ov = opts.overrides ?? {};
  if (ov.controls) applyControlOverrides(doc, ov.controls);
  if (ov.outlines) {
    applyOutlineOverrides(doc, ov.outlines, opts.sdfSize ?? 64, opts.sdfRange ?? 18);
  }

  // Re-validate the merged doc (magic/version + standalone guard). A swapped
  // outline that smuggled a remote/absolute ref is rejected here.
  doc = parseDope(doc);

  // Resolve the bundled render program the doc references.
  const backends = (doc.render.backends ?? {}) as Record<string, { shader?: { program?: string } }>;
  const programKey = backends.webgl2?.shader?.program;
  if (!programKey) {
    throw new Error("dope: render.backends.webgl2.shader.program is required for loadEffect");
  }
  const program = getProgram(programKey);
  if (!program) {
    throw new Error(
      `dope: unknown render program "${programKey}". Known: ${programNames().join(", ") || "import the effect that registers it"}`,
    );
  }

  const name = opts.name ?? doc.id;
  const seed = ov.seed;
  const paletteOverride = ov.palette;

  const factory: EffectFactory = {
    name,
    castsShadow: program.castsShadow,
    reducedMotion: program.reducedMotion,
    resolve(feeling: FeelingInput) {
      // A pinned override seed wins over the per-fire seed (locks the palette).
      const f = { ...feeling, seed: seed ?? feeling.seed };
      const numeric = resolveDopeParams(doc, f, program.consts, program.scatterKey, paletteOverride);
      return program.composeParams
        ? program.composeParams(numeric as Record<string, unknown>, f)
        : numeric;
    },
    create(params, ctx: EffectContext) {
      return program.create(params as Record<string, unknown>, ctx);
    },
  };

  registerEffect(factory);
  return { name, factory, doc };
}

/**
 * Public async `loadEffect`. Accepts a parsed doc, a JSON string, or a `.dope`
 * zip (Uint8Array/ArrayBuffer/Blob). Resolves to the registered, playable effect.
 */
export async function loadEffect(
  src: string | object | Uint8Array | ArrayBuffer | Blob,
  opts: LoadEffectOptions = {},
): Promise<LoadedEffect> {
  if (src instanceof Blob) src = new Uint8Array(await src.arrayBuffer());
  if (src instanceof ArrayBuffer) src = new Uint8Array(src);
  if (src instanceof Uint8Array) {
    const { readDopeZip } = await import("./dope-zip.js");
    const json = await readDopeZip(src);
    return loadEffectSync(json, opts);
  }
  return loadEffectSync(src, opts);
}
