/**
 * Generic DATA-DRIVEN pass factory — instantiates a pure-shader effect from
 * `(dope, shader, hooks)` with no per-effect factory code.
 *
 * For a datafied effect the `.dope` carries everything the hand-written
 * per-effect `PassConfig` used to: the per-frame logic (`tempo.frame`), the
 * shadow height (`render.shadowHeightFrac`), the per-pass uniforms
 * (`render.pass`), the SDF-sourced samplers (`binding.samplers[].outline`),
 * the loop-cap consts (`render.consts`), the runner config
 * (`render.config.usesOrigin`), the reduced-motion peak/hold
 * (`tempo.reducedMotion`) and the uniform-binding contract (`binding`). This
 * module derives the `PassConfig` from that data — uniform names by the same
 * `name → u<Name>` convention `computeScalarBinds` applies, exceptions from
 * the binding contract — so the only hand-written web source left for such an
 * effect is its GLSL.
 *
 * The honest boundary stays honest: anything genuinely code-shaped (a sprite
 * panel, frame arrays, a host-rasterized aux texture) is passed through
 * `hooks`, the same seams `PassConfig` always had — and a hook overrides the
 * derived `auxTextures`/`passUniforms` when both exist.
 */

import { decodeSdf } from "../engine/sdf.js";
import { evalFrameExpr, evalParamExpr, evalPassExpr, type FrameExprNode } from "./frame-expr.js";
import { getOutline, resolveDopeParams, type DopeDoc, type DopeSampler } from "./loader.js";
import { cap } from "./pass-common.js";
import {
  createPassInstance,
  type AuxTextureSpec,
  type FrameInfo,
  type PassConfig,
  type PassParams,
} from "./pass-runner.js";
import { registerEffect } from "./registry.js";
import { registerProgram, type RenderProgram } from "./programs.js";
import type { EffectContext, EffectFactory, EffectInstance, FeelingInput } from "./effect.js";

/** The code-shaped escape hatches a datafied effect may still need. */
export type DopePassHooks = Partial<
  Pick<PassConfig, "auxTextures" | "passUniforms" | "panel" | "frameArrays">
> & {
  /** Additional uniform names (beyond the derived set) the shader reads. */
  extraUniforms?: readonly string[];
};

/** The vertex + fragment GLSL pair (the per-effect look — code by design). */
export interface DopeShader {
  vertex: string;
  fragment: string;
}

/**
 * Derive a {@link PassConfig} from a datafied `.dope` + its shader (+ optional
 * code hooks). The derived contract is pinned by the per-effect dope-config
 * vitests:
 *
 *   - `uniforms`: every `render.params` key not in `binding.excludeParams` and
 *     not the scatter key → `u<Name>`; the scatter key contributes
 *     `binding.scatterWeb` when present (else it is not a shader uniform); every
 *     `binding.extras[].web`; every `binding.samplers[].web`; every
 *     `binding.arrays[].web` (the `frameArrays` uniform arrays); plus
 *     `hooks.extraUniforms`.
 *   - `bindings`: the scatter key → `scatterWeb` (or `null`), plus `null` for
 *     each excluded param that would otherwise auto-bind. (`style` and
 *     `durationMs` need no entry: `durationMs` is skipped by
 *     `computeScalarBinds`, and `style`'s conventional `uStyle` auto-bind is the
 *     same value the runner already sets as a standard uniform.)
 *   - `frame`: `tempo.frame.amp` + `tempo.frame.extras` evaluated per frame
 *     (extras keyed by canonical name, emitted under their `binding` web name).
 *   - `shadowHeightFrac`: `render.shadowHeightFrac` (bare number passes
 *     through; an expression is params-only — `{input}` throws).
 *   - `passUniforms`: `render.pass` evaluated ONCE PER PASS (canonical names →
 *     `binding` web names) over the resolved params + the pass-geometry inputs
 *     (`targetMinDimPx`, plus `sdfRange`/`sdfViewBoxW` from the first sampler
 *     with an `outline` source).
 *   - `auxTextures`: every `binding.samplers` entry with an `outline` whose
 *     baked SDF decodes → a `kind:"sdf"` spec at its `texture` unit, flipping
 *     its `on` extra to 1; absent/undecodable → analytic fallback.
 *   - `usesOrigin`: `render.config.usesOrigin`.
 */
