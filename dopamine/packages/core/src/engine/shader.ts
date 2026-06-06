/**
 * GLSL ES 3.00 source for Solarbloom.
 *
 * One full-screen pass renders several layers, all summed as light (the canvas
 * is black and composited with `mix-blend-mode: screen`, so black == no change
 * and bright == cast light onto the page beneath):
 *   1. a volumetric, domain-warped FBM bloom with angular light shafts and a
 *      chromatic / spectral split + iridescent thin-film shimmer at its edge,
 *   2. drifting light "motes" on buoyant, curling paths — depth-layered, with
 *      velocity-aligned motion-blur streaks and per-mote twinkle,
 *   3. a checkmark drawn in light, with a bright leading spark + afterglow.
 * A filmic (ACES-ish) tonemap and an ordered dither finish the frame, killing
 * the banding that a smooth radial gradient would otherwise show.
 *
 * It is deliberately a single fragment pass: under software WebGL (SwiftShader)
 * a multi-pass FBO blur is the expensive thing, whereas analytic noise/SDF math
 * stays cheap and is identical frame-to-frame (pure function of uTimeS).
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
uniform float uIridescence;  // 0..1 thin-film shimmer strength
uniform float uDispersion;   // 0..1 spectral split strength at the bloom edge
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
  // 4 octaves with a gentle rotation per octave kills axis-aligned artifacts.
  mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p = rot * p * 2.03; a *= 0.5; }
  return s;
}

vec3 paletteMix(float t){
  t = clamp(t, 0.0, 1.0);
  return t < 0.5 ? mix(uC0, uC1, t * 2.0) : mix(uC1, uC2, (t - 0.5) * 2.0);
}

// Inigo Quilez cosine palette — a smooth spectral sweep used for the thin-film
// iridescence so the shimmer cycles through complementary hues, not the
// mood palette (that contrast is what makes it read as "oil on water").
vec3 iridescent(float t){
  return 0.55 + 0.45 * cos(TAU * (vec3(1.0) * t + vec3(0.0, 0.33, 0.67)));
}

float sdSeg(vec2 p, vec2 a, vec2 b){
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * h);
}

// Radial bloom intensity at a normalized radius dn (1.0 == bloom edge). Sampled
// three times at channel-shifted radii to get a spectral split at the rim.
float bloomProfile(float dn){
  // Softened central spike (a flatter core) so the very middle keeps its
  // palette colour and doesn't clip to white — leaving room for the checkmark
  // to read as the brightest thing at the centre.
  float core = exp(-dn * dn * 2.4) * 0.92;
  float halo = exp(-dn * 1.3) * 0.5;
  return core + halo;
}

// ACES filmic tonemap (Narkowicz approximation) — richer rolloff than 1-exp,
// keeps highlights from going chalky while preserving saturated mid-lights.
vec3 tonemapACES(vec3 x){
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  float minDim = min(uResolution.x, uResolution.y);
  float r = uBloomRadius * minDim;
  vec3 col = vec3(0.0);

  vec2 rel = frag - uOrigin;
  float ang = atan(rel.y, rel.x);
  float d = length(rel);
  vec2 ndir = rel / max(d, 1e-4);

  // ---- Volumetric bloom: domain-warped FBM + spectral edge + iridescence ----
  // Two-level domain warp: warp the sample point by an fbm-derived offset, then
  // sample fbm again. This gives the smoke-like, living interior of a real bloom
  // instead of a clean gaussian.
  vec2 sp = vec2(ang * 1.6, d / r * 2.2) + uMoteSeed;
  vec2 warp = vec2(fbm(sp + uTimeS * 0.18), fbm(sp.yx - uTimeS * 0.12)) - 0.5;
  float fbmTex = fbm(sp + warp * 1.2 * uTurbulence + uTimeS * 0.25);
  // The warp perturbs the radius only modestly, so the core stays a focused
  // burst rather than blooming into an all-over haze.
  float dn = d / r * (1.0 + 0.18 * (fbmTex - 0.5) * uTurbulence);

  // Spectral split: sample the radial falloff at slightly different radii per
  // channel. Strength grows toward the rim (where dn ~ 1) — like dispersion at
  // a refractive edge — and is gated by uDispersion + amplitude.
  float disp = uDispersion * (0.06 + 0.12 * smoothstep(0.2, 1.1, dn)) * (0.7 + 0.5 * uAmp);
  float pr = bloomProfile(dn * (1.0 - disp));
  float pg = bloomProfile(dn);
  float pb = bloomProfile(dn * (1.0 + disp));
  vec3 spectral = vec3(pr, pg, pb);

  // Tint the bloom by the palette (inner→outer) and modulate by the spectral
  // split so the rim fringes into chromatic color.
  vec3 bloomTint = paletteMix(dn * 0.9);
  // Filaments / faint god-ray shafts: an angular noise field, sharpened, that
  // streaks outward and rotates slowly. Subtle, fades with radius.
  float shafts = fbm(vec2(ang * 5.0 + uTimeS * 0.2, d / r * 1.5));
  shafts = pow(smoothstep(0.4, 0.95, shafts), 2.0);
  float shaftFall = exp(-dn * 1.3) * smoothstep(0.05, 0.5, dn);
  float bloomGain = uAmp * uExposure;
  col += bloomTint * spectral * bloomGain;
  col += bloomTint * shafts * shaftFall * 0.3 * bloomGain * (0.5 + 0.5 * uTurbulence);

  // Iridescent thin-film shimmer riding on the bloom shell. Rather than adding
  // full-spectrum light (which washes the mood color out), we use it to *tint*
  // the existing bloom on a thin mid-bloom ring — an oil-slick sheen that
  // colours the rim without overpowering the palette identity of the mood.
  float shell = exp(-pow((dn - 0.6) * 3.0, 2.0));         // narrow mid ring
  float irPhase = ang * 0.5 + fbmTex * 1.5 + uTimeS * 0.4;
  vec3 irid = iridescent(fract(irPhase));
  float irMask = shell * uIridescence * pg;               // gated by bloom light
  col = mix(col, col * (0.4 + 1.6 * irid), irMask * 0.5);
  col += irid * irMask * 0.18 * bloomGain;                // faint additive sheen

  // ---- Drifting light motes (depth-layered, streaked, twinkling) ----
  for (int i = 0; i < MAX_MOTES; i++) {
    if (float(i) >= uMoteCount) break;
    vec2 h = hash21(float(i) * 13.17 + uMoteSeed);
    vec2 h2 = hash21(float(i) * 7.91 + uMoteSeed + 1.3);
    float a0 = h.x * TAU;
    float spd = 0.5 + h.y;
    float delay = hash11(float(i) * 7.7 + uMoteSeed) * 0.15;
    float life = clamp((uLife - delay) / (1.0 - delay), 0.0, 1.0);
    if (life <= 0.0) continue;

    // Depth tier: ~1/3 of motes sit "closer" (bigger, brighter, slower-ish),
    // the rest are far sparks. Gives parallax-like layering.
    float near = step(0.66, h2.x);
    float depth = mix(0.7, 1.4, near);

    vec2 dir = vec2(cos(a0), sin(a0));
    float travel = life * spd * uMoteSpeed * r * 1.3 * depth;
    vec2 buoy = vec2(0.0, life * life * r * 0.5);              // float upward
    float t1 = a0 * 3.0 + life * TAU * spd;
    vec2 curl = vec2(sin(t1), cos(t1 * 0.8 + a0)) * uTurbulence * r * 0.3 * life;
    vec2 pos = uOrigin + dir * travel + buoy + curl;

    // Velocity (analytic-ish): outward drift + buoyancy + curl tangent. Used to
    // stretch each spark into a motion-blur streak along its direction of travel.
    vec2 vel = dir * spd * uMoteSpeed * 1.3 * depth
             + vec2(0.0, 2.0 * life * 0.5)
             + vec2(cos(t1), -sin(t1 * 0.8 + a0)) * uTurbulence * 0.3;
    vec2 vdir = normalize(vel + 1e-4);
    vec2 q = frag - pos;
    // Anisotropic distance: compress along travel dir => a streak. Faster motes
    // streak more (capped). Slows to a round point as the mote settles.
    float streak = clamp(length(vel) * 0.12, 0.0, 0.65) * smoothstep(0.0, 0.25, life);
    float along = dot(q, vdir);
    float across = dot(q, vec2(-vdir.y, vdir.x));
    float dist = length(vec2(along * (1.0 - streak), across));

    float size = minDim * 0.006 * (0.6 + h.x * 0.8) * depth;
    float spark = size / (dist + size * 0.5);
    spark *= spark;
    // Twinkle: a fast, per-mote shimmer so the field scintillates.
    float twinkle = 0.75 + 0.25 * sin(uTimeS * (6.0 + h2.y * 10.0) + h.x * TAU);
    float fade = (1.0 - pow(life, 1.3)) * smoothstep(0.0, 0.08, life);
    col += paletteMix(h.y) * spark * fade * twinkle * bloomGain * 1.2 * mix(0.9, 1.3, near);
  }

  // ---- Checkmark drawn in light, with leading spark + afterglow ----
  float cr = minDim * 0.11;
  vec2 A = uOrigin + cr * vec2(-0.9, 0.15);
  vec2 B = uOrigin + cr * vec2(-0.25, -0.55);
  vec2 C = uOrigin + cr * vec2(1.0, 0.78);
  float l1 = length(B - A), l2 = length(C - B);
  float total = l1 + l2;
  float drawn = uCheck * total;
  float vis1 = clamp(drawn, 0.0, l1);
  vec2 tip = A + (B - A) * (vis1 / l1);
  float dseg = sdSeg(frag, A, tip);
  if (drawn > l1) {
    float d2 = clamp(drawn - l1, 0.0, l2);
    tip = B + (C - B) * (d2 / l2);
    dseg = min(dseg, sdSeg(frag, B, tip));
  }
  float sw = cr * 0.12;
  float ccore = smoothstep(sw, sw * 0.35, dseg);
  float cglow = exp(-dseg / (sw * 2.0)) * 0.7;
  // Leading spark: a bright hot point at the pen tip while it's drawing, with a
  // soft afterglow that lingers a moment after the stroke completes.
  float tipDist = length(frag - tip);
  float drawing = smoothstep(0.0, 0.04, uCheck) * (1.0 - smoothstep(0.92, 1.06, uCheck));
  float tipSize = sw * 1.6;
  float sparkHead = tipSize / (tipDist + tipSize * 0.4);
  sparkHead *= sparkHead;
  float cFade = 1.0 - smoothstep(0.7, 1.0, uLife);
  vec3 checkTint = mix(vec3(1.0), uC0 + 0.4, 0.5);
  // The checkmark is the unambiguous confirmation, so it must out-shine the
  // bloom core it sits inside — overdrive its core and leading spark.
  col += (vec3(1.0) * ccore * 1.6 + checkTint * cglow) * cFade * uExposure;
  col += vec3(1.0) * sparkHead * drawing * cFade * uExposure * 2.0;

  // ---- Filmic tonemap + dither ----
  // Pre-exposure < 1 keeps the bloom a focused burst (not an all-over haze)
  // while ACES gives a graceful highlight rolloff.
  col = tonemapACES(col * 0.62);
  // Ordered dither (~1/255) to break up the smooth-gradient banding the screen
  // blend would otherwise reveal on the page beneath. Triangular hash noise.
  float dz = hash11(dot(frag, vec2(12.989, 78.233)) + uTimeS) - 0.5;
  col += dz / 255.0;

  fragColor = vec4(col, 1.0);
}`;
