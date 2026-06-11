/**
 * Solarbloom as an `EffectFactory` on the Dopamine backbone.
 *
 * Phase 1: now DATA + a-few-lines. Its mood→params mapping + checkmark glyph
 * band live in solarbloom.dope.json (loader-resolved). ALL renderer plumbing — program/VAO,
 * standard uniforms, the baked-SDF icon AND the font-glyph fallback texture
 * (uploaded to light + shadow), the light+shadow loop, dispose — is the shared
 * `createPassInstance` generic fullscreen-pass runner. The only code that
 * remains is the bloom SHADER + a small config naming its scalar params, its two
 * aux textures (SDF icon / glyph fallback), its shadow height, and the per-frame
 * check-draw + held-breath envelope timing.
 */

import { FRAGMENT_SRC, MAX_MOTES, VERTEX_SRC } from "./solarbloom-shader.js";
import { checkProgress } from "./solarbloom-tempo.js";
import type { CheckGlyph, RenderParams } from "./solarbloom-params.js";
import { drawCheckGlyph } from "./check-renderer.js";
import { drawMotePanel } from "./solarbloom-renderer.js";
import type { RGB } from "@dopamine/core";
import {
  envelope,
  registerEffect,
  registerProgram,
  parseDope,
  resolveDopeParams,
  getOutline,
  pickBand,
  createPassInstance,
  decodeSdf,
  type EffectContext,
  type EffectFactory,
  type EffectInstance,
  type AuxTextureSpec,
  type PassConfig,
  type PassParams,
  type DecodedSdf,
} from "@dopamine/core";
import doc from "./solarbloom.dope.json";

export type { RenderParams, CheckGlyph } from "./solarbloom-params.js";

// Re-export the bundled check-glyph face preloader from the effect's own chunk.
export { ensureCheckFonts } from "./check-renderer.js";

// Solarbloom is fully DATA-DRIVEN: its mood→params mapping lives in the bundled
// `.dope` document (solarbloom.dope.json), evaluated by the loader. A vitest
// proves the loader output is byte-identical to the legacy `resolveParams`, so
// flipping the source of truth to the file changes nothing visually.
const DOPE = parseDope(doc as object);

// GEOMETRY SEAM: the checkmark icon's SHAPE comes from the .dope's
// `geometry.outlines.checkmark.svgPath`, baked at build time into an inline SDF.
// We DECODE it once; the shader only samples it. Swapping the svgPath (+ re-bake)
// changes the rendered icon with NO shader edit. If the .dope carries no baked
// SDF we fall back to the font-glyph path, then the analytic SDF in-shader.
const CHECK_SDF: DecodedSdf | null = (() => {
  const outline = getOutline(DOPE, "checkmark");
  if (!outline?.sdf) return null;
  try {
    return decodeSdf(outline.sdf);
  } catch {
    return null;
  }
})();

// The whimsy→check-glyph fallback BANDS now live in the .dope (content.glyphBands)
// and are picked with the generic content resolver (only used when SDF is absent).
const GLYPH_BANDS = ((DOPE.content as { glyphBands?: CheckGlyph[] })?.glyphBands ?? [
  { family: "Dopamine Check Symbols", char: "✓" },
]) as CheckGlyph[];

/**
 * Resolve via the `.dope` loader → the typed RenderParams the shader consumes.
 * The numeric/palette params + the whimsy-derived CHECK GLYPH band both come
 * from the bundled `.dope` (byte-identical to `resolveParams` / `pickCheckGlyph`).
 */
function resolveFromDope(feeling: { mood: string; intensity: number; whimsy: number; seed: number }): RenderParams {
  const numeric = resolveDopeParams(DOPE, feeling, { MAX_MOTES }, "moteSeed") as unknown as RenderParams;
  return { ...numeric, checkGlyph: pickBand(GLYPH_BANDS, feeling.whimsy) };
}

// Half-size of the checkmark glyph box as a fraction of min viewport dim.
const CHECK_BOX_FRAC = 0.16;
/** Offscreen glyph texture resolution (square). Cheap; the glyph is tiny. */
const GLYPH_TEX_SIZE = 256;

