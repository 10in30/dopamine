#include <metal_stdlib>
#include "DopamineLook.metal"
#include "LightningUniforms.metal"
using namespace metal;

#define MAX_FORKS 7
#define BOLT_SEGS 14
#define MAX_BOLTS 8
#define VPB 15

struct VSOut { float4 position [[position]]; };
vertex VSOut lightning_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float3 elecRamp(float t, constant LightningUniforms &u) {
  t = clamp(t, 0.0, 1.0);
  float3 rim = mix(u.c0, float3(0.45, 0.6, 1.0), 0.35);
  float3 mid = mix(u.c0, float3(0.8, 0.85, 1.0), 0.5);
  float3 hot = float3(1.0);
  return t < 0.5 ? mix(rim, mid, t * 2.0) : mix(mid, hot, (t - 0.5) * 2.0);
}

inline float2 boltGlowV(float2 frag, int b, int segCount, float radFrac, constant LightningUniforms &u, constant float2 *uVerts) {
  float minDim = min(u.resolution.x, u.resolution.y);
  float rad = minDim * radFrac;
  float glow = 0.0;
  float core = 0.0;
  int base = b * VPB;
  float2 prev = uVerts[base];
  for(int i = 1; i <= BOLT_SEGS; i++) {
    if(i > segCount) break;
    float2 cur = uVerts[base + i];
    float dist = dop_sdSeg(frag, prev, cur);
    glow += rad / (dist + rad * 0.35);
    core = max(core, 1.0 - smoothstep(rad * 0.25, rad * 0.6, dist));
    prev = cur;
  }
  glow = clamp(glow / float(BOLT_SEGS) * 2.2, 0.0, 1.4);
  return float2(core, glow);
}

inline float4 lightningShadowColor(float2 frag, constant LightningUniforms &u, constant float2 *uVerts, constant float4 *uBoltMeta) {
  float minDim = min(u.resolution.x, u.resolution.y);
  float rad = minDim * u.thickness * 1.6;
  int segCount = int(uBoltMeta[0].x + 0.5);
  float2 sp = frag - u.shadowOffset;
  float soft = u.shadowSoft;
  float s2 = soft * 0.7071;
  float2 taps[9];
  taps[0] = sp;
  taps[1] = sp + float2( soft, 0.0);
  taps[2] = sp + float2(-soft, 0.0);
  taps[3] = sp + float2(0.0,  soft);
  taps[4] = sp + float2(0.0, -soft);
  taps[5] = sp + float2( s2,  s2);
  taps[6] = sp + float2(-s2,  s2);
  taps[7] = sp + float2( s2, -s2);
  taps[8] = sp + float2(-s2, -s2);
  float occSum = 0.0;
  for(int k = 0; k < 9; k++) {
    float occ = 0.0;
    float2 prev = uVerts[0];
    for(int i = 1; i <= BOLT_SEGS; i++) {
      if(i > segCount) break;
      float2 cur = uVerts[i];
      occ = max(occ, 1.0 - smoothstep(rad * 0.6, rad, dop_sdSeg(taps[k], prev, cur)));
      prev = cur;
    }
    occSum += clamp(occ * u.amp, 0.0, 1.0);
  }
  occSum /= 9.0;
  float dark = clamp(occSum, 0.0, 1.0) * u.shadowStrength;
  float3 tint = mix(float3(1.0), 0.55 + 0.45 * normalize(elecRamp(0.2, u) + 1e-3), 0.25);
  return float4(mix(float3(1.0), tint, dark), 1.0);
}

fragment float4 lightning_fragment(
    VSOut in [[stage_in]],
    constant LightningUniforms &u [[buffer(0)]],
    constant float2 *uVerts [[buffer(1)]],
    constant float4 *uBoltMeta [[buffer(2)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float minDim = min(u.resolution.x, u.resolution.y);

  if(u.shadow > 0.5) {
    return lightningShadowColor(frag, u, uVerts, uBoltMeta);
  }

  float3 col = float3(0.0);
  float gain = u.exposure * u.amp;
  float boltCore = 0.0;
  float boltGlowAcc = 0.0;

  
  
  float haloVar = 0.1 * (dop_fbm(frag / minDim * 4.0 + u.boltSeed) - 0.5);

  
  
  for(int b = 0; b < MAX_BOLTS; b++) {
    float4 meta = uBoltMeta[b];
    int segCount = int(meta.x + 0.5);
    if(segCount < 1) continue;
    float fadeMul = meta.z;
    bool isMain = meta.w > 0.5;
    float2 g = boltGlowV(frag, b, segCount, meta.y, u, uVerts);
    float core = g.x * fadeMul;
    float glow = g.y * fadeMul;
    float haloT = clamp(glow * 0.7 + (isMain ? haloVar : 0.15), 0.0, 1.0);
    col += elecRamp(haloT, u) * glow * gain * (isMain ? 1.3 : 0.8);
    col += float3(1.0) * core * gain * (isMain ? 2.4 : 1.5);
    boltCore = max(boltCore, core);
    boltGlowAcc = max(boltGlowAcc, glow);
  }

  
  float landed = smoothstep(0.7, 1.0, u.strike) * (0.4 + 0.6 * (1.0 - smoothstep(0.1, 0.5, u.life)));
  float dB = length(frag - u.origin);
  float impact = (minDim * u.thickness * 2.0) / (dB + minDim * u.thickness * 1.4);
  impact *= impact;
  col += elecRamp(0.7, u) * impact * landed * gain * 0.8;

  
  float flashRadial = 0.28 + 0.72 * exp(-dB / (minDim * 0.5));
  float3 flashCol = mix(float3(1.0), elecRamp(0.6, u), 0.25);
  col += flashCol * u.flash * u.flashBright * flashRadial;

  col = dop_tonemapACES(col * 0.9);

  
  if(u.style > 0.001) {
    float coreMask = smoothstep(0.45, 0.65, boltCore);
    float bandMask = smoothstep(0.45, 0.8, boltGlowAcc) * (1.0 - coreMask);
    float3 boltColor = clamp(elecRamp(0.35, u) * 1.5 + 0.05, 0.0, 1.3);
    float3 cel = float3(1.0) * coreMask + boltColor * bandMask;
    float boltMask = clamp(coreMask + bandMask, 0.0, 1.0);
    col = mix(col, mix(col, cel, boltMask), u.style);
  }

  col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style);
  col = max(col, 0.0);
    float bk = clamp(u.backdropLum, 0.0, 1.0);
    float luma = dot(col, float3(0.2126, 0.7152, 0.0722));
    col = max(mix(float3(luma), col, 1.0 + bk * 0.600), 0.0);
    float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    outA = clamp(outA * (1.0 + bk * 0.800), 0.0, 1.0);
    return float4(col, outA);
}
