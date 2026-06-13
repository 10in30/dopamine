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
import { createPanelInstance, type PanelConfig, type PanelDraw } from "./panel-runner.js";
import { registerEffect } from "./registry.js";
import { registerProgram, type RenderProgram } from "./programs.js";
import type { EffectContext, EffectFactory, EffectInstance, FeelingInput } from "./effect.js";

/** The code-shaped escape hatches a datafied effect may still need. */
export type DopePassHooks = Partial<
  Pick<PassConfig, "auxTextures" | "passUniforms" | "panel" | "frameArrays">
> & {
  /** Additional uniform names (beyond the derived set) the shader reads. */
  extraUniforms?: readonly string[];
  /**
   * The Canvas2D draw for a PASS effect's dynamic sprite panel (`render.panel`
   * with the doc still pass-shaped — e.g. solarbloom's motes). The `.dope`
   * `render.panel` block supplies the unit + sampler; this hook supplies only
   * the genuinely code-shaped draw. Ignored when `hooks.panel` is given whole.
   */
  panelDraw?: NonNullable<PassConfig["panel"]>["draw"];
};

/** The vertex + fragment GLSL pair (the per-effect look — code by design). */
export interface DopeShader {
  vertex: string;
  fragment: string;
}

/**
 * The shared pass/panel derivation over a datafied `.dope`: the uniform list,
 * the binding exceptions, the per-frame and per-pass expression tables and the
 * declared SDF pass inputs — everything both `dopePassConfig` and
 * `dopePanelConfig` read identically (the rules in the {@link dopePassConfig}
 * doc comment).
 */
function deriveDope(doc: DopeDoc, extraUniforms?: readonly string[]) {
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
  for (const u of extraUniforms ?? []) uniforms.add(u);

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

  return { binding, frameSpec, loopPeriodMs, shadowSpec, uniforms, bindings, extraExprs, passExprs, sdfInputs };
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
  const { binding, frameSpec, loopPeriodMs, shadowSpec, uniforms, bindings, extraExprs, passExprs, sdfInputs } =
    deriveDope(doc, hooks.extraUniforms);

  const derivedPassUniforms: PassConfig["passUniforms"] | undefined = passExprs.length
    ? (_canvas, params, targetPx, dpr) => {
        const pass = {
          targetMinDimPx: Math.min(targetPx.width, targetPx.height),
          sdfRange: sdfInputs.range,
          sdfViewBoxW: sdfInputs.viewBoxW,
          dpr,
        };
        const out: Record<string, number> = {};
        for (const [web, expr] of passExprs) out[web] = evalPassExpr(expr, params, pass);
        return out;
      }
    : undefined;

  // The declarative dynamic-panel WIRING (`render.panel`): the unit + sampler
  // are data; the Canvas2D draw is the code-shaped hook. (A whole `hooks.panel`
  // still overrides, like the other hooks.)
  const panelSpec = doc.render.panel;
  const derivedPanel: PassConfig["panel"] | undefined =
    panelSpec && hooks.panelDraw
      ? { unit: panelSpec.texture ?? 0, sampler: panelSpec.sampler, draw: hooks.panelDraw }
      : undefined;

  // Declarative aux textures: each sampler with an `outline` whose baked SDF
  // decodes becomes a kind:"sdf" spec (its `on` extra flips to 1 when bound);
  // an absent/undecodable SDF contributes nothing — the analytic fallback.
  const extraDefs = binding.extras ?? [];
  const samplerDefs = (binding.samplers ?? []).filter((s): s is DopeSampler => typeof s !== "string");
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
    panel: hooks.panel ?? derivedPanel,
    frameArrays: hooks.frameArrays,
  };
}

/**
 * Derive a {@link PanelConfig} (the Canvas2D-panel runner's config) from a
 * datafied PANEL `.dope` + its shader + the one genuinely code-shaped piece —
 * the per-frame Canvas2D `draw`. The derivation rules are the SAME as
 * {@link dopePassConfig} (uniforms / bindings / `tempo.frame` /
 * `render.shadowHeightFrac` / `render.pass`), with the panel runner's shape:
 *
 *   - `panelSampler`: `render.panel.sampler` (required; `render.panel.texture`
 *     must be 0 — the panel runner binds the panel at TEXTURE0, the
 *     cross-platform panel slot).
 *   - `frame`: evaluated with `animMs := elapsedMs` — the panel runner never
 *     snaps "on twos" (declared as `render.config.stepping: "none"`).
 *   - `passUniforms`: `render.pass` over the resolved params + the pass inputs
 *     (`targetMinDimPx` from the targeted element box, `dpr`, and the SDF
 *     metadata when a sampler declares an outline).
 */
