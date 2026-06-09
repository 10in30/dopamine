// GLSL ES 3.00 source for Heartburst — the web `heartburst-shader.ts` reused
// VERBATIM (Android OpenGL ES 3.0 speaks the same GLSL ES 3.00 as WebGL2). The
// shared "look" chunks come from `dopamine-core` (one canonical copy). The ONLY
// change from the web body is the final emit: `dopLightOut(col)` (premultiplied
// alpha = brightness) instead of `vec4(col, 1.0)`, because the Android overlay is
// self-contained (no CSS screen-blend against the page — see Look.kt). The RGB
// look is byte-identical to web.
//
// The shader lights the offscreen panel (HeartburstPanel.kt) — adds the soft warm
// bloom, gloss highlight, halftone blush, noir↔pop styling, beat flash, cast light.
// Panel channel encoding: R = hero heart FILL · G = INK + gloss seed · B = burst.

package ai.dopamine.effect.heartburst

import ai.dopamine.core.GLSL_CONSTANTS
import ai.dopamine.core.GLSL_DITHER
import ai.dopamine.core.GLSL_FULLSCREEN_VERTEX
import ai.dopamine.core.GLSL_HALFTONE
import ai.dopamine.core.GLSL_HASH
import ai.dopamine.core.GLSL_LIGHT_OUT
import ai.dopamine.core.GLSL_ROT2
import ai.dopamine.core.GLSL_TONEMAP_ACES

val HEARTBURST_VERTEX_SRC: String = GLSL_FULLSCREEN_VERTEX

