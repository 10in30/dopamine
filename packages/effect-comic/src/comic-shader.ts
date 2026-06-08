/**
 * GLSL ES 3.00 source for **Comic Impact** — Dopamine's third success effect: a
 * Golden/Silver-Age comic-book "BAM! POW!" fight-panel impact.
 *
 * This is a HYBRID effect. Crisp blocky vector lettering and bold ink contours
 * are hard to do well in a pure fragment shader, so the renderer draws the
 * onomatopoeia word + jagged starburst + ink outlines into an OFFSCREEN Canvas2D
 * and hands it to this shader as a single "panel" texture. The shader then does
 * everything that wants to be procedural and screen-space:
 *   - Ben-Day / halftone DOT shading (rotated screen, dot radius driven by the
 *     underlying value) — subtle/fine at the noir end, loud/large at pop-art.
 *   - RADIATING action / speed lines bursting from the impact centre.
 *   - A FLASH that throws colored light onto the page (the screen-blend cast).
 *   - The NOIR ↔ POP-ART styling: near-monochrome high-contrast chiaroscuro with
 *     one spot color → screaming saturated pop, keyed off uStyle/uSaturation.
 *
 * Everything is summed as light (canvas is black, composited via
 * `mix-blend-mode: screen`, so black == no change, bright == cast light).
 *
 * Panel texture channel encoding (see comic-renderer.ts):
 *   R = word FILL mask        (letter interiors)
 *   G = INK mask              (all black ink: letter + burst + line outlines)
 *   B = burst FILL mask       (starburst balloon interior, behind the word)
 *   A = unused
 *
 * Pure function of uniforms → frame-perfect & cheap under SwiftShader.
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_HALFTONE,
  GLSL_HASH,
  GLSL_ROT2,
  GLSL_TONEMAP_ACES,
} from "@dopamine/core";

export const COMIC_VERTEX_SRC = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const COMIC_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPanel;     // R=wordFill G=ink B=burstFill
uniform vec2  uResolution;    // device pixels
uniform vec2  uCenter;        // impact centre, device px
uniform float uLife;          // whole-effect progress 0..1
uniform float uTimeS;         // elapsed seconds
uniform float uPresence;      // panel opacity / presence 0..1
uniform float uFlash;         // 0..1 impact flash amount (fast spike, decays)
uniform float uExposure;      // cast-light gain
uniform float uHalftone;      // 0..1 Ben-Day dot strength
uniform float uDotSize;       // Ben-Day cell size in device px
uniform float uSaturation;    // 0..1 panel color saturation (noir->pop)
uniform float uActionLines;   // count of radiating speed lines
uniform float uInkBoost;      // ink darkness/spread multiplier (pop fattens ink)
uniform float uSeed;          // per-fire hash
uniform float uStyle;         // 0..1 noir -> pop-art (whimsy)
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette (away from light)
uniform float uShadowSoft;    // penumbra softness in device px (blur tap radius)
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;            // word fill color
uniform vec3  uC1;            // secondary / burst color
uniform vec3  uC2;            // dot / accent color

${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_ROT2}
${GLSL_HALFTONE}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}

void main(){
  vec2 frag = vUv * uResolution;
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);

  // ---- SHADOW PASS (multiply layer) ---------------------------------------
  // Cheap occlusion: the panel's solid forms (word fill + burst fill) sampled
  // at an offset toward the implied key light, with a small ring blur for a
  // penumbra. White = no shadow (multiply identity); darker = cast shadow. The
  // panel already encodes presence, so the shadow fades with the effect.
  if (uShadow > 0.5) {
    vec2 px = 1.0 / res;
    vec2 souv = vUv - uShadowOffset * px;
    float occ = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * TAU;
      vec2 o = vec2(cos(a), sin(a)) * uShadowSoft * px;
      vec2 tuv = souv + o;
      // Gate samples that fall OUTSIDE the panel: the texture is CLAMP_TO_EDGE,
      // so without this an offset sample past an edge smears that edge row into
      // a phantom band (the streaks at the top of the frame). Outside == no
      // occluder == no shadow.
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
  float ang = atan(fromC.y, fromC.x);

  vec4 panel = texture(uPanel, vUv);
  float wordFill = panel.r;
  float inkMask  = clamp(panel.g * uInkBoost, 0.0, 1.0);
  float burstFill = panel.b;

  vec3 col = vec3(0.0);

  // ---- RADIATING ACTION / SPEED LINES -------------------------------------
  // Thin wedges bursting outward from the impact centre. Procedural so they're
  // crisp and cheap. They live in a ring OUTSIDE the burst balloon (so they
  // read as motion lines streaking off the hit, not hatching on the word).
  float lineN = max(uActionLines, 1.0);
  float a01 = (ang / TAU) + 0.5;                 // 0..1 around the circle
  float idx = floor(a01 * lineN);
  // per-line random angular jitter + length so they aren't a clean fan.
  float jr = hash11(idx + uSeed * 3.1);
  float jr2 = hash11(idx * 1.7 + uSeed * 7.3);
  float cellPhase = fract(a01 * lineN);
  float wedge = abs(cellPhase - 0.5);
  // Thin tapered streaks: a sharp spine that fattens slightly outward (classic
  // motion-line wedge), kept narrow so they read as speed lines, not pie slices.
  float thick = mix(0.05, 0.14, jr);
  float lineBody = 1.0 - smoothstep(thick * 0.35, thick, wedge);
  // radial extent: lines start OUTSIDE the burst and streak outward to the edge.
  float innerR = minDim * (0.30 + 0.05 * jr2);
  float outerR = minDim * (0.46 + 0.30 * jr);
  float radialMask = smoothstep(innerR, innerR + minDim * 0.015, rad)
                   * (1.0 - smoothstep(outerR - minDim * 0.10, outerR, rad));
  // fade the lines in fast on impact, hold, then they thin out late.
  float linePresence = smoothstep(0.0, 0.06, uLife) * (1.0 - smoothstep(0.6, 1.0, uLife));
  // taper opacity along the line so the inner end is boldest (ink-streak feel).
  float taper = 1.0 - smoothstep(innerR, outerR, rad);
  float lines = lineBody * radialMask * linePresence * taper;
  // animate-on-twos flicker toward the pop end (snappy comic motion).
  float beat = floor(uTimeS * 12.0);
  float flick = mix(1.0, step(0.25, hash11(idx + beat + uSeed)), uStyle * 0.5);
  lines *= flick;

  // Action lines cast a thin streak of light off the hit. White/cool ink at the
  // noir end (a hard glint), the accent hue at the pop end. Kept dim so they
  // read as speed lines around the panel rather than flooding the frame.
  vec3 lineCol = mix(vec3(0.7, 0.74, 0.82), uC2, uStyle);
  col += lineCol * lines * 0.32 * uExposure;

  // ---- STARBURST BALLOON (behind the word) --------------------------------
  // Filled with the secondary hue; gets the strongest Ben-Day shading so it
  // reads as a flat printed color field. In noir it's a pale near-white field
  // with a fine subtle screen; in pop-art it's a saturated yellow/red blast.
  vec3 burstBase = mix(vec3(0.9), uC1, uSaturation);
  // tone for the dots: more dots where the field is "darker" value. We want a
  // lively mid coverage so the classic dot field shows.
  float burstTone = mix(0.35, 0.7, uHalftone);
  float dots = benday(frag, uDotSize, burstTone, radians(15.0) + uSeed);
  // Ben-Day strength: subtle at noir, dominant at pop. The dots ADD the accent
  // color on the printed field.
  vec3 burstCol = burstBase + (uC2 - burstBase) * dots * uHalftone * 0.55;
  col += burstCol * burstFill * uPresence * uExposure;

  // A second, finer rotated screen on the word fill for that printed sheen at
  // the pop end (kept subtle so letters stay legible). The word is the HERO:
  // a bright, saturated fill that screams off the page (pop) or a luminous
  // near-white with a spot tint (noir). Brighter than the burst so it reads
  // as the foreground shout.
  float wordDots = benday(frag, uDotSize * 0.7, 0.5, radians(75.0) + uSeed);
  vec3 wordBright = clamp(uC0 * 1.35 + 0.25, 0.0, 1.4);
  vec3 wordBase = mix(vec3(0.96, 0.97, 1.0), wordBright, clamp(uSaturation + 0.2, 0.0, 1.0));
  vec3 wordCol = wordBase + (uC2 - wordBase) * wordDots * uHalftone * 0.25 * uStyle;
  // Word fill is largely PROTECTED from ink suppression (its own outline should
  // frame it, not eat it), so render it after a softened ink mask below.
  col += wordCol * wordFill * uPresence * uExposure * 1.7;

  // ---- INK ----------------------------------------------------------------
  // Bold black contours. Ink is the ABSENCE of light on a screen-blend canvas,
  // so we can't literally darken the page from here — instead we let ink CARVE
  // the lit shapes (it suppresses the fills it overlaps) and, at the noir end,
  // we add a faint cool rim so the chiaroscuro edge still reads as light catches
  // the ink ridge. The actual black is achieved by NOT lighting those pixels.
  float ink = inkMask * uPresence;
  // Suppress fills under ink (so outlines punch through as unlit black). But
  // where the ink overlaps the WORD fill we soften the carve a lot, so the
  // outline frames the letters instead of eating their bright bodies.
  float carve = ink * (0.96 - 0.7 * wordFill);
  col *= (1.0 - carve);
  // Subtle chiaroscuro rim-light on ink edges toward the noir end (a glint).
  float rim = ink * (1.0 - uStyle) * 0.18;
  col += mix(uC2, vec3(0.8, 0.85, 1.0), 0.5) * rim * uExposure;

  // ---- IMPACT FLASH -------------------------------------------------------
  // A hot radial flash at the moment of impact that throws colored light onto
  // the page (the cast-light proof). Fast spike, quick decay (driven by uFlash).
  float flashFall = exp(-rad / (minDim * 0.42));
  vec3 flashCol = mix(mix(uC0, uC1, 0.5), vec3(1.0), 0.45 + 0.3 * uStyle);
  col += flashCol * flashFall * uFlash * uExposure * 1.4;
  // a tight white-hot core right at the centre on the very first frames.
  float core = exp(-rad / (minDim * 0.10));
  col += vec3(1.0) * core * uFlash * uFlash * 1.6;

  // ---- TONE + FINISH ------------------------------------------------------
  // ACES filmic tonemap (shared look/glsl) for a cleaner highlight rolloff than
  // the old x/(1+x) compress — the impact flash highlights roll off gracefully
  // while the saturated printed mids stay rich. A mild pre-exposure keeps the
  // pop-art color from dimming.
  col = tonemapACES(col * 0.85);

  // Pop-art posterize: snap the lit panel to a few flat ink levels toward the
  // pop end (flat printed color), leaving the dark page untouched so we don't
  // shatter it into camouflage. Noir stays smooth chiaroscuro.
  if (uStyle > 0.001) {
    float lit = smoothstep(0.02, 0.2, max(max(col.r, col.g), col.b));
    vec3 q = floor(col * 4.0 + 0.5) / 4.0;
    col = mix(col, mix(col, q, lit), uStyle * 0.7);
  }

  // Ordered dither (shared look/glsl) to kill banding the screen-blend reveals
  // (faded toward the pop end where the flat printed look is intended).
  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle * 0.7);

  fragColor = vec4(max(col, 0.0), 1.0);
}`;
