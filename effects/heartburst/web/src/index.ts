/**
 * Heartburst (the love / like / favorite success effect) — the DATA-DRIVEN
 * panel factory shim.
 *
 * Everything that isn't the shader or the Canvas2D draw is DATA in
 * heartburst.dope.json, interpreted by the shared backbone:
 *   - the mood→params mapping + the warm OKLCH golden-angle palette (the loader),
 *   - the per-frame lub-dub/burst logic (`tempo.frame` — amp + the
 *     presence/beat/burst/flash extras, delta-0 with the old hand hooks),
 *   - the shadow height (`render.shadowHeightFrac`), the dpr-scaled halftone
 *     cell (`render.pass`), the panel wiring (`render.panel`), the no-snap
 *     clock (`render.config.stepping: "none"`), and `tempo.reducedMotion`,
 *   - the uniform `binding` contract (the `u<Name>` list + exceptions).
 *
 * The genuinely code-shaped parts that stay JS are the GLSL
 * (heartburst-shader.ts — the single source the MSL + Kotlin shaders are
 * generated from) and the Canvas2D panel draw (heartburst-renderer.ts).
 */

import {
  HEARTBURST_FRAGMENT_SRC,
  HEARTBURST_VERTEX_SRC,
} from "./heartburst-shader.js";
import { drawHeartburstFrame } from "./heartburst-renderer.js";
import { parseDope, registerDopePanelEffect } from "@dopaminefx/core";
import doc from "./heartburst.dope.json";

export type { HeartburstRenderParams } from "./heartburst-renderer.js";

const DOPE = parseDope(doc as object);

// Registers the EffectFactory AND the bundled "heartburst" program (so
// loadEffect() can bind a host-authored heartburst variant with no code).
export const heartburst = registerDopePanelEffect(
  DOPE,
  { vertex: HEARTBURST_VERTEX_SRC, fragment: HEARTBURST_FRAGMENT_SRC },
  drawHeartburstFrame,
);

export default heartburst;
