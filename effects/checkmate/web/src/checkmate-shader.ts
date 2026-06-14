/**
 * GLSL ES 3.00 source for **Checkmate** — an unapologetically fabulous winning
 * move. A chess QUEEN pops into place with an overshoot bounce and the whole
 * frame ERUPTS in LGBTQ+ pride: an expanding rainbow swoosh-shockwave, a
 * spinning pride sunburst, and a mob of twinkling 4-point sparkle bling.
 *
 * Authored ONCE here; the toolchain transpiles the MSL + Kotlin variants from
 * this single GLSL (`x-build.shader`). The chess queen is drawn ANALYTICALLY
 * from 2D SDF primitives (a flared trapezoid body + base, a collar bar and five
 * crown balls on stems) so it is byte-identical on every backend — no baked SDF,
 * no sampler, no per-platform fallback.
 *
 * Layers, summed as light (canvas is black, `mix-blend-mode: screen`, so black
 * == no change, bright == cast light onto the page beneath):
 *   1. SUNBURST   — radial pride rays spinning behind the queen (uSpin/uRays).
 *   2. SWOOSH     — an expanding rainbow shockwave ring whose hue cycles with
 *                   angle; it bursts outward over life (the "swoosh").
 *   3. QUEEN      — the chess piece, filled with a vertical rainbow gradient +
 *                   a hot white edge, popped in by uPop (overshoot bounce).
 *   4. BLING      — a scatter of twinkling 4-point star glints riding outward
 *                   with the swoosh (the sparkle "bling"), tinted by the palette.
 *   5. FLASH      — a hot radial flash at the instant of the pop.
 *
 * whimsy == uStyle: 0 = smooth photoreal spectral glow; 1 = cel POP-ART — the
 * rainbow posterizes into the canonical 6-stripe pride flag and the bling reads
 * as chunky comic stars. The pass runner already snaps the clock "on twos".
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_HASH,
  GLSL_PALETTE_MIX,
  GLSL_SD_SEG,
  GLSL_TONEMAP_ACES,
} from "@dopaminefx/core";

/** Scatter count for the sparkle bling. Single source of truth for the loop cap. */
export const MAX_SPARKLES = 16;