val HEARTBURST_FRAGMENT_SRC: String = """#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPanel;     // R=heartFill G=ink B=burstFill
uniform vec2  uResolution;    // device pixels
uniform vec2  uCenter;        // heart centre, device px
uniform float uLife;          // whole-effect progress 0..1
uniform float uTimeS;         // elapsed seconds
uniform float uPresence;      // panel opacity / presence 0..1
uniform float uBeat;          // 0..1 current beat amplitude (lub-dub thump)
uniform float uBurst;         // 0..1 burst progress (little hearts flying out)
uniform float uFlash;         // 0..1 warm beat/burst flash amount
uniform float uExposure;      // cast-light gain
uniform float uGlow;          // 0..1 soft bloom radius/strength behind the heart
uniform float uGloss;         // 0..1 specular gloss on the hero heart (photoreal)
uniform float uHalftone;      // 0..1 Ben-Day blush dot strength (pop)
uniform float uDotSize;       // halftone cell size in device px
uniform float uSaturation;    // 0..1 panel color saturation (noir->pop)
uniform float uSeed;          // per-fire hash
uniform float uStyle;         // 0..1 photoreal/noir -> flat cel sticker (whimsy)
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette
uniform float uShadowSoft;    // penumbra softness in device px
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;            // hero heart core color (warm red)
uniform vec3  uC1;            // heart shade / burst color (pink/coral)
uniform vec3  uC2;            // accent / glow / blush color

${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_ROT2}
${GLSL_HALFTONE}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
${GLSL_LIGHT_OUT}

void main(){
  vec2 frag = vUv * uResolution;
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);

  // ---- SHADOW PASS (multiply layer) ---------------------------------------
  if (uShadow > 0.5) {
    vec2 px = 1.0 / res;
    vec2 souv = vUv - uShadowOffset * px;
    float occ = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * TAU;
      vec2 o = vec2(cos(a), sin(a)) * uShadowSoft * px;
      vec2 tuv = souv + o;
      vec2 inb = step(vec2(0.0), tuv) * step(tuv, vec2(1.0));
      float mask = inb.x * inb.y;
      vec4 s = texture(uPanel, tuv);
      occ += clamp(s.r + s.b, 0.0, 1.0) * mask;
    }
    occ /= 8.0;
    float dark = clamp(occ * uShadowStrength, 0.0, 1.0);
    fragColor = vec4(vec3(1.0 - dark), 1.0);
    return;
  }

  vec2 fromC = frag - uCenter;
  float rad = length(fromC);

  vec4 panel = texture(uPanel, vUv);
  float heartFill = panel.r;
  float ink = panel.g;
  float burstFill = panel.b;

  vec3 col = vec3(0.0);

  // ---- SOFT BLOOM behind the heart (the love glow) ------------------------
  float glowR = minDim * (0.18 + 0.30 * uGlow) * (1.0 + 0.25 * uBeat);
  float bloom = exp(-rad / glowR);
  float bloomAmp = (0.35 + 0.65 * uBeat) * (0.6 + 0.8 * uBurst * (1.0 - uBurst) * 3.0);
  vec3 glowCol = mix(uC0, uC2, 0.45 + 0.3 * uSaturation);
  col += glowCol * bloom * bloomAmp * uPresence * uGlow * uExposure * 0.9;

  // ---- HERO HEART ---------------------------------------------------------
  float vshade = clamp(1.0 - vUv.y, 0.0, 1.0);
  vec3 bodyLit  = mix(uC1, uC0, 0.35 + 0.65 * uSaturation);
  vec3 bodyHi   = clamp(bodyLit * 1.5 + 0.18, 0.0, 1.6);
  vec3 bodyLow  = bodyLit * 0.55;
  float g = smoothstep(0.15, 0.95, vshade);
  float gCel = step(0.5, vshade);
  float grad = mix(g, gCel, uStyle);
  vec3 heartCol = mix(bodyLow, bodyHi, grad);

  float edge = 0.0;
  {
    vec2 px = 1.0 / res;
    for (int i = 0; i < 6; i++){
      float a = float(i) / 6.0 * TAU;
      edge += texture(uPanel, vUv + vec2(cos(a), sin(a)) * px * 3.0).r;
    }
    edge /= 6.0;
  }
  float rimDark = clamp((heartFill - edge), 0.0, 1.0);
  heartCol *= 1.0 - rimDark * 0.5 * (1.0 - uStyle);

  float blush = benday(frag, uDotSize, mix(0.35, 0.6, uHalftone), radians(20.0) + uSeed);
  heartCol += (uC2 - heartCol) * blush * uHalftone * uStyle * 0.28;

  col += heartCol * heartFill * uPresence * uExposure * 1.6;

  float gloss = ink * heartFill;
  float glossAmt = uGloss * (1.0 - uStyle) * (0.6 + 0.6 * uBeat);
  col += vec3(1.0) * gloss * glossAmt * uPresence * 1.4;

  // ---- BURST: the flurry of little hearts ---------------------------------
  float burstFade = 1.0 - smoothstep(0.55, 1.0, uBurst);
  vec3 littleCol = mix(uC1, uC2, 0.3 + 0.4 * uSaturation);
  littleCol = clamp(littleCol * 1.25 + 0.1, 0.0, 1.5);
  col += littleCol * burstFill * uPresence * burstFade * uExposure * 1.5;
  col += littleCol * burstFill * 0.4 * burstFade * (0.5 + 0.5 * sin(uTimeS * 30.0 + uSeed));

  // ---- INK / CONTOUR ------------------------------------------------------
  float contour = ink * (1.0 - heartFill);
  float carve = contour * uPresence * mix(0.45, 0.95, uStyle);
  col *= (1.0 - carve);

  // ---- BEAT / BURST FLASH -------------------------------------------------
  float flashFall = exp(-rad / (minDim * 0.40));
  vec3 flashCol = mix(uC0, vec3(1.0, 0.85, 0.8), 0.4 + 0.25 * uStyle);
  col += flashCol * flashFall * uFlash * uExposure * 1.2;
  float core = exp(-rad / (minDim * 0.08));
  col += vec3(1.0, 0.92, 0.9) * core * uFlash * uBeat * 1.3;

  // ---- TONE + FINISH ------------------------------------------------------
  col = tonemapACES(col * 0.9);

  if (uStyle > 0.001) {
    float lit = smoothstep(0.02, 0.2, max(max(col.r, col.g), col.b));
    vec3 q = floor(col * 4.0 + 0.5) / 4.0;
    col = mix(col, mix(col, q, lit), uStyle * 0.7);
  }

  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle * 0.7);

  // ANDROID self-contained overlay: emit premultiplied light (alpha = brightness)
  // instead of the web's opaque `vec4(max(col,0.0), 1.0)`. See Look.kt.
  fragColor = dopLightOut(col);
}"""
