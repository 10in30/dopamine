// GLSL ES 3.00 source for Lightning — the reworked web `lightning-shader.ts`
// (PRECOMPUTED-VERTEX glow) reused verbatim. The bolt polyline (trunk + forks) is
// computed on the CPU once per frame (LightningRenderer.kt) and fed in as the
// `uVerts` / `uBoltMeta` uniform arrays; the fragment shader walks those segments
// with cheap `sdSeg` + the original inverse-distance plasma glow. Look chunks come
// from dopamine-core. The ONLY change from the web body is the final emit:
// `dopLightOut(col)` (premultiplied light) for the self-contained overlay.

package ai.dopamine.effect.lightning

import ai.dopamine.core.GLSL_CONSTANTS
import ai.dopamine.core.GLSL_DITHER
import ai.dopamine.core.GLSL_FBM
import ai.dopamine.core.GLSL_FULLSCREEN_VERTEX
import ai.dopamine.core.GLSL_HASH
import ai.dopamine.core.GLSL_LIGHT_OUT
import ai.dopamine.core.GLSL_SD_SEG
import ai.dopamine.core.GLSL_TONEMAP_ACES

/** Max secondary forks — shared by the renderer + the `.dope` clamp (MAX_FORKS). */
const val MAX_FORKS = 7
/** Polyline segment count of the main bolt (and forks). More = jaggier arc. */
const val BOLT_SEGS = 14
/** Main trunk + forks. */
const val MAX_BOLTS = 1 + MAX_FORKS
/** Vertices stored per bolt (BOLT_SEGS + 1). */
const val VERTS_PER_BOLT = BOLT_SEGS + 1

val LIGHTNING_VERTEX_SRC: String = GLSL_FULLSCREEN_VERTEX

