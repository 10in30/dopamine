/**
 * GLSL ES 3.00 source for the FAIL / error effect — the emotional OPPOSITE of
 * the three success effects.
 *
 * A red/amber ✗ cross is STAMPED in light over a tight, recoiling error flare;
 * the whole frame desaturates and collapses fast. A new shader (the fail *feel*
 * is distinct), but it borrows the shared look chunks (hash/dither/tonemap/
 * palette/segment-SDF) and — crucially — its ✗ ICON is sampled from the baked
 * SDF (the Phase-1 geometry seam, uSdfTex), driven by the .dope `svgPath`.
 *
 * Light pass (screen blend): the cross + a hot rim + a short angry flare summed
 * as light. Shadow pass (multiply): the cross silhouette + flare mass, so the
 * error casts real light AND shadow on the page beneath. whimsy is the
 * photoreal↔glitch axis: 0 = soft photographic flare; 1 = a desaturated,
 * RGB-split, scanline GLITCH collapse (cel/stylized error).
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_HASH,
  GLSL_PALETTE_MIX,
  GLSL_SD_SEG,
  GLSL_TONEMAP_ACES,
} from "@dopamine/core";

export const FAIL_VERTEX_SRC = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FAIL_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;   // device pixels
uniform vec2  uOrigin;       // cross center, gl coords (y up)
uniform float uAmp;          // fail envelope amplitude 0..1
uniform float uStamp;        // ✗ stamp/slash progress 0..1
uniform float uLife;         // total normalized progress 0..1
uniform float uTimeS;        // elapsed seconds
uniform float uShake;        // signed recoil shake (-1..1), pre-scaled by intensity
uniform float uExposure;
uniform float uSeverity;     // 0..1 intensity (size/heat of the flare + rim)
uniform float uStyle;        // 0..1 photoreal -> glitch/desaturated collapse
uniform float uShadow;       // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;
uniform float uShadowSoft;
uniform float uShadowStrength;
uniform vec3  uC0;           // error palette (hot core)
uniform vec3  uC1;           // mid
uniform vec3  uC2;           // outer/accent
uniform sampler2D uSdfTex;   // baked ✗ outline SDF (R = normalized distance)
uniform float uSdfOn;        // 1 = drive the cross from the baked SDF
uniform float uSdfRangePx;   // device px mapping to the SDF's 0..1 distance range
uniform float uSdfStrokePx;  // half stroke width (device px)
uniform float uBoxPx;        // half-size of the SDF box around uOrigin (device px)

${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_PALETTE_MIX}
${GLSL_SD_SEG}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}

// Map a device-pixel sample to the SDF box UV (origin bottom-left, y up).
vec2 boxUV(vec2 frag){ return (frag - uOrigin) / (2.0 * uBoxPx) + 0.5; }

// ✗ stroke distance (device px) from the baked SDF, or an analytic two-bar
// fallback when no SDF is bound. Both reveal as a fast diagonal "slash" stamp.
float crossDist(vec2 frag){
  if (uSdfOn > 0.5) {
    vec2 uv = boxUV(frag);
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 1e9;
    return texture(uSdfTex, uv).r * uSdfRangePx;
  }
  // Analytic ✗: two diagonal bars (fallback if the SDF failed to bake/load).
  float r = uBoxPx * 0.62;
  vec2 a1 = uOrigin + vec2(-r, -r), b1 = uOrigin + vec2(r, r);
  vec2 a2 = uOrigin + vec2(-r,  r), b2 = uOrigin + vec2(r, -r);
  return min(sdSeg(frag, a1, b1), sdSeg(frag, a2, b2));
}

// The ✗ is stamped along a diagonal slash: the \\ bar reveals first, then the /.
// Returns a 0..1 reveal gate at this point given the stamp progress.
float stampGate(vec2 frag){
  vec2 uv = boxUV(frag) - 0.5;            // -0.5..0.5
  // Slash axis: lower-left -> upper-right then the second bar. Use |.| so both
  // diagonals fill outward from the center as the stamp lands.
  float axis = clamp(0.5 + 0.5 * (abs(uv.x) + abs(uv.y)), 0.0, 1.0);
  float frontier = uStamp * 1.15;
  return smoothstep(frontier, frontier - 0.12, axis);
}

// Tight angry error flare around the cross — collapses with uAmp. Hotter +
// larger with severity. Unlike the bloom, this stays compact and punchy.
float flare(vec2 frag, float minDim){
  float d = length(frag - uOrigin);
  float r = minDim * mix(0.16, 0.30, uSeverity);
  float dn = d / r;
  return (exp(-dn * dn * 2.2) * 0.9 + exp(-dn * 1.6) * 0.25);
}

float occlusion(vec2 p, float minDim){
  float occ = flare(p, minDim) * 0.7;
  float dc = crossDist(p);
  occ += (1.0 - smoothstep(uSdfStrokePx * 0.6, uSdfStrokePx * 1.5, dc)) * stampGate(p) * 0.9;
  return clamp(occ * uAmp, 0.0, 1.0);
}

vec4 shadowColor(vec2 frag){
  float minDim = min(uResolution.x, uResolution.y);
  vec2 sp = frag - uShadowOffset;
  float occ = occlusion(sp, minDim);
  float s = uShadowSoft;
  occ += occlusion(sp + vec2(s,0.0), minDim);
  occ += occlusion(sp + vec2(-s,0.0), minDim);
  occ += occlusion(sp + vec2(0.0,s), minDim);
  occ += occlusion(sp + vec2(0.0,-s), minDim);
  occ /= 5.0;
  float dark = clamp(occ, 0.0, 1.0) * uShadowStrength;
  // A cold, slightly desaturated shadow tint (error grey, not coloured glow).
  vec3 tint = mix(vec3(1.0), vec3(0.72, 0.66, 0.66), 1.0);
  vec3 mul = mix(vec3(1.0), tint, dark);
  return vec4(mul, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  float minDim = min(uResolution.x, uResolution.y);

  if (uShadow > 0.5) { fragColor = shadowColor(frag); return; }

  // Recoil SHAKE: jitter the whole sample horizontally (a "no" head-shake), plus
  // a per-frame glitch slice offset toward the stylized end.
  float shakePx = uShake * minDim * 0.012;
  float glitch = 0.0;
  if (uStyle > 0.001) {
    float band = floor(frag.y / max(2.0, minDim * 0.02));
    float g = hash11(band + floor(uTimeS * 30.0));
    glitch = (step(0.82, g) * (g - 0.82) / 0.18) * minDim * 0.05 * uStyle * uAmp;
  }
  vec2 sf = frag - vec2(shakePx + glitch, 0.0);

  vec3 col = vec3(0.0);

  // ---- Angry error flare (summed as light) --------------------------------
  // The error palette is generated OKLCH biased to reds/ambers; we keep the
  // flare IN-BAND by ramping the HOT core hue (uC0) from bright at the center to
  // a deeper ember toward the rim (instead of fanning to the golden-angle stops,
  // which would drift out of the error band). uC0 still varies per fire.
  float fl = flare(sf, minDim);
  float rn = clamp(length(sf - uOrigin) / (minDim * 0.3), 0.0, 1.0);
  vec3 ember = uC0 * mix(1.0, 0.45, rn);          // bright core → deep ember rim
  col += ember * fl * uAmp * uExposure * mix(0.9, 1.25, uSeverity);

  // ---- The ✗ cross, stamped in light --------------------------------------
  float dc = crossDist(sf);
  float gate = stampGate(sf);
  float sw = uSdfStrokePx;
  float soft = smoothstep(sw, sw * 0.3, dc);
  float hard = 1.0 - smoothstep(sw * 0.85, sw, dc);
  float core = mix(soft, hard, uStyle) * gate;
  float rim = exp(-dc / (sw * 2.2)) * 0.7 * gate;
  // The baked SDF saturates (distance clamps) beyond its encoded range, so the
  // soft rim's exp() never reaches zero inside the box — leaving a faint ghost
  // BOX fill over the whole SDF region. Fade the rim out at the range edge so it
  // stays a glow around the strokes, not a box. (No-op for the analytic fallback,
  // whose distance is unbounded.)
  rim *= 1.0 - smoothstep(uSdfRangePx * 0.55, uSdfRangePx * 0.9, dc);
  // The cross is the unambiguous "no" — it must out-shine the flare. Hot white
  // core biased toward the error hue; a sharp rim sells the stamp.
  vec3 crossTint = mix(vec3(1.0), uC0 + 0.35, 0.5);
  float collapse = 1.0 - smoothstep(0.6, 1.0, uLife);
  col += (vec3(1.0) * core * 1.7 + crossTint * rim) * collapse * uExposure;

  // A hot stamp FLASH at the instant of impact (first ~1/3 of the stamp).
  float flash = exp(-uStamp * 6.0) * (1.0 - uStamp);
  col += crossTint * flash * core * 1.2 * uExposure;

  // ---- Filmic tonemap -----------------------------------------------------
  col = tonemapACES(col * 0.7);

  // ---- Stylized GLITCH / DESATURATE collapse (whimsy) ----------------------
  if (uStyle > 0.001) {
    // RGB split along the shake axis.
    float sep = minDim * 0.004 * uStyle * uAmp;
    float dr = crossDist(sf - vec2(sep, 0.0));
    float db = crossDist(sf + vec2(sep, 0.0));
    float gr = (1.0 - smoothstep(sw*0.85, sw, dr)) * gate * collapse;
    float gb = (1.0 - smoothstep(sw*0.85, sw, db)) * gate * collapse;
    col.r = max(col.r, gr * 1.2 * uExposure);
    col.b = max(col.b, gb * 1.2 * uExposure);
    // Desaturate the whole frame toward a sick grey as it collapses.
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(l), uStyle * 0.5 * smoothstep(0.4, 1.0, uLife));
    // Scanlines.
    float scan = 0.92 + 0.08 * sin(frag.y * 3.14159);
    col *= mix(1.0, scan, uStyle * 0.6);
  }

  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);
  fragColor = vec4(col, 1.0);
}`;