export const CHECKMATE_VERTEX_SRC = /* glsl */ `#version 300 es
void main() {
  // Single full-screen triangle from gl_VertexID — no vertex buffers needed.
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const CHECKMATE_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;    // device pixels
uniform vec2  uOrigin;        // queen anchor, gl coords (y up)
uniform float uAmp;           // held-breath envelope amplitude (brightness gate)
uniform float uPop;           // easeOutBack pop scale (overshoot bounce -> 1)
uniform float uLife;          // whole-effect progress 0..1
uniform float uTimeS;         // elapsed seconds (snapped "on twos" by style)
uniform float uExposure;      // overall light gain (intensity)
uniform float uBling;         // sparkle density/brightness (intensity)
uniform float uSwoosh;        // rainbow shockwave reach (intensity)
uniform float uRays;          // pride sunburst ray count (integer)
uniform float uSpin;          // sunburst/swoosh rotation speed
uniform float uSizeFrac;      // queen box size as a fraction of min viewport dim
uniform float uSeed;          // per-fire scatter/hue offset
uniform float uStyle;         // 0..1 photoreal spectral -> cel pop-art pride flag
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette
uniform float uShadowSoft;    // penumbra softness in device px (blur tap radius)
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;            // accent palette (sparkle tint) — per fire
uniform vec3  uC1;            // mid
uniform vec3  uC2;            // outer accent

#define MAX_SPARKLES ${MAX_SPARKLES}
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_PALETTE_MIX}
${GLSL_SD_SEG}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}

// ---- The pride spectrum -----------------------------------------------------
// Smooth IQ-cosine rainbow: a continuous, saturated spectral sweep over [0,1).
vec3 prideSmooth(float t){
  t = fract(t);
  return 0.5 + 0.5 * cos(TAU * (t + vec3(0.0, 0.33, 0.67)));
}
// The canonical 6-stripe pride FLAG, posterized from t (red→violet).
vec3 prideFlag(float t){
  t = fract(t);
  if (t < 0.16667) return vec3(0.94, 0.10, 0.12);   // red
  if (t < 0.33333) return vec3(1.00, 0.55, 0.06);   // orange
  if (t < 0.50000) return vec3(1.00, 0.93, 0.10);   // yellow
  if (t < 0.66667) return vec3(0.18, 0.70, 0.22);   // green
  if (t < 0.83333) return vec3(0.10, 0.36, 0.90);   // blue
  return vec3(0.46, 0.12, 0.62);                     // violet
}
// Blend smooth↔flag by whimsy (style): cel end snaps to the 6 flag stripes.
vec3 prideColor(float t, float style){
  return mix(prideSmooth(t), prideFlag(t), style);
}

// ---- 2D SDF primitives for the chess QUEEN silhouette -----------------------
float sdBox(vec2 p, vec2 b){
  vec2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}
// Inigo Quilez trapezoid SDF: half-widths r1 (bottom) and r2 (top), half-height he.
float sdTrapezoid(vec2 p, float r1, float r2, float he){
  vec2 k1 = vec2(r2, he);
  vec2 k2 = vec2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  vec2 ca = vec2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
  vec2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}
// Signed distance to the queen, in LOCAL units (q centered, y up, ~[-1,1]).
// Union (min) of: base foot, flared body, collar band, five crown balls + stems.
float queenDist(vec2 q){
  float d = sdTrapezoid(q - vec2(0.0, -0.74), 0.60, 0.40, 0.12); // base foot
  d = min(d, sdTrapezoid(q - vec2(0.0, -0.10), 0.46, 0.15, 0.50)); // flared body
  d = min(d, sdBox(q - vec2(0.0, 0.40), vec2(0.32, 0.05)) - 0.02); // collar band
  // crown balls (center tallest) + the stems joining them to the band
  d = min(d, length(q - vec2(-0.46, 0.55)) - 0.115);
  d = min(d, length(q - vec2(-0.23, 0.62)) - 0.125);
  d = min(d, length(q - vec2( 0.00, 0.71)) - 0.145);
  d = min(d, length(q - vec2( 0.23, 0.62)) - 0.125);
  d = min(d, length(q - vec2( 0.46, 0.55)) - 0.115);
  d = min(d, sdSeg(q, vec2(-0.46, 0.55), vec2(-0.28, 0.42)) - 0.045);
  d = min(d, sdSeg(q, vec2(-0.23, 0.62), vec2(-0.14, 0.42)) - 0.045);
  d = min(d, sdSeg(q, vec2( 0.00, 0.71), vec2( 0.00, 0.42)) - 0.055);
  d = min(d, sdSeg(q, vec2( 0.23, 0.62), vec2( 0.14, 0.42)) - 0.045);
  d = min(d, sdSeg(q, vec2( 0.46, 0.55), vec2( 0.28, 0.42)) - 0.045);
  return d;
}

// A twinkling 4-point star glint: hot core + two soft anisotropic spikes.
float starGlint(vec2 p, vec2 c, float size){
  vec2 d = (p - c) / max(size, 1e-3);
  float r = length(d);
  float core = exp(-r * r * 5.0);
  float sx = exp(-abs(d.x) * 6.0) * exp(-abs(d.y) * 1.4);
  float sy = exp(-abs(d.y) * 6.0) * exp(-abs(d.x) * 1.4);
  return core + (sx + sy) * 0.7;
}

// ---- Queen coverage (0..1 fill) at a fragment, with the pop scale applied ----
float queenFill(vec2 frag){
  float R = min(uResolution.x, uResolution.y) * uSizeFrac;
  float scale = mix(0.34, 1.0, clamp(uPop, 0.0, 1.4));      // bounce-in scale
  vec2 q = (frag - uOrigin) / max(R, 1e-3) / max(scale, 1e-3);
  float d = queenDist(q);
  float aa = 1.6 / max(R, 1e-3);                            // ~1.6 device px, local units
  return smoothstep(aa, -aa, d);
}

// ---- SHADOW silhouette — the queen casts a soft offset occlusion. -----------
float occlusion(vec2 frag){
  return clamp(queenFill(frag) * uAmp, 0.0, 1.0);
}
vec4 shadowColor(vec2 frag){
  vec2 sp = frag - uShadowOffset;
  float s = uShadowSoft;
  float occ = occlusion(sp);
  occ += occlusion(sp + vec2(s, 0.0));
  occ += occlusion(sp + vec2(-s, 0.0));
  occ += occlusion(sp + vec2(0.0, s));
  occ += occlusion(sp + vec2(0.0, -s));
  occ /= 5.0;
  float dark = clamp(occ, 0.0, 1.0) * uShadowStrength;
  // A faintly warm, regal shadow tint (not a flat grey).
  vec3 tint = mix(vec3(1.0), vec3(0.74, 0.70, 0.78), 1.0);
  vec3 mul = mix(vec3(1.0), tint, dark);
  return vec4(mul, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  float minDim = min(uResolution.x, uResolution.y);

  if (uShadow > 0.5) { fragColor = shadowColor(frag); return; }

  vec2 rel = frag - uOrigin;
  float r = length(rel);
  float rn = r / minDim;                          // normalized radius
  float theta = atan(rel.y, rel.x);               // -PI..PI
  float gain = uAmp * uExposure;
  float style = uStyle;

  vec3 col = vec3(0.0);

  // ---- 1. PRIDE SUNBURST: spinning radial rays behind the queen. ----
  float rayN = max(uRays, 1.0);
  float rays = 0.5 + 0.5 * cos(theta * rayN - uTimeS * uSpin * 2.4);
  rays = pow(clamp(rays, 0.0, 1.0), mix(2.2, 5.0, style));   // crisper on the cel end
  float rayMask = smoothstep(0.02, 0.16, rn) * (1.0 - smoothstep(0.30, 0.62, rn));
  vec3 rayCol = prideColor(theta / TAU + 0.5 + uSeed, style);
  col += rayCol * rays * rayMask * gain * 0.5;

  // ---- 2. RAINBOW SWOOSH: an expanding shockwave ring whose hue cycles with
  // angle. It bursts outward over life and widens as it goes — the "swoosh". ----
  float front = uSwoosh * (0.10 + 0.78 * uLife);
  float width = 0.035 + 0.16 * uLife;
  float dr = (rn - front) / max(width, 1e-3);
  float ring = exp(-dr * dr);
  vec3 ringCol = prideColor(theta / TAU + uSpin * uTimeS * 0.15 + uSeed, style);
  col += ringCol * ring * gain * 1.35;
  // a brighter leading lip on the ring's outer edge (the wet swoosh shine)
  col += vec3(1.0) * smoothstep(0.0, 1.0, ring) * smoothstep(0.0, -1.2, dr) * gain * 0.35;

  // ---- 3. THE QUEEN: filled with a vertical rainbow + a hot white edge. ----
  float R = minDim * uSizeFrac;
  float scale = mix(0.34, 1.0, clamp(uPop, 0.0, 1.4));
  vec2 q = rel / max(R, 1e-3) / max(scale, 1e-3);
  float dq = queenDist(q);
  float aa = 1.6 / max(R, 1e-3);
  float fill = smoothstep(aa, -aa, dq);
  float edge = smoothstep(aa * 2.5, 0.0, abs(dq));          // bright rim line
  float halo = exp(-max(dq, 0.0) / 0.06);                   // soft outer glow
  // vertical rainbow over the piece + a slow shimmer; whimsy → flag stripes.
  float qt = q.y * 0.42 + 0.5 + uSeed + uTimeS * 0.05;
  vec3 body = prideColor(qt, style);
  vec3 queenCol = body * fill * 1.45                         // saturated rainbow fill
                + mix(body, vec3(1.0), 0.6) * edge * 0.8     // bright (tinted) edge
                + body * halo * 0.55;                        // coloured glow
  // a brief white core just after the bounce so she "lands" with a flash
  queenCol += vec3(1.0) * fill * (1.0 - smoothstep(0.0, 0.22, uLife)) * 0.35;
  col += queenCol * (uExposure * (0.35 + 0.65 * uAmp));

  // ---- 4. SPARKLE BLING: twinkling 4-point stars riding outward. ----
  float sparkleReach = (0.16 + 0.62 * uLife) * minDim;
  vec3 bling = vec3(0.0);
  for (int i = 0; i < MAX_SPARKLES; i++) {
    float fi = float(i);
    vec2 h = hash21(fi * 3.17 + uSeed * 31.0);
    float ang = h.x * TAU;
    float rad = (0.45 + 0.55 * h.y) * sparkleReach;          // spread out as life grows
    vec2 pos = uOrigin + vec2(cos(ang), sin(ang)) * rad;
    // twinkle: each sparkle blinks on its own phase
    float ph = h.x * 17.0 + h.y * 9.0;
    float tw = pow(0.5 + 0.5 * sin(uTimeS * 7.0 + ph), mix(3.0, 7.0, style));
    float sz = minDim * (0.012 + 0.018 * h.y) * (0.8 + 0.5 * uBling);
    float g = starGlint(frag, pos, sz) * tw;
    // tint with the per-fire accent palette, biased bright (white-hot core).
    vec3 tint = mix(vec3(1.0), paletteMix(fract(fi * 0.137 + uSeed)), 0.55);
    bling += tint * g;
  }
  col += bling * uBling * gain * 0.9;

  // ---- 5. POP FLASH: a hot radial flash at the instant of the bounce. ----
  float flashT = 1.0 - smoothstep(0.0, 0.22, uLife);
  float flash = exp(-rn * rn * 26.0) * flashT;
  col += mix(vec3(1.0), prideColor(uTimeS * 0.3 + uSeed, style), 0.4) * flash * uExposure * 1.4;

  // ---- Filmic tonemap + finishing ----
  col = tonemapACES(col * 0.95);
  // Ordered dither (~1/255) to kill banding the screen blend reveals; faded out
  // toward the cel/pop-art end where hard flag bands are intended.
  col = ditherAdd(col, frag, uTimeS, 1.0 - style);

  fragColor = vec4(max(col, 0.0), 1.0);
}`;
