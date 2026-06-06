/**
 * GLSL ES 3.00 source for **Calligraphic Verdict** — Dopamine's second success
 * effect, and a deliberate DIVERGENCE from Solarbloom's centered radial bloom.
 *
 * Governing metaphor: a master's confident SIGNATURE STROKE. Instead of light
 * radiating outward from a point, a single calligraphic ink/light gesture WRITES
 * ITSELF across the frame as a real CHECKMARK — a short down-stroke into the
 * vertex, then a long up-flick to the right (an unambiguous approving tick). The
 * composition is directional and asymmetric, not concentric.
 *
 * Layers, summed as light (canvas is black, composited `mix-blend-mode: screen`,
 * so black == no change, bright == cast light onto the page beneath):
 *   1. PAPER WASH — a faint, low, off-center horizontal band of light that the
 *      stroke is laid onto (gives the gesture a "ground" without a radial core).
 *   2. THE STROKE — a two-leg checkmark brush path (down-stroke + up-flick) with
 *      PRESSURE-modulated width (thin entry, heavy belly through the vertex, thin
 *      exit), wet-ink bleed via FBM along the edge, bristle/dry-brush streaks
 *      raked along each leg's travel direction, and a bright WET LEADING TIP that
 *      races ahead of the fill (the "pen") and rides the corner.
 *   3. DROPLET SPRAY — ink flung off the tip on flick, arcing under gravity.
 *   4. AFTER-SHIMMER — a brief calligraphic underline of light that settles.
 *
 * Reward timing lives in uniforms (uDraw = pen progress 0..1, fast; uLife =
 * whole-effect progress). Pure function of uTimeS — frame-perfect & cheap under
 * SwiftShader (analytic SDF + noise, single pass).
 *
 * whimsy == uStyle: 0 = wet sumi-e ink on paper, true bleed + soft light;
 *   1 = flat cel / neon-cyberpunk stroke — hard posterized bands, a saturated
 *   neon core, animate-on-twos jitter on the path, a chunky outline.
 */

import {
  GLSL_CONSTANTS,
  GLSL_DITHER,
  GLSL_FBM,
  GLSL_HASH,
  GLSL_IRIDESCENT,
  GLSL_PALETTE_MIX,
  GLSL_SD_SEG,
  GLSL_TONEMAP_ACES,
} from "./look/glsl.js";
import { GLSL_PARTICLES } from "./look/particles.glsl.js";

/**
 * Max flung droplets. Single source of truth for the cap: BOTH the GLSL
 * `#define MAX_DROPS` (interpolated below) and the integer-clamp const the
 * `.dope` mapping references (passed to the loader as `MAX_DROPS`).
 */
export const MAX_DROPS = 64;

export const INK_VERTEX_SRC = /* glsl */ `#version 300 es
void main() {
  vec2 pos = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}`;

