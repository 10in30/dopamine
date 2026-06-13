/**
 * Comic Impact (the "BAM! POW!"→affirmation success effect) — the DATA-DRIVEN
 * panel factory shim.
 *
 * Everything that isn't the shader or the Canvas2D draw is DATA in
 * comic.dope.json, interpreted by the shared backbone:
 *   - the mood→params mapping + the OKLCH golden-angle palette (the loader),
 *   - the per-frame slam logic (`tempo.frame` — amp + the presence/flash
 *     extras, delta-0 with the old hand frame() hook),
 *   - the shadow height (`render.shadowHeightFrac`), the dpr-scaled Ben-Day cell
 *     + style-fattened ink (`render.pass`), the panel wiring (`render.panel`),
 *     the no-snap clock (`render.config.stepping: "none"`), and
 *     `tempo.reducedMotion`,
 *   - the uniform `binding` contract (the `u<Name>` list + exceptions),
 *   - the affirmation `content.pool` + the mood→face/curve `typography` table.
 *
 * The genuinely code-shaped parts that stay JS are the GLSL (comic-shader.ts —
 * the single source the MSL + Kotlin shaders are generated from), the Canvas2D
 * panel draw (comic-renderer.ts — the jagged starburst + the per-letter
 * display-face lettering, which is NOT datafied), and the per-fire word pick +
 * typography compose (the `composeParams` hook).
 */

import { drawComicFrame, ensureComicFonts } from "./comic-renderer.js";
import { type ComicRenderParams, type ComicWord } from "./comic-params.js";
import { COMIC_FRAGMENT_SRC, COMIC_VERTEX_SRC } from "./comic-shader.js";
import {
  parseDope,
  pickFromList,
  registerDopePanelEffect,
  resolveTypography,
  type DopeTypography,
} from "@dopaminefx/core";
import doc from "./comic.dope.json";

export type { ComicRenderParams, ComicWord } from "./comic-params.js";

// Re-export the bundled comic-face preloader from the effect's own chunk, so a
// host that imports this effect can await its lettering without pulling the barrel.
export { ensureComicFonts } from "./comic-renderer.js";

const DOPE = parseDope(doc as object);
const CONTENT = (DOPE.content ?? {}) as { pool?: readonly string[] };
const TYPO = DOPE.typography as unknown as DopeTypography;

/**
 * Compose the non-numeric Comic params on top of the loader bag: the per-fire
 * WORD (seed-picked from `content.pool`) + the mood/whimsy/intensity TYPOGRAPHY
 * (face + the curve fields). Code-shaped on web (the seeded pick + the CSS font
 * stack); the native generated factories fold the same typography in via the
 * loader and pick the word inside the panel draw.
 */
function composeComic(
  numeric: Record<string, unknown>,
  feeling: { mood: string; intensity: number; whimsy: number; seed: number },
): Record<string, unknown> {
  const pool = CONTENT.pool ?? ["DONE!"];
  return {
    ...numeric,
    word: pickFromList(pool, feeling.seed) as ComicWord,
    ...resolveTypography(TYPO, feeling.mood, feeling.intensity, feeling.whimsy),
  };
}

// Registers the EffectFactory AND the bundled "comic" program (so loadEffect()
// can bind a host-authored comic variant — different words/font/curves — with no
// code; composeParams adds the word + typography from the resolved doc).
export const comic = registerDopePanelEffect(
  DOPE,
  { vertex: COMIC_VERTEX_SRC, fragment: COMIC_FRAGMENT_SRC },
  drawComicFrame,
  { composeParams: composeComic },
) as unknown as import("@dopaminefx/core").EffectFactory<ComicRenderParams>;

// Begin loading the bundled display faces as soon as the effect is imported so
// they're usually ready by the time the user fires (comic-renderer side-effects
// this too; calling again is a no-op).
void ensureComicFonts();

export default comic;
