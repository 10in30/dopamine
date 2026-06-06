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
uniform float uStyle;        // 0..1 photoreal -> non-photoreal (cel-shaded / hand-drawn)
uniform float uShadow;       // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset; // device-px offset of the cast silhouette (away from light)
uniform float uShadowSoft;   // penumbra softness in device px (blur tap radius)
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
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

// ---------------------------------------------------------------------------
// SHADOW silhouette — a cheap occlusion field for the bright forms (bloom core,
// motes, checkmark). Used only by the shadow pass: we don't need the full
// volumetric look, just where the effect is "solid enough" to block light. It's
// deliberately a fraction of the cost of the light pass (no FBM, no per-mote
// streak/twinkle), so the extra pass stays cheap under software WebGL.
// p is a device-pixel sample point. Returns 0..~1 coverage.
float solarOcclusion(vec2 p){
  float minDim = min(uResolution.x, uResolution.y);
  float r = uBloomRadius * minDim;
  vec2 rel = p - uOrigin;
  float d = length(rel);
  float dn = d / r;
  // Bloom mass: the focused core casts the bulk of the shadow; the halo only a
  // faint ambient occlusion. Matches bloomProfile's shape but flatter.
  float occ = exp(-dn * dn * 2.0) * 0.9 + exp(-dn * 1.4) * 0.18;

  // Motes: a sparse set of soft dots (no streaks/twinkle — just mass).
  for (int i = 0; i < MAX_MOTES; i++) {
    if (float(i) >= uMoteCount) break;
    vec2 h = hash21(float(i) * 13.17 + uMoteSeed);
    vec2 h2 = hash21(float(i) * 7.91 + uMoteSeed + 1.3);
    float a0 = h.x * TAU;
    float spd = 0.5 + h.y;
    float delay = hash11(float(i) * 7.7 + uMoteSeed) * 0.15;
    float life = clamp((uLife - delay) / (1.0 - delay), 0.0, 1.0);
    if (life <= 0.0) continue;
    float near = step(0.66, h2.x);
    float depth = mix(0.7, 1.4, near);
    vec2 dir = vec2(cos(a0), sin(a0));
    float travel = life * spd * uMoteSpeed * r * 1.3 * depth;
    vec2 buoy = vec2(0.0, life * life * r * 0.5);
    vec2 pos = uOrigin + dir * travel + buoy;
    float size = minDim * 0.006 * (0.6 + h.x * 0.8) * depth;
    float dd = length(p - pos);
    float dot = size / (dd + size * 0.6); dot *= dot;
    float fade = (1.0 - pow(life, 1.3)) * smoothstep(0.0, 0.08, life);
    occ += dot * fade * 0.5;
  }

  // Checkmark capsule mass (same geometry as the light pass, no boil jitter).
  float cr = minDim * 0.11;
  vec2 A = uOrigin + cr * vec2(-0.9, 0.15);
  vec2 B = uOrigin + cr * vec2(-0.25, -0.55);
  vec2 C = uOrigin + cr * vec2(1.0, 0.78);
  float l1 = length(B - A), l2 = length(C - B);
  float total = l1 + l2;
  float drawn = uCheck * total;
  float vis1 = clamp(drawn, 0.0, l1);
  vec2 tip = A + (B - A) * (vis1 / l1);
  float dseg = sdSeg(p, A, tip);
  if (drawn > l1) {
    float d2 = clamp(drawn - l1, 0.0, l2);
    vec2 tip2 = B + (C - B) * (d2 / l2);
    dseg = min(dseg, sdSeg(p, B, tip2));
  }
  float sw = cr * 0.12;
  occ += (1.0 - smoothstep(sw * 0.6, sw * 1.4, dseg)) * 0.8;

  return clamp(occ * uAmp, 0.0, 1.0);
}