export function dopePassConfig(doc: DopeDoc, shader: DopeShader, hooks: DopePassHooks = {}): PassConfig {
  const binding = doc.binding ?? {};
  const exclude = binding.excludeParams ?? [];
  const scatterKey = binding.scatterKey ?? undefined;
  const extraDefs = binding.extras ?? [];

  const frameSpec = doc.tempo.frame;
  if (!frameSpec) throw new Error(`dope: ${doc.id} has no tempo.frame (not a datafied effect)`);
  const loopPeriodMs = doc.tempo.loop?.periodMs;
  const shadowSpec = doc.render.shadowHeightFrac;
  if (shadowSpec === undefined) {
    throw new Error(`dope: ${doc.id} has no render.shadowHeightFrac (not a datafied effect)`);
  }

  // --- uniforms ------------------------------------------------------------
  const uniforms = new Set<string>();
  for (const name of Object.keys(doc.render.params)) {
    if (exclude.includes(name) || name === scatterKey) continue;
    uniforms.add(cap(name));
  }
  if (scatterKey && binding.scatterWeb) uniforms.add(binding.scatterWeb);
  for (const e of extraDefs) if (e.web) uniforms.add(e.web);
  for (const s of binding.samplers ?? []) uniforms.add(typeof s === "string" ? s : s.web);
  for (const a of binding.arrays ?? []) uniforms.add(a.web);
  for (const u of hooks.extraUniforms ?? []) uniforms.add(u);

  // --- bindings (exceptions to the `name → u<Name>` auto-bind) --------------
  const bindings: Record<string, string | null> = {};
  if (scatterKey) bindings[scatterKey] = binding.scatterWeb ?? null;
  for (const name of exclude) {
    if (name === "style" || name === "durationMs") continue; // see doc comment
    bindings[name] = null;
  }

  // --- per-frame extras: canonical name → web uniform name ------------------
  const extraExprs: Array<[string, FrameExprNode]> = Object.entries(frameSpec.extras ?? {}).map(
    ([name, expr]) => {
      const def = extraDefs.find((e) => e.name === name);
      if (!def?.web) {
        throw new Error(`dope: ${doc.id} tempo.frame.extras."${name}" has no binding.extras web name`);
      }
      return [def.web, expr];
    },
  );

  // --- per-PASS uniforms (`render.pass`): canonical name → web uniform name --
  // (a "note" key is documentation, not an expression — same convention as
  // `binding.note`.)
  const passExprs: Array<[string, FrameExprNode]> = Object.entries(doc.render.pass ?? {})
    .filter(([name]) => name !== "note")
    .map(([name, expr]) => {
      const def = extraDefs.find((e) => e.name === name);
      if (!def?.web) {
        throw new Error(`dope: ${doc.id} render.pass."${name}" has no binding.extras web name`);
      }
      return [def.web, expr] as [string, FrameExprNode];
    });

  // SDF-sourced samplers: the first `outline` sampler supplies the pass-expr
  // SDF inputs (declared metadata — readable even where the bitmap isn't bound).
  const samplerDefs = (binding.samplers ?? []).filter((s): s is DopeSampler => typeof s !== "string");
  const sdfOutline = samplerDefs.find((s) => s.outline);
  const sdfSrc = sdfOutline ? getOutline(doc, sdfOutline.outline!)?.sdf : undefined;
  const sdfInputs = { range: sdfSrc?.range ?? 0, viewBoxW: sdfSrc?.viewBox?.[2] ?? 0 };

  const derivedPassUniforms: PassConfig["passUniforms"] | undefined = passExprs.length
    ? (_canvas, params, targetPx) => {
        const pass = {
          targetMinDimPx: Math.min(targetPx.width, targetPx.height),
          sdfRange: sdfInputs.range,
          sdfViewBoxW: sdfInputs.viewBoxW,
        };
        const out: Record<string, number> = {};
        for (const [web, expr] of passExprs) out[web] = evalPassExpr(expr, params, pass);
        return out;
      }
    : undefined;

  // Declarative aux textures: each sampler with an `outline` whose baked SDF
  // decodes becomes a kind:"sdf" spec (its `on` extra flips to 1 when bound);
  // an absent/undecodable SDF contributes nothing — the analytic fallback.
  const sdfAux: AuxTextureSpec[] = [];
  for (const s of samplerDefs) {
    if (!s.outline) continue;
    const baked = getOutline(doc, s.outline)?.sdf;
    if (!baked) continue;
    try {
      const onDef = s.on ? extraDefs.find((e) => e.name === s.on) : undefined;
      sdfAux.push({
        kind: "sdf",
        unit: s.texture ?? 0,
        sdf: decodeSdf(baked),
        sampler: s.web,
        onUniform: onDef?.web,
      });
    } catch {
      /* undecodable → analytic fallback */
    }
  }
  const derivedAux: PassConfig["auxTextures"] | undefined = sdfAux.length ? () => sdfAux : undefined;

  return {
    vertex: shader.vertex,
    fragment: shader.fragment,
    uniforms: [...uniforms],
    usesOrigin: doc.render.config?.usesOrigin ?? false,
    loopPeriodMs,
    bindings,
    shadowHeightFrac:
      typeof shadowSpec === "number" ? shadowSpec : (params) => evalParamExpr(shadowSpec, params),
    frame(info: FrameInfo, params: PassParams) {
      // Loop clocks (0 without tempo.loop) — the SAME formula the runner uses
      // for uLoopS/uPhase, so a `{input:"phase"}` amp matches the shader.
      const loopMs = loopPeriodMs ? info.animMs % loopPeriodMs : 0;
      const ctx = {
        animMs: info.animMs,
        life: info.life,
        elapsedMs: info.elapsedMs,
        params,
        loopS: loopMs / 1000,
        phase: loopPeriodMs ? loopMs / loopPeriodMs : 0,
      };
      const out: { amp: number } & Record<string, number> = {
        amp: evalFrameExpr(frameSpec.amp, ctx),
      };
      for (const [web, expr] of extraExprs) out[web] = evalFrameExpr(expr, ctx);
      return out;
    },
    auxTextures: hooks.auxTextures ?? derivedAux,
    passUniforms: hooks.passUniforms ?? derivedPassUniforms,
    panel: hooks.panel,
    frameArrays: hooks.frameArrays,
  };
}