const CONFIG: PassConfig = {
  vertex: VERTEX_SRC,
  fragment: FRAGMENT_SRC,
  uniforms: [
    "uCheck", "uExposure", "uBloomRadius", "uTurbulence", "uMoteSeed",
    "uIridescence", "uDispersion", "uMotePanel",
    "uCheckTex", "uCheckTexOn", "uCheckBox",
    "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx",
  ],
  usesOrigin: true,
  // overshoot feeds the envelope; moteSpeed/moteCount now drive the JS mote panel
  // (not shader uniforms); moteSeed still seeds the bloom's domain warp.
  bindings: { overshoot: null, moteSeed: "uMoteSeed", moteSpeed: null, moteCount: null },
  // The drifting motes are rasterized into a per-frame Canvas2D panel (sampled by
  // the shader) instead of looped per-pixel; the bloom + checkmark stay procedural.
  panel: {
    unit: 3,
    sampler: "uMotePanel",
    draw: (pctx, w, h, params, info) => {
      const p = params as unknown as RenderParams;
      drawMotePanel(
        pctx, w, h,
        {
          palette: p.palette as RGB[],
          bloomRadius: p.bloomRadius,
          turbulence: p.turbulence,
          moteSpeed: p.moteSpeed,
          moteCount: p.moteCount,
          moteSeed: p.moteSeed,
        },
        info.life, info.animMs / 1000, info.centerPx,
      );
    },
  },
  shadowHeightFrac: (params) => (params as unknown as RenderParams).bloomRadius,
  // The checkmark box + SDF stroke px (needed by the SDF path AND the analytic).
  passUniforms: (canvas) => {
    const box = CHECK_BOX_FRAC * Math.min(canvas.width, canvas.height);
    return { uCheckBox: box, uSdfStrokePx: box * 0.11 };
  },
  auxTextures: (params) => {
    const specs: AuxTextureSpec[] = [];
    if (CHECK_SDF) {
      // GEOMETRY SEAM: the baked SDF icon takes priority (bound to TEXTURE1).
      specs.push({
        kind: "sdf",
        unit: 1,
        sdf: CHECK_SDF,
        sampler: "uSdfTex",
        onUniform: "uSdfOn",
        uniforms: (canvas) => {
          const box = CHECK_BOX_FRAC * Math.min(canvas.width, canvas.height);
          const vbW = CHECK_SDF.viewBox[2] || 100;
          return { uSdfRangePx: CHECK_SDF.range * ((2 * box) / vbW) };
        },
      });
      return specs;
    }
    // Fallback: rasterize the whimsy-chosen check glyph once into an offscreen
    // canvas and let the runner upload it as an RGBA texture (TEXTURE0). If the
    // bundled face hasn't loaded, the shader falls back to its analytic SDF.
    const g = (params as unknown as RenderParams).checkGlyph;
    if (typeof document !== "undefined") {
      const glyphCanvas = document.createElement("canvas");
      glyphCanvas.width = GLYPH_TEX_SIZE;
      glyphCanvas.height = GLYPH_TEX_SIZE;
      const gctx = glyphCanvas.getContext("2d", { alpha: true });
      if (gctx && drawCheckGlyph(gctx, GLYPH_TEX_SIZE, g.family, g.char)) {
        specs.push({ kind: "canvas", unit: 0, source: glyphCanvas, sampler: "uCheckTex", onUniform: "uCheckTexOn" });
      }
    }
    return specs;
  },
  frame: ({ animMs, life }, params) => ({
    amp: envelope(life, (params as unknown as RenderParams).overshoot),
    uCheck: checkProgress(animMs),
  }),
};

function createInstance(params: RenderParams, ctx: EffectContext): EffectInstance {
  return createPassInstance(CONFIG, params as unknown as PassParams, ctx);
}

export const solarbloom: EffectFactory<RenderParams> = {
  name: "solarbloom",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 260, holdMs: 360 },
};

// Expose the renderer as a bundled PROGRAM so `loadEffect()` can bind an
// arbitrary host-authored `.dope` (one that references program "solarbloom") to
// it with no code. The numeric/palette bag comes from the loader; the whimsy-
// picked check glyph is composed on top (genuinely code-shaped, no rng).
registerProgram<RenderParams>("solarbloom", {
  create: createInstance,
  scatterKey: "moteSeed",
  consts: { MAX_MOTES },
  reducedMotion: { peakMs: 260, holdMs: 360 },
  composeParams: (numeric, feeling) => ({
    ...numeric,
    checkGlyph: pickBand(GLYPH_BANDS, feeling.whimsy),
  }),
});

export default registerEffect(solarbloom);
