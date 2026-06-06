/**
 * GLSL ES 3.00 source for Solarbloom.
 *
 * One full-screen pass renders three layers, all summed as light (the canvas is
 * black and composited with `mix-blend-mode: screen`, so black == no change and
 * bright == cast light):
 *   1. a volumetric radial bloom from the success point,
 *   2. drifting light "motes" on buoyant, curling paths (natural motion),
 *   3. a checkmark drawn in light (the unambiguous confirmation).
 *
 * Mote motion is trig-based rather than noise-textured on purpose — it keeps the
 * inner loop cheap enough to stay smooth even under software (SwiftShader) WebGL.
 */

export const VERTEX_SRC = /* glsl */ `#version 300 es
void main() {
  // Single full-screen triangle from gl_VertexID — no vertex buffers needed.
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;   // device pixels
uniform vec2  uOrigin;       // bloom origin, gl coords (y up)
uniform float uAmp;          // envelope amplitude (peaks > 1)
uniform float uCheck;        // checkmark draw progress 0..1
uniform float uLife;         // total normalized progress 0..1
uniform float uTimeS;        // elapsed seconds
uniform float uExposure;
uniform float uBloomRadius;  // fraction of min viewport dim
uniform float uTurbulence;
uniform float uMoteSpeed;
uniform float uMoteCount;
uniform float uMoteSeed;
uniform vec3  uC0;
uniform vec3  uC1;
uniform vec3  uC2;

#define MAX_MOTES 80
#define TAU 6.28318530718

float hash11(float p){ p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
vec2 hash21(float p){
  vec3 p3 = fract(vec3(p) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash11(dot(i, vec2(1.0, 57.0)));
  float b = hash11(dot(i + vec2(1.0, 0.0), vec2(1.0, 57.0)));
  float c = hash11(dot(i + vec2(0.0, 1.0), vec2(1.0, 57.0)));
  float d = hash11(dot(i + vec2(1.0, 1.0), vec2(1.0, 57.0)));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
vec3 paletteMix(float t){
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uC0, uC1, t * 2.0) : mix(uC1, uC2, (t - 0.5) * 2.0);
}
float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  float minDim = min(uResolution.x, uResolution.y);
  float r = uBloomRadius * minDim;
  vec3 col = vec3(0.0);

  // ---- Volumetric bloom ----
  vec2 rel = frag - uOrigin;
  float ang = atan(rel.y, rel.x);
  float d = length(rel);
  float warp = fbm(vec2(ang * 1.5, uTimeS * 0.3) + uMoteSeed) - 0.5;
  float dn = d / r * (1.0 + 0.25 * warp);
  float core = exp(-dn * dn * 2.2);
  float halo = exp(-dn * 1.3) * 0.5;
  col += paletteMix(dn * 0.9) * (core + halo) * uAmp * uExposure;

  // ---- Drifting light motes ----
  for (int i = 0; i < MAX_MOTES; i++) {
    if (float(i) >= uMoteCount) break;
    vec2 h = hash21(float(i) * 13.17 + uMoteSeed);
    float a0 = h.x * TAU;
    float spd = 0.5 + h.y;
    float delay = hash11(float(i) * 7.7 + uMoteSeed) * 0.15;
    float life = clamp((uLife - delay) / (1.0 - delay), 0.0, 1.0);
    if (life <= 0.0) continue;
    vec2 dir = vec2(cos(a0), sin(a0));
    float travel = life * spd * uMoteSpeed * r * 1.3;
    vec2 buoy = vec2(0.0, life * life * r * 0.5);              // float upward
    float t1 = a0 * 3.0 + life * TAU * spd;
    vec2 curl = vec2(sin(t1), cos(t1 * 0.8 + a0)) * uTurbulence * r * 0.3 * life;
    vec2 pos = uOrigin + dir * travel + buoy + curl;
    float dist = length(frag - pos);
    float size = minDim * 0.006 * (0.6 + h.x * 0.8);
    float spark = size / (dist + size * 0.5);
    spark *= spark;
    float fade = (1.0 - pow(life, 1.3)) * smoothstep(0.0, 0.08, life);
    col += paletteMix(h.y) * spark * fade * uAmp * uExposure * 1.2;
  }

  // ---- Checkmark drawn in light ----
  float cr = minDim * 0.11;
  vec2 A = uOrigin + cr * vec2(-0.9, 0.15);
  vec2 B = uOrigin + cr * vec2(-0.25, -0.55);
  vec2 C = uOrigin + cr * vec2(1.0, 0.78);
  float l1 = length(B - A), l2 = length(C - B);
  float total = l1 + l2;
  float drawn = uCheck * total;
  float vis1 = clamp(drawn, 0.0, l1);
  float dseg = sdSeg(frag, A, A + (B - A) * (vis1 / l1));
  if (drawn > l1) {
    float d2 = clamp(drawn - l1, 0.0, l2);
    dseg = min(dseg, sdSeg(frag, B, B + (C - B) * (d2 / l2)));
  }
  float sw = cr * 0.12;
  float ccore = smoothstep(sw, sw * 0.4, dseg);
  float cglow = exp(-dseg / (sw * 2.2)) * 0.6;
  float cFade = 1.0 - smoothstep(0.7, 1.0, uLife);
  vec3 checkTint = mix(vec3(1.0), uC0 + 0.4, 0.5);
  col += (vec3(1.0) * ccore + checkTint * cglow) * cFade * uExposure;

  // ---- Soft filmic clamp (keeps brights, avoids hard clipping) ----
  col = vec3(1.0) - exp(-col);
  fragColor = vec4(col, 1.0);
}`;
