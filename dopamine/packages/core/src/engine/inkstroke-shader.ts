/**
 * GLSL ES 3.00 source for **Calligraphic Verdict** — Dopamine's second success
 * effect, and a deliberate DIVERGENCE from Solarbloom's centered radial bloom.
 *
 * Governing metaphor: a master's confident SIGNATURE STROKE. Instead of light
 * radiating outward from a point, a single calligraphic ink/light gesture WRITES
 * ITSELF horizontally across the frame — a downward dip and an upward flick (an
 * abstracted check / approving flourish). The composition is directional and
 * asymmetric, not concentric.
 *
 * Layers, summed as light (canvas is black, composited `mix-blend-mode: screen`,
 * so black == no change, bright == cast light onto the page beneath):
 *   1. PAPER WASH — a faint, low, off-center horizontal band of light that the
 *      stroke is laid onto (gives the gesture a "ground" without a radial core).
 *   2. THE STROKE — a quadratic-Bezier brush path with PRESSURE-modulated width
 *      (thin entry, heavy belly, thin exit), wet-ink bleed via FBM along the
 *      edge, bristle/dry-brush streaks raked along the travel direction, and a
 *      bright WET LEADING TIP that races ahead of the fill (the "pen").
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

#define MAX_DROPS 64
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_PALETTE_MIX}
${GLSL_IRIDESCENT}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
${GLSL_SD_SEG}
${GLSL_PARTICLES}

// Quadratic Bezier B(t) = (1-t)^2 P0 + 2(1-t)t P1 + t^2 P2 (Verdict-specific).
vec2 bez(vec2 a, vec2 b, vec2 c, float t){
  float s = 1.0 - t;
  return s*s*a + 2.0*s*t*b + t*t*c;
}

// Stroke control points — shared by the light pass and the shadow silhouette so
// the cast shadow tracks exactly what's drawn. jitterScale lets the shadow drop
// the cel "on twos" jitter (a shadow shouldn't shimmer).
void strokeGeom(float jitterScale, out vec2 P0, out vec2 P1, out vec2 P2){
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);
  float len = uScale * res.x;
  vec2 mid = vec2(res.x * 0.5, res.y * 0.46);
  float bt = floor(uTimeS * 12.0);
  vec2 jit = (hash21(bt + uSeed) - 0.5) * minDim * 0.02 * uStyle * jitterScale;
  P0 = mid + vec2(-0.52, 0.10) * len + jit;
  P1 = mid + vec2(-0.02, 0.42) * len + jit;
  P2 = mid + vec2(0.55, -0.30) * len + jit;
}

// ---------------------------------------------------------------------------
// SHADOW silhouette — a cheap occlusion field for the bright forms (the drawn
// stroke body + the flung droplets). Just the mass, no wet bleed / bristle /
// tip-glow, so the extra pass stays light under software WebGL.
float inkOcclusion(vec2 p){
  vec2 res = uResolution;
  float minDim = min(res.x, res.y);
  vec2 P0, P1, P2;
  strokeGeom(0.0, P0, P1, P2);   // drop the cel jitter for the shadow
  float base = minDim * 0.045;
  float occ = 0.0;

  const int STEPS = 16;
  for (int i = 0; i < STEPS; i++) {
    float t0 = float(i) / float(STEPS);
    float t1 = float(i + 1) / float(STEPS);
    if (t0 > uDraw) break;
    float tc = clamp((t0 + t1) * 0.5, 0.0, uDraw);
    vec2 a = bez(P0, P1, P2, t0);
    vec2 b = bez(P0, P1, P2, min(t1, uDraw));
    float belly = exp(-pow((tc - 0.42) * 2.1, 2.0)) * uPressure;
    float taper = smoothstep(0.0, 0.05, tc) * (1.0 - smoothstep(0.86, 1.0, tc));
    float rad = base * (0.55 + 1.25 * belly) * (0.4 + 0.6 * taper);
    float dist = sdSeg(p, a, b);
    occ = max(occ, 1.0 - smoothstep(rad * 0.7, rad, dist));
  }

  // Droplets: soft round mass.
  vec2 launch = bez(P0, P1, P2, 0.78);
  vec2 launchDir = normalize(bez(P0, P1, P2, 0.85) - bez(P0, P1, P2, 0.7));
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

  // ---- Stroke geometry: a left->right gesture that dips then flicks up. ----
  // Anchored low-left, control point pulls the belly down, exit flicks up-right
  // (the approving check / signature flourish). Off-center on purpose.
  float len = uScale * res.x;
  vec2 mid = vec2(res.x * 0.5, res.y * 0.46);
  // Animate-on-twos jitter of the whole gesture toward the cel end.
  float bt = floor(uTimeS * 12.0);
  vec2 jit = (hash21(bt + uSeed) - 0.5) * minDim * 0.02 * uStyle;
  vec2 P0 = mid + vec2(-0.52, 0.10) * len + jit;
  vec2 P1 = mid + vec2(-0.02, 0.42) * len + jit;   // belly dips DOWN
  vec2 P2 = mid + vec2(0.55, -0.30) * len + jit;   // flick UP and right

  // The pen has drawn up to parameter uDraw along the curve. Walk the curve in
  // a few steps; for each, treat it as a capsule with pressure-varying radius
  // and accumulate coverage. (Cheap analytic approximation of a swept brush.)
  float base = minDim * 0.045;                     // base half-width (bold)
  float ink = 0.0;       // 0..1 ink coverage (solid body)
  float edge = 0.0;      // proximity to the wet outer edge (for bleed/spray)
  float bodyT = 0.0;     // curve param at the nearest body sample (0..1)
  float nearAcross = 0.0;// signed across-offset / radius at nearest point (-1..1)
  vec2 tipPos = P0; float tipR = base;             // running leading-tip pos
  float bestDist = 1e9;

  vec2 dirN = normalize(P2 - P0);
  vec2 across2 = vec2(-dirN.y, dirN.x);

  const int STEPS = 28;
  for (int i = 0; i < STEPS; i++) {
    float t0 = float(i) / float(STEPS);
    float t1 = float(i + 1) / float(STEPS);
    // Only consider drawn portion of the curve.
    if (t0 > uDraw) break;
    float tc = clamp((t0 + t1) * 0.5, 0.0, uDraw);
    vec2 a = bez(P0, P1, P2, t0);
    vec2 b = bez(P0, P1, P2, min(t1, uDraw));

    // PRESSURE profile: thin in, heavy belly, thin flick out. A broad bump
    // centered near t=0.42 makes the belly the dominant mass of the gesture.
    float belly = exp(-pow((tc - 0.42) * 2.1, 2.0)) * uPressure;
    float taper = smoothstep(0.0, 0.05, tc) * (1.0 - smoothstep(0.86, 1.0, tc));
    float rad = base * (0.55 + 1.25 * belly) * (0.4 + 0.6 * taper);

    // Wet-edge wobble: perturb radius with FBM so the contour is irregular
    // (only really visible at high wetness; bounded so the body stays solid).
    float wob = (fbm(vec2(tc * 8.0 + uSeed, uTimeS * 0.2)) - 0.5) * uWetness;
    rad *= (1.0 + 0.30 * wob);

    // Capsule SDF for this short segment.
    vec2 pa = frag - a, ba = b - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
    vec2 near = a + ba * h;
    float dist = length(frag - near);

    if (dist < bestDist) {
      bestDist = dist;
      bodyT = tc;
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

  // DROPLET SPRAY: ink flung off the flick. Each droplet launches near the tip
  // once the stroke passes ~0.6, arcs out and falls under gravity, fading.
  vec2 launch = bez(P0, P1, P2, 0.78);
  vec2 launchDir = normalize(bez(P0, P1, P2, 0.85) - bez(P0, P1, P2, 0.7));
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
  float uy = exp(-pow((frag.y - (mid.y - len * 0.12)) / (minDim * 0.012), 2.0));
  float ux = smoothstep(P0.x, P0.x + len * 0.1, frag.x) * (1.0 - smoothstep(P2.x - len * 0.05, P2.x, frag.x));
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
