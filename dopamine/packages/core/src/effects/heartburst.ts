/**
 * Heartburst (the love / like / favorite success effect) as an `EffectFactory`.
 *
 * A Canvas2D-hybrid via the shared panel runner: the big swelling heart + the
 * flurry of little burst hearts are drawn as vector heart curves into ONE
 * offscreen Canvas2D panel each frame (heartburst-renderer.ts); the fragment
 * shader (heartburst-shader.ts) adds the soft warm bloom behind the heart, the
 * gloss highlight, the halftone blush, the noir↔pop styling, the beat flash, and
 * casts the warm light + a soft shadow (the multiply shadow pass).
 *
 * Feeling mapping:
 *   mood      — serene = a single gentle pulse, soft pink; celebratory = full
 *               lub-dub double-beat + lively burst; electric = punchy, hot magenta.
 *   intensity — beat strength + number of burst hearts + glow/exposure.
 *   whimsy    — soft photoreal gloss heart (0) → flat cel "sticker" heart (1).
 *
 * Fully data-driven from heartburst.dope.json via the loader (numeric params +
 * the warm OKLCH golden-angle palette, unique per fire). The genuinely
 * code-shaped parts that stay JS are the GLSL and the Canvas2D `draw()`.
 */

import {
  HEARTBURST_FRAGMENT_SRC,
  HEARTBURST_VERTEX_SRC,
} from "../engine/heartburst-shader.js";
import {
  drawHeartburstPanel,
  type HeartburstRenderParams,
} from "../engine/heartburst-renderer.js";
import {
  heartbeatScale,
  heartburstEnvelope,
  burstProgress,
  HEARTBEAT_PHASE,
} from "../engine/tempo.js";
import type {
  EffectContext,
  EffectFactory,
  EffectInstance,
  FeelingInput,
} from "../framework/effect.js";
import { registerEffect } from "../framework/registry.js";
import { registerProgram } from "../framework/programs.js";
import { parseDope, resolveDopeParams } from "../framework/loader.js";
import { createPanelInstance, type PanelConfig } from "../framework/panel-runner.js";
import type { PassParams } from "../framework/pass-runner.js";
import doc from "./heartburst.dope.json";

const DOPE = parseDope(doc as object);

type HBParams = HeartburstRenderParams & PassParams;

/**
 * The warm beat/burst FLASH amount over normalized life. Spikes hard on each
 * lub-dub thump (tracking the beat amplitude) and again at the burst release,
 * then decays. Pure function of life.
 */
function heartFlash(life: number, beatStrength: number, doubleBeat: number): number {
  const beat = Math.max(0, heartbeatScale(life, beatStrength, doubleBeat) - 1); // 0 at rest
  const b = burstProgress(life);
  const burstSpike = b > 0 ? Math.exp(-Math.pow((b - 0.06) / 0.12, 2)) : 0;
  return Math.min(1.2, beat * 1.6 + burstSpike * 0.8);
}

const CONFIG: PanelConfig<HBParams> = {
  vertex: HEARTBURST_VERTEX_SRC,
  fragment: HEARTBURST_FRAGMENT_SRC,
  panelSampler: "uPanel",
  uniforms: [
    "uPresence", "uBeat", "uBurst", "uFlash", "uExposure",
    "uGlow", "uGloss", "uHalftone", "uDotSize", "uSaturation", "uSeed",
  ],
  // heartburstSeed drives uSeed; the draw-only geometry (heartScale, burstCount,
  // burstSpread, inkWeight, beatStrength, doubleBeat) + dpr-scaled dotSize are
  // not auto-bound uniforms.
  bindings: {
    heartburstSeed: "uSeed",
    seed: null,
    heartScale: null,
    burstCount: null,
    burstSpread: null,
    inkWeight: null,
    beatStrength: null,
    doubleBeat: null,
    dotSize: null,
  },
  shadowHeightFrac: (p) => p.heartScale * 1.1,
  passUniforms: (_canvas, params, dpr) => ({ uDotSize: params.dotSize * dpr }),
  draw: (pctx, w, h, params, info) => {
    const scale = heartbeatScale(info.life, params.beatStrength, params.doubleBeat);
    const presence = heartPresence(info.life);
    drawHeartburstPanel(pctx, w, h, params, scale, info.life, presence, info.dpr);
  },
  frame: ({ life }, params) => {
    const beat = Math.max(0, heartbeatScale(life, params.beatStrength, params.doubleBeat) - 1);
    const amp = heartburstEnvelope(life, params.beatStrength, params.doubleBeat);
    return {
      amp,
      uPresence: heartPresence(life),
      uBeat: Math.min(1, beat * 2.2),
      uBurst: burstProgress(life),
      uFlash: heartFlash(life, params.beatStrength, params.doubleBeat),
    };
  },
};

/**
 * Overall panel presence over normalized life: a quick snap-in, a proud hold
 * through the beats + burst, then a clean fade at the tail so the panel clears.
 */
function heartPresence(life: number): number {
  const t = life < 0 ? 0 : life > 1 ? 1 : life;
  if (t < 0.04) return t / 0.04;
  if (t < 0.8) return 1;
  const fade = 1 - (t - 0.8) / 0.2;
  return Math.pow(Math.max(0, fade), 1.4);
}

function createInstance(params: HBParams, ctx: EffectContext): EffectInstance {
  return createPanelInstance(CONFIG, params, ctx);
}

export const heartburst: EffectFactory<HBParams> = {
  name: "heartburst",
  resolve: (feeling: FeelingInput) =>
    resolveDopeParams(DOPE, feeling, {}, "heartburstSeed") as unknown as HBParams,
  create: createInstance,
  reducedMotion: { peakMs: Math.round(HEARTBEAT_PHASE * 600), holdMs: 360 },
};

// Expose as a bundled program so loadEffect() can bind a host-authored heartburst
// variant (different warm palette / burst counts) with no code.
registerProgram<HBParams>("heartburst", {
  create: createInstance,
  scatterKey: "heartburstSeed",
  consts: {},
  reducedMotion: { peakMs: Math.round(HEARTBEAT_PHASE * 600), holdMs: 360 },
});

export default registerEffect(heartburst);