/** Options for {@link registerDopeEffect}. */
export interface RegisterDopeEffectOptions {
  /** Code-shaped escape hatches forwarded to {@link dopePassConfig}. */
  hooks?: DopePassHooks;
  /**
   * The registered effect/program name. Defaults to the last segment of
   * `doc.id` (e.g. `dopamine.success.aurora` → `aurora`); pass explicitly when
   * the public name differs (e.g. `dopamine.success.verdict` → `inkstroke`).
   */
  name?: string;
  /** Also register as a bundled program for `loadEffect()`. Default true. */
  program?: boolean;
  /** Override `tempo.reducedMotion`. */
  reducedMotion?: { peakMs?: number; holdMs?: number };
  /** Compose non-numeric, code-shaped params on top of the loader bag. */
  composeParams?: RenderProgram["composeParams"];
}

/**
 * Build + register a fully data-driven effect from `(dope, shader, hooks)`:
 * `resolve` is the `.dope` loader (with `render.consts` and the binding's
 * scatter key), `create` is the generic pass runner over the derived config,
 * and `reducedMotion` comes from `tempo.reducedMotion`. Registers the
 * `EffectFactory` (and, by default, a bundled program under the same name) and
 * returns the factory — the whole per-effect web factory, datafied.
 */
export function registerDopeEffect(
  doc: DopeDoc,
  shader: DopeShader,
  opts: RegisterDopeEffectOptions = {},
): EffectFactory<PassParams> {
  const scatterKey = doc.binding?.scatterKey;
  if (!scatterKey) throw new Error(`dope: ${doc.id} has no binding.scatterKey`);
  const consts = doc.render.consts ?? {};
  const name = opts.name ?? doc.id.split(".").pop()!;
  const reducedMotion = opts.reducedMotion ?? doc.tempo.reducedMotion;
  const config = dopePassConfig(doc, shader, opts.hooks);
  const create = (params: PassParams, ctx: EffectContext): EffectInstance =>
    createPassInstance(config, params, ctx);

  const factory: EffectFactory<PassParams> = {
    name,
    resolve: (feeling: FeelingInput) =>
      resolveDopeParams(doc, feeling, consts, scatterKey) as unknown as PassParams,
    create,
    reducedMotion,
    // The continuous-loop contract: the conductor re-arms at durationMs instead
    // of tearing down (the host stops it via the returned handle).
    loop: doc.tempo.loop ? { periodMs: doc.tempo.loop.periodMs } : undefined,
  };

  if (opts.program !== false) {
    // Expose as a bundled program so loadEffect() can bind host-authored
    // variants of this effect's .dope with no code.
    registerProgram<PassParams>(name, {
      create,
      scatterKey,
      consts,
      reducedMotion,
      ...(opts.composeParams ? { composeParams: opts.composeParams } : {}),
    });
  }
  return registerEffect(factory);
}
