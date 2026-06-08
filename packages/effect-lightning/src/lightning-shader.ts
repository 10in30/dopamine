/**
 * GLSL ES 3.00 source for **Lightning** — Dopamine's high-energy "power-up /
 * boost" effect, and a deliberate DIVERGENCE from every existing look: where
 * Solarbloom blooms from a point, Verdict writes a smooth calligraphic arc and
 * Comic slams a word, Lightning *cracks* a jagged, branching electric arc into
 * the action point with a hard white STROBE FLASH.
 *
 * Governing metaphor: a lightning bolt striking toward the anchor (uOrigin). A
 * single fbm-perturbed MAIN BOLT zig-zags down from the top of the frame to the
 * strike point, throwing off a few shorter FORKS along its length. The strike is
 * gated by a hard impact envelope: an instantaneous full-frame FLASH on contact,
 * the lit bolt body, then a brief FLICKER AFTERGLOW that strobes and decays.
 *
 * Layers, summed as light (canvas is black, composited `mix-blend-mode: screen`,
 * so black == no change, bright == cast light onto the page beneath):
 *   1. FLASH        — a hard, near-white full-frame wash on the strike instant,
 *                     decaying fast (the "boost landed" strobe). Re-triggers on
 *                     each flicker beat so the afterglow strobes.
 *   2. MAIN BOLT    — a jagged polyline from the top edge to uOrigin, each vertex
 *                     perturbed by fbm; rendered as a glowing capsule chain with a
 *                     hot WHITE CORE inside an electric-blue/violet halo.
 *   3. FORKS        — a few shorter secondary bolts branching off the main path,
 *                     count + reach driven by intensity/mood.
 *   4. IMPACT GLOW  — a bright radial burst where the bolt meets uOrigin.
 *
 * Timing lives in uniforms (uStrike = strike progress 0..1; uFlash = flash/strobe
 * amplitude; uLife = whole-effect progress). Pure function of uTimeS — frame-
 * perfect + cheap under SwiftShader (analytic segment SDFs + fbm, single pass).
 *
 * whimsy == uStyle: 0 = photoreal plasma glow (soft bloom, additive falloff);
 *   1 = flat cel COMIC-BOOK lightning bolt — hard-edged white core + a single
 *   bold outline band, harder animate-on-twos strobe (the runner snaps the clock).
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_FBM,
  GLSL_HASH,
  GLSL_PALETTE_MIX,
  GLSL_SD_SEG,
  GLSL_TONEMAP_ACES,
} from "@dopamine/core";

/**
 * Max secondary forks. Single source of truth for the cap: BOTH the GLSL
 * `#define MAX_FORKS` (interpolated below) and the integer-clamp const the
 * `.dope` mapping references (passed to the loader as `MAX_FORKS`).
 */
export const MAX_FORKS = 7;

/** Polyline segment count of the main bolt (and forks). More = jaggier arc. */
export const BOLT_SEGS = 14;

export const LIGHTNING_VERTEX_SRC = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const LIGHTNING_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;    // device pixels
uniform vec2  uOrigin;        // strike point (gl coords, y-up)
uniform float uStrike;        // bolt strike progress 0..1 (fast crack-in)
uniform float uFlash;         // strobe/flash amplitude (peaks on contact + flicker beats)
uniform float uLife;          // whole-effect progress 0..1
uniform float uTimeS;         // elapsed seconds
uniform float uAmp;           // impact envelope amplitude (peaks > 1)
uniform float uThickness;     // bolt half-width as fraction of min dim
uniform float uJagged;        // fbm perturbation amount of the bolt vertices
uniform float uBranches;      // number of secondary forks
uniform float uFlashBright;   // peak flash brightness multiplier
uniform float uExposure;      // overall light gain
uniform float uSeed;          // per-fire hash offset
uniform float uStyle;         // 0..1 photoreal plasma -> cel comic bolt (whimsy)
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette
uniform float uShadowSoft;    // penumbra softness in device px
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;            // electric core hue
uniform vec3  uC1;            // mid (blue/violet)
uniform vec3  uC2;            // edge accent

#define MAX_FORKS ${MAX_FORKS}
#define BOLT_SEGS ${BOLT_SEGS}
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_PALETTE_MIX}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
${GLSL_SD_SEG}

