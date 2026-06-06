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

import {
  GLSL_CONSTANTS,
  GLSL_DISPERSION,
  GLSL_DITHER,
  GLSL_DOMAIN_WARP,
  GLSL_FBM,
  GLSL_HASH,
  GLSL_IRIDESCENT,
  GLSL_PALETTE_MIX,
  GLSL_SD_SEG,
  GLSL_TONEMAP_ACES,
} from "./look/glsl.js";
import { GLSL_PARTICLES } from "./look/particles.glsl.js";

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
uniform sampler2D uCheckTex; // alpha mask of the chosen check GLYPH (✓ / ✔), centred, premult-free
uniform float uCheckTexOn;   // 1 = sample the real font glyph; 0 = analytic SDF fallback
uniform float uCheckBox;     // half-size (device px) of the square glyph box around uOrigin

#define MAX_MOTES 80
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_DOMAIN_WARP}
${GLSL_PALETTE_MIX}
${GLSL_IRIDESCENT}
${GLSL_DISPERSION}
${GLSL_SD_SEG}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
${GLSL_PARTICLES}

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

// ---------------------------------------------------------------------------
// GLYPH CHECKMARK — a REAL font glyph (✓ / ✔, chosen by whimsy) rasterized into
// uCheckTex and sampled here. It sits centred on uOrigin in a square box of half
// size uCheckBox. The glyph "draws itself": we reveal it along a diagonal wipe
// (lower-left → upper-right, the natural pen path of a tick) driven by uCheck, so
// the reveal stays a pure function of time. Returns coverage in .x and the wipe
// frontier coordinate (0..1 along the draw axis) in .y for the leading spark.
// ---------------------------------------------------------------------------

// Map a device-pixel sample to this glyph's UV (origin bottom-left, y up). The
// texture is uploaded FLIP_Y so the canvas (y-down) glyph lands upright.
vec2 glyphUV(vec2 frag){
  return (frag - uOrigin) / (2.0 * uCheckBox) + 0.5;
}

// Normalized progress along the diagonal draw axis at a glyph-UV point. The tick
// is drawn from its bottom-left to its top-right tip, so the axis is mostly +x
// with a gentle upward bias; tuned so the short down-stroke reveals first.
float glyphDrawAxis(vec2 uv){
  return clamp((uv.x * 0.86 + uv.y * 0.14), 0.0, 1.0);
}