// Soft, offset cast silhouette → multiply colour. Samples the occlusion field
// at a small ring of taps around the offset point (a cheap separable-ish blur)
// for a penumbra, then maps coverage to a darkening factor.
vec4 shadowColor(vec2 frag){
  // Sample point is pushed AGAINST the shadow offset, so the resulting dark
  // silhouette lands offset away from the bright core (toward uShadowOffset).
  vec2 sp = frag - uShadowOffset;
  float occ = solarOcclusion(sp);
  // 8-tap ring blur for a soft penumbra; cheap and isotropic enough.
  float soft = uShadowSoft;
  occ += solarOcclusion(sp + vec2( soft, 0.0));
  occ += solarOcclusion(sp + vec2(-soft, 0.0));
  occ += solarOcclusion(sp + vec2(0.0,  soft));
  occ += solarOcclusion(sp + vec2(0.0, -soft));
  float s2 = soft * 0.7071;
  occ += solarOcclusion(sp + vec2( s2,  s2));
  occ += solarOcclusion(sp + vec2(-s2,  s2));
  occ += solarOcclusion(sp + vec2( s2, -s2));
  occ += solarOcclusion(sp + vec2(-s2, -s2));
  occ /= 9.0;
  // Soften and gate by strength. multiply layer: 1.0 = no change, lower = darker.
  float dark = clamp(occ, 0.0, 1.0) * uShadowStrength;
  // Slightly warm/cool tint via palette so the shadow isn't pure neutral grey —
  // it reads as the effect's own coloured occlusion. Keep it subtle.
  vec3 tint = mix(vec3(1.0), 0.6 + 0.4 * normalize(uC0 + 1e-3), 0.25);
  vec3 mul = mix(vec3(1.0), tint, dark);
  return vec4(mul, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  float minDim = min(uResolution.x, uResolution.y);
  float r = uBloomRadius * minDim;
  vec3 col = vec3(0.0);

  if (uShadow > 0.5) {
    fragColor = shadowColor(frag);
    return;
  }

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
    // Toward the NPR end, crisp the spark and add a screen-aligned 4-point
    // sparkle "star" so motes read as hand-drawn twinkles, not soft photons.
    if (uStyle > 0.001) {
      float crisp = smoothstep(size * 1.5, 0.0, dist);
      vec2 star = abs(q);
      float spikes = exp(-star.x / (size * 0.45)) * exp(-star.y * star.y / (size * size * 0.5))
                   + exp(-star.y / (size * 0.45)) * exp(-star.x * star.x / (size * size * 0.5));
      spark = mix(spark, crisp + spikes * 0.6, uStyle * 0.9);
    }
    // Twinkle: a fast, per-mote shimmer so the field scintillates.
    float twinkle = 0.75 + 0.25 * sin(uTimeS * (6.0 + h2.y * 10.0) + h.x * TAU);
    float fade = (1.0 - pow(life, 1.3)) * smoothstep(0.0, 0.08, life);
    col += paletteMix(h.y) * spark * fade * twinkle * bloomGain * 1.2 * mix(0.9, 1.3, near);
  }

  // ---- Checkmark drawn in light, with leading spark + afterglow ----
  float cr = minDim * 0.11;
  // Hand-drawn "boil": per-vertex jitter that pops in discrete steps (the time
  // step makes floor(uTimeS*12) tick on twos), scaled in by style.
  float bt = floor(uTimeS * 12.0);
  vec2 A = uOrigin + cr * vec2(-0.9, 0.15) + (hash21(bt + 1.1) - 0.5) * cr * 0.06 * uStyle;
  vec2 B = uOrigin + cr * vec2(-0.25, -0.55) + (hash21(bt + 2.2) - 0.5) * cr * 0.06 * uStyle;
  vec2 C = uOrigin + cr * vec2(1.0, 0.78) + (hash21(bt + 3.3) - 0.5) * cr * 0.06 * uStyle;
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
  // Soft luminous stroke (photoreal) cross-fades to a crisp, flat drawn line
  // (toon) as style rises; the soft glow recedes so it reads as ink, not light.
  float softCore = smoothstep(sw, sw * 0.35, dseg);
  float hardCore = 1.0 - smoothstep(sw * 0.85, sw, dseg);
  float ccore = mix(softCore, hardCore, uStyle);
  float cglow = exp(-dseg / (sw * 2.0)) * 0.7 * (1.0 - 0.7 * uStyle);
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

  // ---- Non-photoreal pass: cel shading + neon flattening ----
  // As style (whimsy) rises we leave true lighting behind: boost chroma toward
  // flat neon and quantize the light into hard cel bands (fewer bands = more
  // cartoon / cyberpunk). At style 0 this is a no-op.
  if (uStyle > 0.001) {
    float l = dot(col, vec3(0.299, 0.587, 0.114));
    vec3 neon = clamp(l + (col - l) * 1.6, 0.0, 1.0);     // punch up saturation
    vec3 styled = mix(col, neon, 0.7);
    float bands = mix(40.0, 4.0, uStyle);                 // hard posterize
    styled = floor(styled * bands + 0.5) / bands;
    col = mix(col, styled, uStyle);
  }

  // Ordered dither (~1/255) to break up the smooth-gradient banding the screen
  // blend would otherwise reveal on the page beneath. Triangular hash noise.
  // Fade it out toward the cel end, where hard bands are the intended look.
  float dz = hash11(dot(frag, vec2(12.989, 78.233)) + uTimeS) - 0.5;
  col += (dz / 255.0) * (1.0 - uStyle);

  fragColor = vec4(col, 1.0);
}`;
