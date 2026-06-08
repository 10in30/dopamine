/**
 * Comic Impact (the "BAM! POW!" success effect) as an `EffectFactory`.
 *
 * A hybrid: the jagged starburst + hand-lettered word + ink contours are drawn
 * into ONE offscreen Canvas2D panel each frame; the fragment shader adds the
 * Ben-Day halftone, action lines, flash, noir↔pop styling and casts the light.
 *
 * Phase 2: ALL renderer/texture/upload/shadow plumbing is now the shared
 * `createPanelInstance` Canvas2D-panel runner (it owns the offscreen canvas,
 * resize, per-frame draw→texImage2D into light + shadow, channel encoding, the
 * standard uniforms + scalar auto-binding, the two passes, dispose). What remains
 * per-effect: the comic SHADER, the `drawComicPanel` PANEL PROGRAM (the Canvas2D
 * draw — genuinely code-shaped vector/text logic stays JS, the honest boundary),
 * and a tiny config naming the shader uniforms + the per-frame impact timing.
 * The word + typography are still data-driven from comic.dope.json via the loader
 * + content resolver (byte-identical to the legacy resolveComicParams).
 */

import { impactScale, impactPresence, IMPACT_MS, IMPACT_HOLD_MS } from "./comic-tempo.js";
import { type ComicRenderParams, type ComicWord } from "./comic-params.js";
import { COMIC_FRAGMENT_SRC, COMIC_VERTEX_SRC } from "./comic-shader.js";
import { drawPanel } from "./comic-renderer.js";
import {
  registerEffect,
  registerProgram,
  parseDope,
  resolveDopeParams,
  pickFromList,
  resolveTypography,
  createPanelInstance,
  type DopeTypography,
  type EffectContext,
  type EffectFactory,
  type EffectInstance,
  type FeelingInput,
  type PanelConfig,
  type PassParams,
} from "@dopamine/core";
import doc from "./comic.dope.json";

export type { ComicRenderParams, ComicWord } from "./comic-params.js";

// Re-export the bundled comic-face preloader from the effect's own chunk, so a
// host that imports this effect can await its lettering without pulling the barrel.
export { ensureComicFonts } from "./comic-renderer.js";

// Comic is FULLY data-driven: numeric panel + palette params, the per-fire
// WORD/checkmark token (content.pool), and the TYPOGRAPHY (mood→face + the
// whimsy/intensity curve table) all come from comic.dope.json via the loader +
// content resolver — byte-identical to the legacy resolveComicParams /
// comicTypography / pickWord (parity-tested). Reskinning is no-code.
const DOPE = parseDope(doc as object);
const CONTENT = (DOPE.content ?? {}) as { pool?: readonly string[] };
const TYPO = DOPE.typography as unknown as DopeTypography;

function resolveFromDope(feeling: FeelingInput): ComicRenderParams {
  const numeric = resolveDopeParams(DOPE, feeling, {}, "comicSeed") as unknown as Record<string, unknown>;
  return composeComic(numeric, feeling);
}

/** Compose the non-numeric Comic params (word + typography) from the .dope. */
function composeComic(numeric: Record<string, unknown>, feeling: FeelingInput): ComicRenderParams {
  const pool = CONTENT.pool ?? ["DONE!"];
  return {
    ...numeric,
    word: pickFromList(pool, feeling.seed) as ComicWord,
    ...resolveTypography(TYPO, feeling.mood, feeling.intensity, feeling.whimsy),
  } as unknown as ComicRenderParams;
}

const CONFIG: PanelConfig<ComicRenderParams & PassParams> = {
  vertex: COMIC_VERTEX_SRC,
  fragment: COMIC_FRAGMENT_SRC,
  panelSampler: "uPanel",
  uniforms: [
    "uPresence", "uFlash", "uExposure", "uHalftone", "uDotSize",
    "uSaturation", "uActionLines", "uInkBoost", "uSeed",
  ],
  // comicSeed drives uSeed; raw seed / overshoot / draw-only geometry (scale,
  // burstPoints, inkWeight) + the dpr-scaled dotSize are not auto-bound uniforms.
  bindings: { comicSeed: "uSeed", seed: null, overshoot: null, scale: null, burstPoints: null, inkWeight: null, dotSize: null },
  shadowHeightFrac: 0.5,
  passUniforms: (_canvas, params, dpr) => ({
    uDotSize: params.dotSize * dpr,
    uInkBoost: 1.0 + params.style * 0.4,
  }),
  draw: (pctx, w, h, params, info) => {
    const scale = impactScale(info.elapsedMs, params.overshoot);
    const presence = impactPresence(info.life);
    drawPanel(pctx, w, h, params, scale, presence, info.dpr);
  },
  frame: ({ elapsedMs, life }) => {
    const presence = impactPresence(life);
    const flash =
      Math.exp(-elapsedMs / (IMPACT_MS * 0.55)) +
      0.25 * Math.exp(-Math.abs(elapsedMs - IMPACT_HOLD_MS * 0.2) / (IMPACT_MS * 0.8));
    // `amp` (= presence) feeds shadowGeometry; uFlash is clamped as before.
    return { amp: presence, uPresence: presence, uFlash: Math.min(flash, 1.2) };
  },
};

function createInstance(params: ComicRenderParams, ctx: EffectContext): EffectInstance {
  return createPanelInstance(CONFIG, params as ComicRenderParams & PassParams, ctx);
}

export const comic: EffectFactory<ComicRenderParams> = {
  name: "comic",
  resolve: (feeling) => resolveFromDope(feeling),
  create: createInstance,
  reducedMotion: { peakMs: 220, holdMs: 360 },
};

// Expose as a bundled program so loadEffect() can bind a host-authored comic
// variant (different words/font/curves) with no code; composeParams adds the
// word + typography from the (possibly overridden) doc's content/typography.
registerProgram<ComicRenderParams>("comic", {
  create: createInstance,
  scatterKey: "comicSeed",
  consts: {},
  reducedMotion: { peakMs: 220, holdMs: 360 },
  composeParams: (numeric, feeling) =>
    composeComic(numeric, feeling) as unknown as Record<string, unknown>,
});

export default registerEffect(comic);