// Glyph coverage at frag, gated by the draw-in wipe. uCheck 0..1 sweeps the
// frontier across the draw axis with a soft leading edge.
float glyphCoverage(vec2 frag, out float axisHere){
  vec2 uv = glyphUV(frag);
  axisHere = glyphDrawAxis(uv);
  // Outside the box there is no glyph (CLAMP_TO_EDGE would otherwise smear).
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return 0.0;
  float a = texture(uCheckTex, uv).a;
  // Soft wipe: pixels ahead of the frontier are still "undrawn". The frontier
  // runs a touch past 1.0 at uCheck=1 so the whole glyph completes.
  float frontier = uCheck * 1.12;
  float wipe = smoothstep(frontier, frontier - 0.07, axisHere);
  return a * wipe;
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

  // Checkmark mass — cast from the SAME source as the light pass so the
  // silhouette matches: the real font glyph when present, else the analytic SDF.
  float cr = minDim * 0.11;
  float sw = cr * 0.12;
  if (uCheckTexOn > 0.5) {
    float axisHere;
    float cov = glyphCoverage(p, axisHere);
    occ += cov * 0.8;
  } else {
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
    occ += (1.0 - smoothstep(sw * 0.6, sw * 1.4, dseg)) * 0.8;
  }

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
  // Shared two-level domain warp (look/glsl domainWarp): the smoke-like interior.
  float fbmTex = domainWarp(sp, uTimeS, uTurbulence);
  // The warp perturbs the radius only modestly, so the core stays a focused
  // burst rather than blooming into an all-over haze.
  float dn = d / r * (1.0 + 0.18 * (fbmTex - 0.5) * uTurbulence);

  // Spectral split: sample the radial falloff at slightly different radii per
  // channel. Strength grows toward the rim (where dn ~ 1) — like dispersion at
  // a refractive edge — and is gated by uDispersion + amplitude (shared helper).
  float disp = dispersionAmount(uDispersion, dn, uAmp);
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
    float spark = particleSprite(dist, size);   // shared soft round sprite
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
  // The checkmark is a REAL font glyph (✓ / ✔ chosen by whimsy) sampled from
  // uCheckTex, falling back to the analytic two-segment SDF if the glyph texture
  // failed to load. Either way it stays the brightest "drawn in light" element,
  // preserves the draw-in wipe + leading spark, and casts light + shadow.
  float cr = minDim * 0.11;
  float sw = cr * 0.12;
  float ccore;   // crisp glyph body coverage (0..1)
  float cglow;   // soft surrounding glow
  vec2  tip;     // leading-edge point for the spark
  float drawing; // 1 while the stroke is being laid down (gates the spark)

  if (uCheckTexOn > 0.5) {
    // -- GLYPH PATH: sample the rasterized font check, revealed by a diagonal --
    // wipe so it "draws itself". A tiny screen-space boil jitter (on twos, scaled
    // by style) keeps the hand-drawn feel at high whimsy.
    float bt = floor(uTimeS * 12.0);
    vec2 boil = (hash21(bt + 1.7) - 0.5) * cr * 0.05 * uStyle;
    vec2 gfrag = frag - boil;
    float axisHere;
    float cov = glyphCoverage(gfrag, axisHere);
    // Soft glow: re-sample the coverage slightly blurred via the box gradient.
    // (Cheap: reuse the same masked coverage with a falloff vs the wipe frontier.)
    ccore = smoothstep(0.35, 0.6, cov);
    cglow = cov * 0.6 * (1.0 - 0.7 * uStyle);
    // Leading spark: brightest where the wipe frontier currently crosses inked
    // glyph pixels. frontier in draw-axis space; convert to a device-px point on
    // the diagonal for the radial spark sprite.
    float frontier = clamp(uCheck * 1.12, 0.0, 1.0);
    // Reconstruct an approximate frontier point on the draw diagonal in the box.
    vec2 axisDir = normalize(vec2(0.86, 0.14));
    vec2 boxUVtoPx = vec2(2.0 * uCheckBox);
    // Param 0..1 along axis → uv along the diagonal anchored at box centre line.
    vec2 frontUV = vec2(frontier, 0.30 + frontier * 0.55);
    tip = uOrigin + (frontUV - 0.5) * boxUVtoPx;
    drawing = smoothstep(0.0, 0.04, uCheck) * (1.0 - smoothstep(0.92, 1.06, uCheck));
  } else {
    // -- ANALYTIC FALLBACK: the original two-segment SDF "drawn in light". ------
    float bt = floor(uTimeS * 12.0);
    vec2 A = uOrigin + cr * vec2(-0.9, 0.15) + (hash21(bt + 1.1) - 0.5) * cr * 0.06 * uStyle;
    vec2 B = uOrigin + cr * vec2(-0.25, -0.55) + (hash21(bt + 2.2) - 0.5) * cr * 0.06 * uStyle;
    vec2 C = uOrigin + cr * vec2(1.0, 0.78) + (hash21(bt + 3.3) - 0.5) * cr * 0.06 * uStyle;
    float l1 = length(B - A), l2 = length(C - B);
    float total = l1 + l2;
    float drawn = uCheck * total;
    float vis1 = clamp(drawn, 0.0, l1);
    tip = A + (B - A) * (vis1 / l1);
    float dseg = sdSeg(frag, A, tip);
    if (drawn > l1) {
      float d2 = clamp(drawn - l1, 0.0, l2);
      tip = B + (C - B) * (d2 / l2);
      dseg = min(dseg, sdSeg(frag, B, tip));
    }
    float softCore = smoothstep(sw, sw * 0.35, dseg);
    float hardCore = 1.0 - smoothstep(sw * 0.85, sw, dseg);
    ccore = mix(softCore, hardCore, uStyle);
    cglow = exp(-dseg / (sw * 2.0)) * 0.7 * (1.0 - 0.7 * uStyle);
    drawing = smoothstep(0.0, 0.04, uCheck) * (1.0 - smoothstep(0.92, 1.06, uCheck));
  }

  // Leading spark: a bright hot point at the pen tip while it's drawing, with a
  // soft afterglow that lingers a moment after the stroke completes.
  float tipDist = length(frag - tip);
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

  // Ordered dither (~1/255, shared look/glsl ditherAdd) to break up the
  // smooth-gradient banding the screen blend would otherwise reveal on the page.
  // Faded out toward the cel end, where hard bands are the intended look.
  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);

  fragColor = vec4(col, 1.0);
}`;