// Electric channel colour ramp. The golden-angle palette fans uC0/uC1/uC2 far
// apart in hue (a deliberately ROAMING palette), which for a bolt would cross
// through magenta/orange — wrong for an electric arc. So the bolt's colour is
// built as a tight ramp anchored on uC0 (the mood's electric blue/violet base
// hue): rim = uC0, blending toward a cool electric-white core as t -> 1. This
// keeps the bolt monochromatic blue/violet -> hot white. \`t\` in 0..1 (0 = outer
// halo, 1 = white-hot core).
vec3 elecRamp(float t){
  t = clamp(t, 0.0, 1.0);
  // A cool tint pulled slightly toward cyan/blue from uC0 for the very rim, so
  // the halo's edge reads electric rather than flat.
  vec3 rim = mix(uC0, vec3(0.45, 0.6, 1.0), 0.35);
  vec3 mid = mix(uC0, vec3(0.8, 0.85, 1.0), 0.5);   // bright blue-white
  vec3 hot = vec3(1.0);                              // white-hot plasma channel
  return t < 0.5 ? mix(rim, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
}

// A jagged lightning vertex at parameter t in [0,1] along a path from A to B.
// The straight lerp is perturbed PERPENDICULAR to travel by an fbm-driven offset
// (so the bolt zig-zags), tapering to 0 at both endpoints (so it stays anchored
// to the source + the strike point). \`seedOff\` decorrelates separate bolts/forks.
// jitterScale lets the shadow drop the cel "on twos" jitter (a shadow shouldn't
// shimmer like the lit bolt).
vec2 boltPoint(vec2 A, vec2 B, float t, float seedOff, float jitterScale){
  vec2 d = B - A;
  float len = max(length(d), 1.0);
  vec2 dir = d / len;
  vec2 nrm = vec2(-dir.y, dir.x);
  // Per-frame "on twos" beat so high-whimsy strikes re-pose the jag discretely.
  float beat = floor(uTimeS * 12.0) * uStyle * jitterScale;
  // Two octaves of perturbation: a big swing + a fine crackle, both faded at ends.
  float n = fbm(vec2(t * 6.0 + seedOff + uSeed, beat * 0.5)) - 0.5;
  float fine = fbm(vec2(t * 22.0 + seedOff * 3.1 + uSeed, beat)) - 0.5;
  float taper = sin(t * 3.14159265);           // 0 at ends, 1 mid-path
  float off = (n * 1.6 + fine * 0.5) * uJagged * len * 0.16 * taper;
  return A + dir * (t * len) + nrm * off;
}

// Glowing coverage of a jagged bolt from A to B, drawn up to arc fraction
// \`drawn\` (0..1). Walks the polyline; for each lit segment accumulates an
// additive 1/d glow (the plasma falloff) plus a hot white core near the spine.
// Returns vec2(coreCoverage, glow). \`coreOut\` is the crisp white centre, glow
// is the soft electric halo. radFrac is the bolt half-width as a frac of minDim.
vec2 boltGlow(vec2 frag, vec2 A, vec2 B, float drawn, float seedOff, float radFrac, float jitterScale){
  float minDim = min(uResolution.x, uResolution.y);
  float rad = minDim * radFrac;
  float glow = 0.0;
  float core = 0.0;
  vec2 prev = boltPoint(A, B, 0.0, seedOff, jitterScale);
  for (int i = 1; i <= BOLT_SEGS; i++) {
    float t = float(i) / float(BOLT_SEGS);
    if (t - 1.0 / float(BOLT_SEGS) > drawn) break;   // only the struck portion
    float tc = min(t, drawn);
    vec2 cur = boltPoint(A, B, tc, seedOff, jitterScale);
    float dist = sdSeg(frag, prev, cur);
    // Soft plasma glow: inverse-distance falloff, bounded.
    glow += rad / (dist + rad * 0.35);
    // Hot core: a crisp bright centre line.
    core = max(core, 1.0 - smoothstep(rad * 0.25, rad * 0.6, dist));
    prev = cur;
  }
  glow = clamp(glow / float(BOLT_SEGS) * 2.2, 0.0, 1.4);
  return vec2(core, glow);
}

// The strike geometry: the bolt descends from a point on the TOP edge (offset
// horizontally toward the strike so it reads as coming "down to" the action) to
// the strike point at uOrigin.
vec2 boltStart(){
  vec2 res = uResolution;
  // Start near the top, biased toward the strike's x with a seeded horizontal jog.
  float jx = (hash21(uSeed * 1.7).x - 0.5) * res.x * 0.5;
  return vec2(clamp(uOrigin.x + jx, res.x * 0.12, res.x * 0.88), res.y * 1.02);
}

// SHADOW silhouette: just the bolt mass (main + forks), no glow/core/flash — a
// cheap occlusion field so the extra multiply pass stays light under software GL.
float boltOcclusion(vec2 p){
  float minDim = min(uResolution.x, uResolution.y);
  vec2 A = boltStart();
  vec2 B = uOrigin;
  float rad = minDim * uThickness * 1.6;
  float occ = 0.0;
  vec2 prev = boltPoint(A, B, 0.0, 0.0, 0.0);
  for (int i = 1; i <= BOLT_SEGS; i++) {
    float t = float(i) / float(BOLT_SEGS);
    if (t - 1.0 / float(BOLT_SEGS) > uStrike) break;
    float tc = min(t, uStrike);
    vec2 cur = boltPoint(A, B, tc, 0.0, 0.0);
    float dist = sdSeg(p, prev, cur);
    occ = max(occ, 1.0 - smoothstep(rad * 0.6, rad, dist));
    prev = cur;
  }
  return clamp(occ * uAmp, 0.0, 1.0);
}

vec4 lightningShadowColor(vec2 frag){
  vec2 sp = frag - uShadowOffset;
  float occ = boltOcclusion(sp);
  float soft = uShadowSoft;
  occ += boltOcclusion(sp + vec2( soft, 0.0));
  occ += boltOcclusion(sp + vec2(-soft, 0.0));
  occ += boltOcclusion(sp + vec2(0.0,  soft));
  occ += boltOcclusion(sp + vec2(0.0, -soft));
  float s2 = soft * 0.7071;
  occ += boltOcclusion(sp + vec2( s2,  s2));
  occ += boltOcclusion(sp + vec2(-s2,  s2));
  occ += boltOcclusion(sp + vec2( s2, -s2));
  occ += boltOcclusion(sp + vec2(-s2, -s2));
  occ /= 9.0;
  float dark = clamp(occ, 0.0, 1.0) * uShadowStrength;
  // Cool the shadow toward the electric blue (NOT the roaming uC1, which the
  // golden-angle palette can push into magenta) so the cast occlusion stays on-hue.
  vec3 tint = mix(vec3(1.0), 0.55 + 0.45 * normalize(elecRamp(0.2) + 1e-3), 0.25);
  vec3 mul = mix(vec3(1.0), tint, dark);
  return vec4(mul, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);

  if (uShadow > 0.5) {
    fragColor = lightningShadowColor(frag);
    return;
  }

  vec3 col = vec3(0.0);
  float gain = uExposure * uAmp;

  vec2 A = boltStart();
  vec2 B = uOrigin;

  // Accumulate the analytic bolt geometry coverage (core = crisp white channel,
  // glow = soft halo) across the trunk + forks, so the cel pass can isolate the
  // BOLT SHAPE itself rather than thresholding the final (flash-washed) luminance.
  float boltCore = 0.0;
  float boltGlowAcc = 0.0;

  // ---- MAIN BOLT ----
  vec2 mb = boltGlow(frag, A, B, uStrike, 0.0, uThickness, 1.0);
  float mainCore = mb.x;
  float mainGlow = mb.y;
  boltCore = max(boltCore, mainCore);
  boltGlowAcc = max(boltGlowAcc, mainGlow);

  // Electric halo: a tight blue/violet -> white ramp keyed on the glow strength,
  // with a touch of fbm so the channel has living variation (not a flat tube).
  float haloT = clamp(mainGlow * 0.7 + 0.1 * (fbm(frag / minDim * 4.0 + uSeed) - 0.5), 0.0, 1.0);
  col += elecRamp(haloT) * mainGlow * gain * 1.3;
  // Hot white core (the plasma channel) — pushes the centre to white.
  col += vec3(1.0) * mainCore * gain * 2.4;

  // ---- SECONDARY FORKS ----
  // A few shorter bolts branching off the main path. Each launches from a point
  // partway down the main bolt and shoots to an offset target, lit only once the
  // strike has progressed past its launch point.
  for (int i = 0; i < MAX_FORKS; i++) {
    if (float(i) >= uBranches) break;
    vec2 hh = hash21(float(i) * 9.7 + uSeed + 3.0);
    float launchT = 0.18 + hh.x * 0.62;            // where it splits off the main bolt
    if (uStrike < launchT) continue;
    vec2 forkA = boltPoint(A, B, launchT, 0.0, 1.0);
    // Fork target: out to the side + further down, length scaled by reach.
    float ang = (hh.y - 0.5) * 2.2;                 // splay angle
    vec2 dir = normalize(B - A);
    vec2 nrm = vec2(-dir.y, dir.x);
    float reach = (0.18 + hh.x * 0.22) * length(B - A);
    vec2 forkB = forkA + (dir * (0.5 + hh.y) + nrm * ang) * reach;
    float forkDrawn = clamp((uStrike - launchT) / max(1.0 - launchT, 0.05), 0.0, 1.0);
    vec2 fb = boltGlow(frag, forkA, forkB, forkDrawn, float(i) * 17.0 + 5.0, uThickness * 0.6, 1.0);
    // Forks fade slightly faster than the trunk (thinner channels cool quicker).
    float forkFade = 0.6 + 0.4 * (1.0 - smoothstep(0.5, 1.0, uLife));
    col += elecRamp(clamp(fb.y * 0.7 + 0.15, 0.0, 1.0)) * fb.y * gain * 0.8 * forkFade;
    col += vec3(1.0) * fb.x * gain * 1.5 * forkFade;
    boltCore = max(boltCore, fb.x * forkFade);
    boltGlowAcc = max(boltGlowAcc, fb.y * forkFade);
  }

  // ---- IMPACT GLOW ----
  // A bright radial burst at the strike point, blooming once the bolt lands.
  // The burst blooms on contact then EASES OFF (it shouldn't sit as a permanent
  // white disc through the whole afterglow), and is kept tight so the branching
  // bolt forms — not a blob — remain the read.
  float landed = smoothstep(0.7, 1.0, uStrike) * (0.4 + 0.6 * (1.0 - smoothstep(0.1, 0.5, uLife)));
  float dB = length(frag - B);
  float impact = (minDim * uThickness * 2.0) / (dB + minDim * uThickness * 1.4);
  impact *= impact;
  col += elecRamp(0.7) * impact * landed * gain * 0.8;

  // ---- FLASH / STROBE ----
  // A hard near-white full-frame wash, brightest on contact and re-pulsing on the
  // flicker beats (uFlash carries the strobe envelope). A faint radial bias keeps
  // the strike point hottest. This is the signature "boost landed" hit.
  // Concentrate the wash toward the strike point so the flash reads as the bolt
  // dumping light into the action (a low global floor keeps it from flat-washing
  // the whole page to white once it's past the first instant).
  float flashRadial = 0.28 + 0.72 * exp(-dB / (minDim * 0.5));
  vec3 flashCol = mix(vec3(1.0), elecRamp(0.6), 0.25);
  col += flashCol * uFlash * uFlashBright * flashRadial;

  // ---- Tone + finishing ----
  // Pre-expose a touch so the electric halo stays vivid, then ACES rolloff so the
  // hot core + flash don't go chalky on the page beneath.
  col = tonemapACES(col * 0.9);

  // ---- Non-photoreal pass: cel / comic-book bolt (whimsy) ----
  // Toward the cel end rebuild the bolt as a FLAT comic lightning shape: a hard
  // solid white core + a single bold electric outline band, keyed off the glow we
  // already have. Don't posterize the dark background (that shatters it into
  // blocks); only the bolt forms flatten.
  if (uStyle > 0.001) {
    // Key the cel cells off the analytic BOLT coverage (not the flash-washed
    // luminance), so the comic rebuild is the jagged bolt + a bold outline — the
    // background and the flash wash are left alone (posterizing them just shatters
    // the page into camouflage blocks).
    float coreMask = smoothstep(0.45, 0.65, boltCore);                  // solid white channel
    float bandMask = smoothstep(0.45, 0.8, boltGlowAcc) * (1.0 - coreMask); // bold outline
    vec3 boltColor = clamp(elecRamp(0.35) * 1.5 + 0.05, 0.0, 1.3);
    vec3 cel = vec3(1.0) * coreMask + boltColor * bandMask;
    float boltMask = clamp(coreMask + bandMask, 0.0, 1.0);
    // Flatten ONLY the bolt region into the cel cells; keep the soft impact glow,
    // dither and — crucially — the full-frame STROBE FLASH as they are (the hard
    // strobe is the whole point of the comic-book bolt).
    vec3 styled = mix(col, cel, boltMask);
    col = mix(col, styled, uStyle);
  }

  // Ordered dither (~1/255) to kill banding the screen blend would reveal; faded
  // out toward the cel end where hard bands are intended.
  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);

  fragColor = vec4(max(col, 0.0), 1.0);
}`;