export function dopePanelConfig(
  doc: DopeDoc,
  shader: DopeShader,
  draw: PanelDraw,
  hooks: Pick<DopePassHooks, "extraUniforms"> = {},
): PanelConfig {
  const { frameSpec, shadowSpec, uniforms, bindings, extraExprs, passExprs, sdfInputs } = deriveDope(
    doc,
    hooks.extraUniforms,
  );
  const panelSpec = doc.render.panel;
  if (!panelSpec) throw new Error(`dope: ${doc.id} has no render.panel (not a panel effect)`);
  if ((panelSpec.texture ?? 0) !== 0) {
    throw new Error(
      `dope: ${doc.id} render.panel.texture must be 0 for a panel-kind effect (TEXTURE0 is the panel slot)`,
    );
  }
  if (doc.tempo.loop) throw new Error(`dope: ${doc.id} tempo.loop is not supported by the panel runner`);

  const derivedPassUniforms: PanelConfig["passUniforms"] | undefined = passExprs.length
    ? (_canvas, params, dpr, targetPx) => {
        const pass = {
          targetMinDimPx: Math.min(targetPx.width, targetPx.height),
          sdfRange: sdfInputs.range,
          sdfViewBoxW: sdfInputs.viewBoxW,
          dpr,
        };
        const out: Record<string, number> = {};
        for (const [web, expr] of passExprs) out[web] = evalPassExpr(expr, params, pass);
        return out;
      }
    : undefined;

  return {
    vertex: shader.vertex,
    fragment: shader.fragment,
    uniforms: [...uniforms],
    panelSampler: panelSpec.sampler,
    bindings,
    shadowHeightFrac:
      typeof shadowSpec === "number" ? shadowSpec : (params) => evalParamExpr(shadowSpec, params),
    draw,
    frame(info, params) {
      // Panels never snap on twos (`render.config.stepping: "none"`), so the
      // snapped clock IS the wall clock — `animMs := elapsedMs`.
      const ctx = {
        animMs: info.elapsedMs,
        life: info.life,
        elapsedMs: info.elapsedMs,
        params,
        loopS: 0,
        phase: 0,
      };
      const out: { amp: number } & Record<string, number> = {
        amp: evalFrameExpr(frameSpec.amp, ctx),
      };
      for (const [web, expr] of extraExprs) out[web] = evalFrameExpr(expr, ctx);
      return out;
    },
    passUniforms: derivedPassUniforms,
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
  /**
   * Compose non-numeric, code-shaped params on top of the loader bag — applied
   * to the factory's `resolve` AND forwarded to the bundled program.
   */
  composeParams?: RenderProgram["composeParams"];
  /** Override `tempo.reducedMotion`. */
  reducedMotion?: { peakMs?: number; holdMs?: number };
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
  const config = dopePassConfig(doc, shader, opts.hooks);
  const create = (params: PassParams, ctx: EffectContext): EffectInstance =>
    createPassInstance(config, params, ctx);
  return registerDerived(doc, create, opts);
}

/**
 * Build + register a data-driven Canvas2D-PANEL effect from
 * `(dope, shader, draw)`: the same registration as {@link registerDopeEffect}
 * but `create` is the generic PANEL runner over the {@link dopePanelConfig}
 * derivation. The only hand-written web sources left for such an effect are
 * its GLSL and the Canvas2D `draw` — the per-platform panel-draw seam.
 */
export function registerDopePanelEffect(
  doc: DopeDoc,
  shader: DopeShader,
  draw: PanelDraw,
  opts: RegisterDopeEffectOptions = {},
): EffectFactory<PassParams> {
  const config = dopePanelConfig(doc, shader, draw, { extraUniforms: opts.hooks?.extraUniforms });
  const create = (params: PassParams, ctx: EffectContext): EffectInstance =>
    createPanelInstance(config, params, ctx);
  return registerDerived(doc, create, opts);
}

/** The shared registration tail: resolve/reducedMotion/loop + the bundled program. */
function registerDerived(
  doc: DopeDoc,
  create: (params: PassParams, ctx: EffectContext) => EffectInstance,
  opts: RegisterDopeEffectOptions,
): EffectFactory<PassParams> {
  const scatterKey = doc.binding?.scatterKey;
  if (!scatterKey) throw new Error(`dope: ${doc.id} has no binding.scatterKey`);
  const consts = doc.render.consts ?? {};
  const name = opts.name ?? doc.id.split(".").pop()!;
  const reducedMotion = opts.reducedMotion ?? doc.tempo.reducedMotion;

  const factory: EffectFactory<PassParams> = {
    name,
    resolve: (feeling: FeelingInput) => {
      const numeric = resolveDopeParams(doc, feeling, consts, scatterKey);
      return (
        opts.composeParams
          ? opts.composeParams(
              numeric as Record<string, unknown>,
              feeling as { mood: string; intensity: number; whimsy: number; seed: number },
            )
          : numeric
      ) as unknown as PassParams;
    },
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