export const INK_FRAGMENT_SRC = /* glsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;   // device pixels
uniform float uDraw;         // pen / stroke draw progress 0..1 (fast confirm)
uniform float uLife;         // whole-effect progress 0..1
uniform float uTimeS;        // elapsed seconds
uniform float uAmp;          // envelope amplitude (peaks > 1)
uniform float uExposure;
uniform float uScale;        // stroke length as fraction of viewport width
uniform float uPressure;     // belly thickness multiplier
uniform float uWetness;      // 0..1 ink bleed / spread amount
uniform float uBristle;      // 0..1 dry-brush rake strength
uniform float uDroplets;     // count of flung droplets
uniform float uSeed;         // per-fire hash offset
uniform float uStyle;        // 0..1 photoreal ink -> cel/neon (whimsy)
uniform float uShadow;       // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset; // device-px offset of the cast silhouette (away from light)
uniform float uShadowSoft;   // penumbra softness in device px (blur tap radius)
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;           // ink core color
uniform vec3  uC1;           // mid
uniform vec3  uC2;           // edge / spray accent

#define MAX_DROPS ${MAX_DROPS}
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_PALETTE_MIX}
${GLSL_IRIDESCENT}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
${GLSL_SD_SEG}
${GLSL_PARTICLES}

// The gesture is now a real CHECKMARK: two straight legs A->B->C. A is the
// upper-left start, B is the bottom vertex (a SHORT down-stroke), C is the far
// upper-right (a LONG up-flick) — a confident tick. The pen writes leg1 then
// leg2; uDraw advances along TOTAL ARC LENGTH so the wet tip rides the corner.
// (y is up in gl_FragCoord space.)
//
// Shared by the light pass and the shadow silhouette so the cast shadow tracks
// exactly what's drawn. jitterScale lets the shadow drop the cel "on twos"
// jitter (a shadow shouldn't shimmer).
void strokeGeom(float jitterScale, out vec2 A, out vec2 B, out vec2 C){
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);
  float len = uScale * res.x;
  vec2 mid = vec2(res.x * 0.5, res.y * 0.46);
  float bt = floor(uTimeS * 12.0);
  vec2 jit = (hash21(bt + uSeed) - 0.5) * minDim * 0.02 * uStyle * jitterScale;
  A = mid + vec2(-0.42, 0.18) * len + jit;   // upper-left: pen touches down
  B = mid + vec2(-0.12, -0.30) * len + jit;  // bottom vertex: short down-stroke
  C = mid + vec2(0.55, 0.42) * len + jit;    // far upper-right: long up-flick
}

// Sample the checkmark path at arc-distance fraction u in [0,1]: returns the
// position, and outputs the local segment param (segT in 0..1) plus which leg
// (0 = down-stroke, 1 = up-flick) so callers can shape pressure along travel.
// u01 is the SAME for every fragment (a property of the path, not the pixel),
// so it's a clean coordinate for the pressure / wet / bristle profiles.
vec2 checkPos(vec2 A, vec2 B, vec2 C, float u, out float segT, out float leg){
  float l1 = length(B - A);
  float l2 = length(C - B);
  float total = max(l1 + l2, 1e-3);
  float d = u * total;
  if (d <= l1) {
    segT = d / max(l1, 1e-3);
    leg = 0.0;
    return mix(A, B, segT);
  }
  segT = (d - l1) / max(l2, 1e-3);
  leg = 1.0;
  return mix(B, C, segT);
}

// PRESSURE profile along the whole tick (arc fraction u in 0..1): thin where
// the pen first touches down, swelling into a heavy BELLY through the vertex and
// the base of the up-flick (where a real brush digs in hardest as it changes
// direction), then tapering to a thin exit on the flick's tip. A broad bump
// centered just past the corner makes the belly the dominant mass of the mark.
float inkPressure(float u){
  return exp(-pow((u - 0.46) * 2.2, 2.0)) * uPressure;
}

// End-cap taper (arc fraction u): fade the very entry and the very exit so the
// stroke reads as a written tick with thin terminals, not a blunt bar.
float inkTaper(float u){
  return smoothstep(0.0, 0.05, u) * (1.0 - smoothstep(0.88, 1.0, u));
}

// ---------------------------------------------------------------------------
// SHADOW silhouette — a cheap occlusion field for the bright forms (the drawn
// stroke body + the flung droplets). Just the mass, no wet bleed / bristle /
// tip-glow, so the extra pass stays light under software WebGL.
float inkOcclusion(vec2 p){
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);
  vec2 A, B, C;
  strokeGeom(0.0, A, B, C);   // drop the cel jitter for the shadow
  float base = minDim * 0.045;
  float occ = 0.0;

  // Walk the two-leg tick by arc fraction; only the drawn portion casts shadow.
  float segT, leg;
  const int STEPS = 16;
  for (int i = 0; i < STEPS; i++) {
    float u0 = float(i) / float(STEPS);
    float u1 = float(i + 1) / float(STEPS);
    if (u0 > uDraw) break;
    float uc = clamp((u0 + u1) * 0.5, 0.0, uDraw);
    vec2 a = checkPos(A, B, C, u0, segT, leg);
    vec2 b = checkPos(A, B, C, min(u1, uDraw), segT, leg);
    float belly = inkPressure(uc);
    float taper = inkTaper(uc);
    float rad = base * (0.55 + 1.25 * belly) * (0.4 + 0.6 * taper);
    float dist = sdSeg(p, a, b);
    occ = max(occ, 1.0 - smoothstep(rad * 0.7, rad, dist));
  }

  // Droplets: soft round mass, flung off the up-flick near its tip.
  vec2 launch = checkPos(A, B, C, 0.86, segT, leg);
  vec2 launchDir = normalize(checkPos(A, B, C, 0.92, segT, leg)
                           - checkPos(A, B, C, 0.78, segT, leg));
  float len = uScale * res.x;
  for (int i = 0; i < MAX_DROPS; i++) {
    if (float(i) >= uDroplets) break;
    vec2 hh = hash21(float(i) * 5.3 + uSeed + 11.0);
    float dl = 0.6 + hh.x * 0.25;
    float dlife = clamp((uLife - dl) / max(1.0 - dl, 0.001), 0.0, 1.0);
    if (dlife <= 0.0) continue;
    float spd = (0.4 + hh.y) * len * 0.9;
    float spread = (hh.x - 0.5) * 1.4;
    vec2 dir = normalize(launchDir + vec2(-launchDir.y, launchDir.x) * spread);
    vec2 dp = launch + dir * spd * dlife - vec2(0.0, 1.0) * (minDim * 0.9) * dlife * dlife;
    float dsz = minDim * 0.006 * (0.4 + hh.y * 0.9) * (1.0 - 0.5 * dlife);
    float dd = length(p - dp);
    occ = max(occ, (1.0 - smoothstep(dsz * 0.5, dsz * 1.2, dd)) * (1.0 - dlife) * 0.7);
  }

  return clamp(occ * uAmp, 0.0, 1.0);
}

vec4 inkShadowColor(vec2 frag){
  vec2 sp = frag - uShadowOffset;
  float occ = inkOcclusion(sp);
  float soft = uShadowSoft;
  occ += inkOcclusion(sp + vec2( soft, 0.0));
  occ += inkOcclusion(sp + vec2(-soft, 0.0));
  occ += inkOcclusion(sp + vec2(0.0,  soft));
  occ += inkOcclusion(sp + vec2(0.0, -soft));
  float s2 = soft * 0.7071;
  occ += inkOcclusion(sp + vec2( s2,  s2));
  occ += inkOcclusion(sp + vec2(-s2,  s2));
  occ += inkOcclusion(sp + vec2( s2, -s2));
  occ += inkOcclusion(sp + vec2(-s2, -s2));
  occ /= 9.0;
  float dark = clamp(occ, 0.0, 1.0) * uShadowStrength;
  vec3 tint = mix(vec3(1.0), 0.6 + 0.4 * normalize(uC0 + 1e-3), 0.25);
  vec3 mul = mix(vec3(1.0), tint, dark);
  return vec4(mul, 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);
  vec3 col = vec3(0.0);

  if (uShadow > 0.5) {
    fragColor = inkShadowColor(frag);
    return;
  }

  // ---- Stroke geometry: a real CHECKMARK written in one motion. ----
  // A SHORT down-stroke from the upper-left (A) to the bottom vertex (B), then a
  // LONG up-flick to the far upper-right (C) — an unambiguous approving tick. The
  // pen writes leg1 then leg2; uDraw advances along total arc length.
  float len = uScale * res.x;
  vec2 A, B, C;
  strokeGeom(1.0, A, B, C);   // includes the cel "on twos" jitter (whimsy)

  // The pen has written up to arc fraction uDraw along the tick. Walk the path
  // in a few steps; for each, treat it as a capsule with pressure-varying radius
  // and accumulate coverage. (Cheap analytic approximation of a swept brush.)
  float base = minDim * 0.045;                     // base half-width (bold)
  float ink = 0.0;       // 0..1 ink coverage (solid body)
  float edge = 0.0;      // proximity to the wet outer edge (for bleed/spray)
  float bodyT = 0.0;     // arc fraction at the nearest body sample (0..1)
  float nearAcross = 0.0;// signed across-offset / radius at nearest point (-1..1)
  vec2 tipPos = A; float tipR = base;              // running leading-tip pos
  float bestDist = 1e9;
  float segT, leg;

  const int STEPS = 28;
  for (int i = 0; i < STEPS; i++) {
    float u0 = float(i) / float(STEPS);
    float u1 = float(i + 1) / float(STEPS);
    // Only consider the written portion of the path.
    if (u0 > uDraw) break;
    float uc = clamp((u0 + u1) * 0.5, 0.0, uDraw);
    vec2 a = checkPos(A, B, C, u0, segT, leg);
    vec2 b = checkPos(A, B, C, min(u1, uDraw), segT, leg);

    // Across-direction of THIS leg (the two legs travel differently), so the
    // bristle rake and the signed offset stay true to the local travel.
    vec2 ba = b - a;
    vec2 dirL = normalize(length(ba) > 1e-3 ? ba : (leg < 0.5 ? B - A : C - B));
    vec2 across2 = vec2(-dirL.y, dirL.x);

    // PRESSURE profile along arc length: thin in, heavy belly through the
    // vertex/flick base, thin flick out. Applied identically on both legs.
    float belly = inkPressure(uc);
    float taper = inkTaper(uc);
    float rad = base * (0.55 + 1.25 * belly) * (0.4 + 0.6 * taper);

    // Wet-edge wobble: perturb radius with FBM so the contour is irregular
    // (only really visible at high wetness; bounded so the body stays solid).
    float wob = (fbm(vec2(uc * 8.0 + uSeed, uTimeS * 0.2)) - 0.5) * uWetness;
    rad *= (1.0 + 0.30 * wob);

    // Capsule SDF for this short segment.
    vec2 pa = frag - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
    vec2 near = a + ba * h;
    float dist = length(frag - near);

    if (dist < bestDist) {
      bestDist = dist;
      bodyT = uc;
      tipR = rad;
      // signed normalized across-offset of this fragment from the spine
      nearAcross = clamp(dot(frag - near, across2) / max(rad, 1.0), -1.0, 1.0);
    }
    // Coverage: a wide solid interior with a soft contact edge.
    float cov = 1.0 - smoothstep(rad * 0.85, rad, dist);
    ink = max(ink, cov);
    edge = max(edge, (1.0 - smoothstep(rad, rad * 1.7, dist)) * (1.0 - cov));
    tipPos = b;
  }

  // BRISTLE / dry-brush: a SUBTLE rake. A handful of fine streaks parallel to
  // travel, sampled by the across-offset so they sit correctly inside the
  // stroke; the central spine is protected so the mark always reads as one
  // confident gesture, not hatching. Bristle only darkens slightly.
  float bristleField = 0.5 + 0.5 * sin(nearAcross * 14.0 + uSeed * 6.28
                       + fbm(vec2(bodyT * 6.0, nearAcross * 3.0) + uSeed) * 4.0);
  float spine = smoothstep(0.9, 0.2, abs(nearAcross));          // protect centre
  float rake = 1.0 - uBristle * (1.0 - spine) * (1.0 - bristleField) * 0.7;
  ink *= rake;

  // INK BLEED HALO: the wet edge spreads into the paper as a soft, FBM-broken
  // stain — like the "darkest value spreads" fluid reveal, but baked analytic.
  float bleed = edge * uWetness * (0.5 + 0.7 * fbm(frag / minDim * 18.0 + uSeed));

  // PAPER WASH: a faint halo that HUGS the gesture — a soft glow falling off
  // from the stroke spine (NOT a radial core, NOT a full-width band): it traces
  // the same directional arc, so the light it casts follows the mark instead of
  // pooling elsewhere on the page.
  float wash = exp(-bestDist / (minDim * 0.10)) * 0.10 * smoothstep(0.02, 0.12, uDraw);

  float gain = uAmp * uExposure;
  // Compose the ink as a COHERENT mark: the body holds the core hue (uC0/uC1),
  // drifting only gently along its length so it has life without going rainbow;
  // the bleeding wet edge is where the accent hue (uC2) shows. This keeps the
  // gesture reading as a single confident stroke of one ink, not a spectrum.
  vec3 inkCol = mix(uC0, uC1, 0.2 + 0.3 * bodyT);
  col += inkCol * ink * gain;
  col += mix(uC1, uC2, 0.6) * bleed * gain * 0.85;
  col += mix(uC0, uC1, 0.4) * wash * gain;

  // WET-EDGE IRIDESCENCE + DISPERSION (borrowed from Solarbloom): on the wet,
  // serene end the bleeding edge catches an oil-on-water sheen — a faint
  // IQ-cosine spectral tint riding the wet halo — plus a slight chromatic split
  // that fringes the contact edge. Gated by wetness (so it's a WET-ink quality,
  // not a property of the dry slash) and faded out toward the cel/neon end. The
  // body keeps its single-ink identity; only the wet rim shimmers.
  float wetSheen = bleed * uWetness * (1.0 - uStyle);
  if (wetSheen > 0.001) {
    float irPhase = bodyT * 0.7 + nearAcross * 0.5 + uTimeS * 0.25
                  + fbm(frag / minDim * 9.0 + uSeed) * 1.2;
    vec3 irid = iridescent(fract(irPhase));
    col = mix(col, col * (0.55 + 1.2 * irid), wetSheen * 0.35);
    col += irid * wetSheen * 0.10 * gain;
    // Chromatic split at the wet contact edge: a thin per-channel offset.
    float disp = (0.04 + 0.08 * edge) * uWetness * (1.0 - uStyle) * (0.7 + 0.5 * uAmp);
    col.r += edge * disp * 0.6 * gain;
    col.b -= edge * disp * 0.5 * gain;
  }

  // WET LEADING TIP: a bright hot point that races at the pen head while
  // drawing, with a short afterglow. This is the "it's happening now" spark.
  float drawing = smoothstep(0.0, 0.05, uDraw) * (1.0 - smoothstep(0.9, 1.04, uDraw));
  float td = length(frag - tipPos);
  float tipGlow = (tipR * 1.7) / (td + tipR * 0.5); tipGlow *= tipGlow;
  col += vec3(1.0) * tipGlow * drawing * gain * 1.8;

  // DROPLET SPRAY: ink flung off the up-flick. Each droplet launches from near
  // the flick tip once the stroke passes ~0.6, arcs out along the flick's travel
  // direction and falls under gravity, fading.
  vec2 launch = checkPos(A, B, C, 0.86, segT, leg);
  vec2 launchDir = normalize(checkPos(A, B, C, 0.92, segT, leg)
                           - checkPos(A, B, C, 0.78, segT, leg));
  for (int i = 0; i < MAX_DROPS; i++) {
    if (float(i) >= uDroplets) break;
    vec2 hh = hash21(float(i) * 5.3 + uSeed + 11.0);
    float dl = 0.6 + hh.x * 0.25;                 // launches as the flick happens
    float dlife = clamp((uLife - dl) / max(1.0 - dl, 0.001), 0.0, 1.0);
    if (dlife <= 0.0) continue;
    float spd = (0.4 + hh.y) * len * 0.9;
    float spread = (hh.x - 0.5) * 1.4;
    vec2 dir = normalize(launchDir + vec2(-launchDir.y, launchDir.x) * spread);
    // Ballistic arc via the shared particle helper (outward + gravity; y is up).
    vec2 dp = ballisticPos(launch, dir, spd, minDim * 0.9, dlife);
    float dsz = minDim * 0.006 * (0.4 + hh.y * 0.9) * (1.0 - 0.5 * dlife);
    float dd = length(frag - dp);
    float drop = particleSprite(dd, dsz);   // shared soft round sprite
    // toon: crisp the droplet into a hard dot toward the cel end.
    if (uStyle > 0.001) {
      float crisp = 1.0 - smoothstep(dsz * 0.9, dsz, dd);
      drop = mix(drop, crisp, uStyle * 0.9);
    }
    float dfade = (1.0 - dlife) * smoothstep(0.0, 0.1, dlife);
    col += paletteMix(0.6 + hh.y * 0.4) * drop * dfade * gain * 1.1;
  }

  // AFTER-SHIMMER underline: once the stroke is essentially done, a quick
  // horizontal sweep of light settles beneath the gesture (a confident
  // "signed" underline) then fades — reinforces the success read without a core.
  float ul = smoothstep(0.78, 0.92, uDraw) * (1.0 - smoothstep(0.45, 1.0, uLife));
  // Settle the underline just below the tick's bottom vertex, spanning its width.
  float ulY = B.y - len * 0.10;
  float uy = exp(-pow((frag.y - ulY) / (minDim * 0.012), 2.0));
  float ux = smoothstep(A.x, A.x + len * 0.1, frag.x) * (1.0 - smoothstep(C.x - len * 0.05, C.x, frag.x));
  col += paletteMix(0.4) * uy * ux * ul * gain * 0.8;

  // ---- Tone + finishing ----
  // ACES filmic tonemap (shared look/glsl, borrowed from Solarbloom) for a
  // cleaner highlight rolloff + richer mid-ink than the old x/(1+x) compress —
  // gentler gradients on the page beneath. A mild pre-exposure keeps the wet
  // mid-ink from dimming while letting the wet highlights roll off gracefully.
  col = tonemapACES(col * 0.82);

  // ---- Non-photoreal pass: cel / neon flattening (whimsy) ----
  // Toward the cel end we want a FLAT, bold neon slash with a clean glowing
  // rim — NOT a posterized photo. So instead of quantizing the whole frame
  // (which shatters the soft wash into camouflage blocks), we rebuild the
  // stroke as flat cel cells: a hard-edged solid fill + a bright outline,
  // keyed off the analytic coverage we already have.
  if (uStyle > 0.001) {
    // Hard silhouette of the drawn body (a couple of cel "tones", not 40).
    float fillMask = smoothstep(0.55, 0.62, ink);
    float coreMask = smoothstep(0.8, 0.86, ink);
    vec3 neonCore = clamp(uC0 * 1.5 + 0.15, 0.0, 1.2);
    vec3 neonMid = clamp(mix(uC0, uC1, 0.6) * 1.3, 0.0, 1.1);
    vec3 cel = neonMid * fillMask + (neonCore - neonMid) * coreMask;
    // Bright neon rim just outside the fill — the glowing cyberpunk outline.
    float rim = smoothstep(0.4, 0.56, ink) * (1.0 - fillMask);
    cel += clamp(uC2 * 1.6 + 0.2, 0.0, 1.3) * rim;
    // Replace the stroke region with the flat cel stroke, but DON'T posterize
    // the dark wash/background (that just shatters it into camouflage blocks).
    // The soft wash, droplets and tip stay as they are; only the body flattens.
    float strokeMask = clamp(fillMask + rim, 0.0, 1.0);
    vec3 styled = mix(col, cel * gain, strokeMask);
    col = mix(col, styled, uStyle);
  }

  // Ordered dither (~1/255, shared look/glsl) to kill banding the screen blend
  // would reveal; faded out toward the cel end where hard bands are intended.
  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);

  fragColor = vec4(max(col, 0.0), 1.0);
}`;
