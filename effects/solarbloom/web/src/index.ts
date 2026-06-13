/**
 * Solarbloom (the radial volumetric-bloom success effect) — the DATA-DRIVEN
 * factory shim.
 *
 * Solarbloom is a PASS HYBRID: a procedural full-screen volumetric bloom +
 * a checkmark drawn in light, plus a Canvas2D SPRITE PANEL for the drifting
 * motes. Everything that isn't the shader or the two code-shaped draws is DATA
 * in solarbloom.dope.json, interpreted by the shared backbone via
 * `registerDopeEffect`:
 *   - the mood→params mapping + the OKLCH golden-angle palette (the loader),
 *   - the per-frame logic (`tempo.frame` — amp = the held-breath envelope, the
 *     `check` draw-in progress, delta-0 with the old factory frame() hook),
 *   - the shadow height (`render.shadowHeightFrac` = bloomRadius), the per-pass
 *     checkmark-box / SDF-stroke / SDF-range uniforms (`render.pass`), the
 *     MAX_MOTES clamp const (`render.consts`), `render.config.usesOrigin`, and
 *     `tempo.reducedMotion`,
 *   - the DECLARATIVE baked-SDF checkmark: `binding.samplers[].outline`/`on`
 *     binds the geometry.outlines.checkmark SDF at texture(1) and flips uSdfOn
 *     (the fail precedent) — no hand auxTextures code,
 *   - the uniform `binding` contract (the `u<Name>` list + exceptions).
 *
 * The genuinely code-shaped parts that stay JS are the GLSL (solarbloom-shader.ts)
 * and the mote SPRITE-PANEL draw (solarbloom-renderer.ts — the per-mote poses are
 * panel GEOMETRY, code by design). The whimsy-picked check GLYPH band is composed
 * onto the resolved bag (metadata for a host's optional glyph-fallback rasterize;
 * the canonical effect always carries the baked SDF, so the SDF path renders).
 */

import { VERTEX_SRC, FRAGMENT_SRC } from "./solarbloom-shader.js";
import type { CheckGlyph, RenderParams } from "./solarbloom-params.js";
import { drawMotePanel } from "./solarbloom-renderer.js";
import {
  parseDope,
  pickBand,
  registerDopeEffect,
  type EffectFactory,
  type RGB,
} from "@dopaminefx/core";
import doc from "./solarbloom.dope.json";

export type { RenderParams, CheckGlyph } from "./solarbloom-params.js";

// Re-export the bundled check-glyph face preloader from the effect's own chunk
// (a host that wires the glyph-fallback aux can await the bundled faces).
export { ensureCheckFonts } from "./check-renderer.js";

// MAX_MOTES is the single source of truth for the mote cap: BOTH the shader
// `#define` (the per-pixel native loop bound) AND the integer clamp the `.dope`
// mapping references (`render.params.moteCount.clampMax`, from `render.consts`).
export { MAX_MOTES } from "./solarbloom-shader.js";

const DOPE = parseDope(doc as object);

// The whimsy→check-glyph fallback BANDS live in the `.dope` (content.glyphBands).
const GLYPH_BANDS = ((DOPE.content as { glyphBands?: CheckGlyph[] })?.glyphBands ?? [
  { family: "Dopamine Check Symbols", char: "✓" },
]) as CheckGlyph[];

/**
 * Compose the whimsy-picked CHECK GLYPH band onto the numeric/palette bag (the
 * only non-numeric, code-shaped param). The baked SDF is the canonical icon
 * source, so this is metadata for a host's optional glyph-fallback rasterize.
 */
function composeSolarbloom(
  numeric: Record<string, unknown>,
  feeling: { mood: string; intensity: number; whimsy: number; seed: number },
): Record<string, unknown> {
  return { ...numeric, checkGlyph: pickBand(GLYPH_BANDS, feeling.whimsy) };
}

// Registers the EffectFactory AND the bundled "solarbloom" program. The whole
// factory is data + the two code-shaped hooks: the GLSL shader and the mote
// SPRITE-PANEL draw (`hooks.panelDraw`, wired at the `render.panel` unit/sampler);
// the baked-SDF checkmark binds declaratively from `binding.samplers`.
export const solarbloom = registerDopeEffect(DOPE, { vertex: VERTEX_SRC, fragment: FRAGMENT_SRC }, {
  composeParams: composeSolarbloom,
  hooks: {
    panelDraw: (pctx, w, h, params, info) => {
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
}) as unknown as EffectFactory<RenderParams>;

export default solarbloom;
