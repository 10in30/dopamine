/**
 * GLSL ES 3.00 source for Lightning (web, PANEL architecture).
 *
 * The jagged bolt (main trunk + forks) is rasterized into an offscreen Canvas2D
 * panel each frame (see lightning-renderer.ts) — its fragment-INDEPENDENT polyline
 * computed ONCE in JS rather than re-walked (with TWO 4-octave fbm per segment)
 * at every pixel. This shader is now a cheap O(pixels) pass: it SAMPLES the panel
 * (R = soft halo, G = hot core), maps it through the electric colour ramp, and
 * adds the parts that genuinely want to be full-screen procedural —
 *   - the white-hot core,
 *   - the radial IMPACT glow at the strike point,
 *   - the hard near-white STROBE FLASH (re-pulsing on the flicker beats),
 *   - the filmic tonemap + cel flatten + dither finish,
 *   - and the soft cast shadow on the multiply pass.
 *
 * Why: the old single-pass design evaluated ~220 fbm PER PIXEL (8 bolts × 14
 * segments × 2 fbm), plus the shadow pass re-walked it 9× — fine on a GPU but
 * ~1.1 s/frame under software/ANGLE WebGL. (The Swift/Metal lightning keeps its
 * analytic GPU pass; this change is web-only, and the .dope is unchanged.)
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_HASH,
  GLSL_TONEMAP_ACES,
} from "@dopamine/core";

/** Max secondary forks — shared by the panel renderer's loop + the `.dope` clamp. */
export const MAX_FORKS = 7;

/** Polyline segment count of the main bolt (and forks). More = jaggier arc. */
export const BOLT_SEGS = 14;

export const LIGHTNING_VERTEX_SRC = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const LIGHTNING_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPanel;     // R = soft halo (glow), G = hot core
uniform vec2  uResolution;    // device pixels
uniform vec2  uCenter;        // strike point (device px, matches the panel anchor)
uniform float uStrike;        // bolt strike progress 0..1
uniform float uFlash;         // strobe/flash amplitude
uniform float uLife;          // whole-effect progress 0..1
uniform float uTimeS;         // elapsed seconds
uniform float uAmp;           // impact envelope amplitude (peaks > 1)
uniform float uThickness;     // bolt half-width as fraction of min dim (impact sizing)
uniform float uFlashBright;   // peak flash brightness multiplier
uniform float uExposure;      // overall light gain
uniform float uStyle;         // 0..1 photoreal plasma -> cel comic bolt (whimsy)
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette
uniform float uShadowSoft;    // penumbra softness in device px
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;            // electric core hue

${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}

// Electric channel colour ramp (tight blue/violet -> hot white), anchored on uC0
// so the bolt stays monochromatic electric rather than crossing the roaming
// golden-angle palette. t in 0..1 (0 = outer halo, 1 = white-hot core).
vec3 elecRamp(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 rim = mix(uC0, vec3(0.45, 0.6, 1.0), 0.35);
  vec3 mid = mix(uC0, vec3(0.8, 0.85, 1.0), 0.5);
  vec3 hot = vec3(1.0);
  return t < 0.5 ? mix(rim, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
}

void main(){
  vec2 frag = vUv * uResolution;
  float minDim = min(uResolution.x, uResolution.y);

  // ---- SHADOW pass (multiply layer) --------------------------------------
  if (uShadow > 0.5) {
    vec2 px = 1.0 / uResolution;
    vec2 souv = vUv - uShadowOffset * px;
    float occ = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * TAU;
      vec2 tuv = souv + vec2(cos(a), sin(a)) * uShadowSoft * px;
      vec2 inb = step(vec2(0.0), tuv) * step(tuv, vec2(1.0));
      vec3 s = texture(uPanel, tuv).rgb;
      occ += clamp(s.r + s.g, 0.0, 1.0) * inb.x * inb.y;
    }
    occ /= 8.0;
    float dark = clamp(occ * uAmp, 0.0, 1.0) * uShadowStrength;
    vec3 tint = mix(vec3(1.0), 0.55 + 0.45 * normalize(elecRamp(0.2) + 1e-3), 0.25);
    fragColor = vec4(mix(vec3(1.0), tint, dark), 1.0);
    return;
  }

  // ---- LIGHT pass --------------------------------------------------------
  vec4 panel = texture(uPanel, vUv);
  float glow = panel.r;
  float core = panel.g;
  float gain = uExposure * uAmp;

  vec3 col = vec3(0.0);
  float haloT = clamp(glow * 0.8 + 0.12, 0.0, 1.0);
  col += elecRamp(haloT) * glow * gain * 1.3;
  col += vec3(1.0) * core * gain * 2.4;

  // IMPACT GLOW — a bright radial burst at the strike point, easing off after it lands.
  float dB = length(frag - uCenter);
  float landed = smoothstep(0.7, 1.0, uStrike) * (0.4 + 0.6 * (1.0 - smoothstep(0.1, 0.5, uLife)));
  float impact = (minDim * uThickness * 2.0) / (dB + minDim * uThickness * 1.4);
  impact *= impact;
  col += elecRamp(0.7) * impact * landed * gain * 0.8;

  // FLASH / STROBE — hard near-white wash, hottest at the strike point.
  float flashRadial = 0.28 + 0.72 * exp(-dB / (minDim * 0.5));
  vec3 flashCol = mix(vec3(1.0), elecRamp(0.6), 0.25);
  col += flashCol * uFlash * uFlashBright * flashRadial;

  col = tonemapACES(col * 0.9);

  // Cel flatten toward the whimsy end: posterize the lit bolt forms (leave the
  // dark page + the strobe wash alone so we don't shatter them into blocks).
  if (uStyle > 0.001) {
    float boltMask = clamp(glow + core, 0.0, 1.0);
    float bands = mix(40.0, 5.0, uStyle);
    vec3 q = floor(col * bands + 0.5) / bands;
    col = mix(col, mix(col, q, boltMask), uStyle);
  }

  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);
  fragColor = vec4(max(col, 0.0), 1.0);
}`;
