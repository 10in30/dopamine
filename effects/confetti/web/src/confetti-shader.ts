/**
 * GLSL ES 3.00 source for Confetti (web, PANEL architecture).
 *
 * The paper pieces are rasterized into an offscreen Canvas2D panel each frame
 * (see confetti-renderer.ts) — each piece's pose + lit colour computed ONCE in JS
 * rather than re-derived at every pixel. This shader is now a cheap O(pixels)
 * pass: it SAMPLES that panel and applies only the screen-space finish that wants
 * to be procedural —
 *   - the global gain (envelope amp × exposure) + filmic ACES tonemap so dense
 *     bursts roll off gracefully on the screen-blend page,
 *   - the cel posterize / saturation punch toward the whimsy (cel) end,
 *   - an ordered dither to kill screen-blend banding,
 *   - and a cheap soft drop-shadow on the multiply pass (a ring-blurred sample of
 *     the panel's mass, offset toward the implied light).
 *
 * Why: the old single-pass design looped MAX_PIECES at every fragment
 * (O(pixels × pieces)) which is fine on a GPU but crawls under software/ANGLE
 * WebGL. Sampling a pre-rasterized panel makes the per-pixel cost independent of
 * piece count. Mirrors the comic/heartburst hybrid effects. (The Swift/Metal
 * confetti keeps its analytic GPU pass — this change is web-only; the .dope is
 * unchanged across platforms.)
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_HASH,
  GLSL_TONEMAP_ACES,
} from "@dopaminefx/core";

/**
 * Max confetti pieces. Single source of truth: BOTH the panel renderer's loop
 * bound and the integer-clamp const the `.dope` mapping references (passed to the
 * loader as `MAX_PIECES`). Counts above this won't render.
 */
export const MAX_PIECES = 120;

export const CONFETTI_VERTEX_SRC = /* glsl */ `#version 300 es
out vec2 vUv;
void main() {
  // Single full-screen triangle from gl_VertexID — no vertex buffers needed.
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = pos;
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const CONFETTI_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uPanel;     // RGB = accumulated per-piece lit colour × fade
uniform vec2  uResolution;    // device pixels
uniform float uAmp;           // envelope amplitude (peaks > 1) — overall brightness
uniform float uTimeS;         // elapsed seconds (snapped "on twos" with style)
uniform float uExposure;
uniform float uStyle;         // 0..1 photoreal paper -> flat cel shapes
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette
uniform float uShadowSoft;    // penumbra softness in device px (blur tap radius)
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;

${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}

void main() {
  vec2 frag = vUv * uResolution;

  // ---- SHADOW pass (multiply layer) --------------------------------------
  // A cheap soft drop-shadow: ring-blur the panel's mass at a sample point pushed
  // against the light offset. White = no shadow; darker = cast silhouette.
  if (uShadow > 0.5) {
    vec2 px = 1.0 / uResolution;
    vec2 souv = vUv - uShadowOffset * px;
    float occ = 0.0;
    for (int i = 0; i < 8; i++) {
      float a = float(i) / 8.0 * TAU;
      vec2 o = vec2(cos(a), sin(a)) * uShadowSoft * px;
      vec2 tuv = souv + o;
      vec2 inb = step(vec2(0.0), tuv) * step(tuv, vec2(1.0));
      vec3 s = texture(uPanel, tuv).rgb;
      occ += (s.r + s.g + s.b) * (1.0 / 3.0) * inb.x * inb.y;
    }
    occ /= 8.0;
    float dark = clamp(occ * uAmp, 0.0, 1.0) * uShadowStrength;
    vec3 tint = mix(vec3(1.0), 0.6 + 0.4 * normalize(uC0 + 1e-3), 0.2);
    vec3 mul = mix(vec3(1.0), tint, dark);
    fragColor = vec4(mul, 1.0);
    return;
  }

  // ---- LIGHT pass --------------------------------------------------------
  // The panel already holds Σ(lit × fade) per piece; apply the global gain, then
  // the same filmic + cel + dither finish the original single-pass shader did.
  vec3 col = texture(uPanel, vUv).rgb * (uAmp * uExposure) * 1.35;

  col = tonemapACES(col * 0.85);

  // Cel posterize at the whimsy end: punch saturation + quantize into hard bands.
  if (uStyle > 0.001) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 neon = clamp(l + (col - l) * 1.5, 0.0, 1.0);
    vec3 styled = mix(col, neon, 0.65);
    float bands = mix(40.0, 5.0, uStyle);
    styled = floor(styled * bands + 0.5) / bands;
    col = mix(col, styled, uStyle);
  }

  // Ordered dither to break screen-blend banding; faded toward the cel end.
  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);

  fragColor = vec4(col, 1.0);
}`;