val LIGHTNING_FRAGMENT_SRC: String = """#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2  uResolution;    // device pixels
uniform vec2  uOrigin;        // strike point (gl coords, y-up)
uniform float uStrike;        // bolt strike progress 0..1 (impact timing)
uniform float uFlash;         // strobe/flash amplitude
uniform float uLife;          // whole-effect progress 0..1
uniform float uTimeS;         // elapsed seconds
uniform float uAmp;           // impact envelope amplitude (peaks > 1)
uniform float uThickness;     // bolt half-width as fraction of min dim (impact sizing)
uniform float uFlashBright;   // peak flash brightness multiplier
uniform float uExposure;      // overall light gain
uniform float uSeed;          // per-fire hash offset (halo variation)
uniform float uStyle;         // 0..1 photoreal plasma -> cel comic bolt (whimsy)
uniform float uShadow;        // 0 = light pass (screen), 1 = shadow pass (multiply)
uniform vec2  uShadowOffset;  // device-px offset of the cast silhouette
uniform float uShadowSoft;    // penumbra softness in device px
uniform float uShadowStrength;// 0..1 max darkening of the multiply layer
uniform vec3  uC0;            // electric core hue
// CPU-precomputed bolt polyline: uVerts[b*VPB + i] is vertex i of bolt b
// (device px, gl coords); uBoltMeta[b] = (segCount, radFrac, fadeMul, isMain).
uniform vec2  uVerts[${MAX_BOLTS * VERTS_PER_BOLT}];
uniform vec4  uBoltMeta[${MAX_BOLTS}];

#define MAX_FORKS $MAX_FORKS
#define BOLT_SEGS $BOLT_SEGS
#define MAX_BOLTS $MAX_BOLTS
#define VPB $VERTS_PER_BOLT
${GLSL_CONSTANTS}
${GLSL_HASH}
${GLSL_FBM}
${GLSL_TONEMAP_ACES}
${GLSL_DITHER}
${GLSL_SD_SEG}
${GLSL_LIGHT_OUT}

// Electric channel colour ramp: a tight blue/violet -> hot white anchored on uC0
// (so the bolt stays monochromatic electric, not the roaming golden-angle palette).
vec3 elecRamp(float t){
  t = clamp(t, 0.0, 1.0);
  vec3 rim = mix(uC0, vec3(0.45, 0.6, 1.0), 0.35);
  vec3 mid = mix(uC0, vec3(0.8, 0.85, 1.0), 0.5);
  vec3 hot = vec3(1.0);
  return t < 0.5 ? mix(rim, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
}

// Glow of bolt `b` at frag: walk its precomputed segments, accumulate the same
// inverse-distance plasma glow + hot core the original boltGlow used. radFrac is
// the bolt half-width as a frac of minDim. Returns vec2(core, glow).
vec2 boltGlowV(vec2 frag, int b, int segCount, float radFrac){
  float minDim = min(uResolution.x, uResolution.y);
  float rad = minDim * radFrac;
  float glow = 0.0;
  float core = 0.0;
  int base = b * VPB;
  vec2 prev = uVerts[base];
  for (int i = 1; i <= BOLT_SEGS; i++) {
    if (i > segCount) break;
    vec2 cur = uVerts[base + i];
    float dist = sdSeg(frag, prev, cur);
    glow += rad / (dist + rad * 0.35);
    core = max(core, 1.0 - smoothstep(rad * 0.25, rad * 0.6, dist));
    prev = cur;
  }
  glow = clamp(glow / float(BOLT_SEGS) * 2.2, 0.0, 1.4);
  return vec2(core, glow);
}

// SHADOW: the main bolt's silhouette only (matches the original), 9-tap ring blur.
vec4 lightningShadowColor(vec2 frag){
  float minDim = min(uResolution.x, uResolution.y);
  float rad = minDim * uThickness * 1.6;
  int segCount = int(uBoltMeta[0].x + 0.5);
  vec2 sp = frag - uShadowOffset;
  float soft = uShadowSoft;
  float s2 = soft * 0.7071;
  vec2 taps[9];
  taps[0] = sp;
  taps[1] = sp + vec2( soft, 0.0);
  taps[2] = sp + vec2(-soft, 0.0);
  taps[3] = sp + vec2(0.0,  soft);
  taps[4] = sp + vec2(0.0, -soft);
  taps[5] = sp + vec2( s2,  s2);
  taps[6] = sp + vec2(-s2,  s2);
  taps[7] = sp + vec2( s2, -s2);
  taps[8] = sp + vec2(-s2, -s2);
  float occSum = 0.0;
  for (int k = 0; k < 9; k++) {
    float occ = 0.0;
    vec2 prev = uVerts[0];
    for (int i = 1; i <= BOLT_SEGS; i++) {
      if (i > segCount) break;
      vec2 cur = uVerts[i];
      occ = max(occ, 1.0 - smoothstep(rad * 0.6, rad, sdSeg(taps[k], prev, cur)));
      prev = cur;
    }
    occSum += clamp(occ * uAmp, 0.0, 1.0);
  }
  occSum /= 9.0;
  float dark = clamp(occSum, 0.0, 1.0) * uShadowStrength;
  vec3 tint = mix(vec3(1.0), 0.55 + 0.45 * normalize(elecRamp(0.2) + 1e-3), 0.25);
  return vec4(mix(vec3(1.0), tint, dark), 1.0);
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  float minDim = min(uResolution.x, uResolution.y);

  if (uShadow > 0.5) {
    fragColor = lightningShadowColor(frag);
    return;
  }

  vec3 col = vec3(0.0);
  float gain = uExposure * uAmp;
  float boltCore = 0.0;
  float boltGlowAcc = 0.0;

  // A touch of living fbm variation on the halo — ONE fbm/pixel (was the only
  // per-pixel noise we keep; the bolt geometry is precomputed on the CPU).
  float haloVar = 0.1 * (fbm(frag / minDim * 4.0 + uSeed) - 0.5);

  // Trunk + forks: same glow/colour accumulation as the original, reading the
  // precomputed polyline. uBoltMeta[b] = (segCount, radFrac, fadeMul, isMain).
  for (int b = 0; b < MAX_BOLTS; b++) {
    vec4 meta = uBoltMeta[b];
    int segCount = int(meta.x + 0.5);
    if (segCount < 1) continue;
    float fadeMul = meta.z;
    bool isMain = meta.w > 0.5;
    vec2 g = boltGlowV(frag, b, segCount, meta.y);
    float core = g.x * fadeMul;
    float glow = g.y * fadeMul;
    float haloT = clamp(glow * 0.7 + (isMain ? haloVar : 0.15), 0.0, 1.0);
    col += elecRamp(haloT) * glow * gain * (isMain ? 1.3 : 0.8);
    col += vec3(1.0) * core * gain * (isMain ? 2.4 : 1.5);
    boltCore = max(boltCore, core);
    boltGlowAcc = max(boltGlowAcc, glow);
  }

  // ---- IMPACT GLOW ---- bright radial burst at the strike point, easing off.
  float landed = smoothstep(0.7, 1.0, uStrike) * (0.4 + 0.6 * (1.0 - smoothstep(0.1, 0.5, uLife)));
  float dB = length(frag - uOrigin);
  float impact = (minDim * uThickness * 2.0) / (dB + minDim * uThickness * 1.4);
  impact *= impact;
  col += elecRamp(0.7) * impact * landed * gain * 0.8;

  // ---- FLASH / STROBE ---- hard near-white wash, hottest at the strike point.
  float flashRadial = 0.28 + 0.72 * exp(-dB / (minDim * 0.5));
  vec3 flashCol = mix(vec3(1.0), elecRamp(0.6), 0.25);
  col += flashCol * uFlash * uFlashBright * flashRadial;

  col = tonemapACES(col * 0.9);

  // ---- Cel / comic-book bolt (whimsy) ---- flatten ONLY the bolt forms.
  if (uStyle > 0.001) {
    float coreMask = smoothstep(0.45, 0.65, boltCore);
    float bandMask = smoothstep(0.45, 0.8, boltGlowAcc) * (1.0 - coreMask);
    vec3 boltColor = clamp(elecRamp(0.35) * 1.5 + 0.05, 0.0, 1.3);
    vec3 cel = vec3(1.0) * coreMask + boltColor * bandMask;
    float boltMask = clamp(coreMask + bandMask, 0.0, 1.0);
    col = mix(col, mix(col, cel, boltMask), uStyle);
  }

  col = ditherAdd(col, frag, uTimeS, 1.0 - uStyle);
  // ANDROID self-contained overlay: premultiplied light (alpha = brightness)
  // instead of the web's opaque `vec4(max(col,0.0), 1.0)`. See Look.kt.
  fragColor = dopLightOut(col);
}"""
