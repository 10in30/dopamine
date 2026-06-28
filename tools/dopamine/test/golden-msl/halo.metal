#include <metal_stdlib>
#include "DopamineLook.metal"
#include "HaloUniforms.metal"
using namespace metal;

struct VSOut { float4 position [[position]]; };
vertex VSOut halo_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float2x2 rot2(float a) { float s = sin(a), c = cos(a); return float2x2(float2(c, -s), float2(s, c)); }

inline float liveRadius(constant HaloUniforms &u) {
  float ph = TAU * u.phase;
  return u.ringRadius + sin(ph) * u.breathe * u.ringWidth * 1.6;
}

inline float ringCoverage(float rn, float radius, float halfW) {
  float d = abs(rn - radius);
  return exp(-(d * d) / (2.0 * halfW * halfW + 1e-6));
}

inline float3 haloLight(float2 frag, float minDim, constant HaloUniforms &u) {
  float2 rel = (frag - u.origin) / minDim;       
  float rn = length(rel);
  
  
  float rot = TAU * u.phase;
  float2 rdir = rot2(rot) * rel;
  float ang = atan2(rdir.y, rdir.x);            
  float angN = ang / TAU + 0.5;                

  float radius = liveRadius(u);
  float halfW = max(u.ringWidth, 1e-3);

  
  float breatheB = 1.0 + sin(TAU * u.phase) * u.breathe * 0.5;
  float gain = u.amp * u.exposure * breatheB;

  
  
  
  
  
  float tcol = abs(fract(angN + sin(TAU * u.phase) * 0.045) * 2.0 - 1.0);
  tcol = clamp(tcol + (dop_fbm(rdir * 6.0 + float2(cos(TAU * u.phase), sin(TAU * u.phase)) * 0.075) - 0.5) * 0.12, 0.0, 1.0);
  float3 ringCol = dop_paletteMix(tcol, u.c0, u.c1, u.c2);

  float3 col = float3(0.0);

  
  float cov = ringCoverage(rn, radius, halfW);
  col += ringCol * cov * gain;

  
  float glow = exp(-(rn * rn) / (2.0 * (radius * 0.85) * (radius * 0.85) + 1e-4));
  col += ringCol * glow * u.glow * gain * 0.28;

  
  
  
  
  
  float head = fract(u.phase * u.sweepTurns);                          
  float ad = fract(angN - head + 1.0);                               
  float arcHalf = max(u.sweepArc, 0.02);
  float sweepMask = exp(-ad / (arcHalf * 0.9 + 1e-3)) * cov;          
  float3 sweepCol = mix(u.c2, float3(1.0), 0.4);
  col += sweepCol * sweepMask * gain * 1.15;

  return col;
}

inline float haloOcclusion(float2 frag, float minDim, constant HaloUniforms &u) {
  float2 rel = (frag - u.origin) / minDim;
  float rn = length(rel);
  float cov = ringCoverage(rn, liveRadius(u), max(u.ringWidth, 1e-3));
  return clamp(cov * u.amp, 0.0, 1.0);
}

inline float4 haloShadowColor(float2 frag, float minDim, constant HaloUniforms &u) {
  float2 sp = frag - u.shadowOffset;
  float soft = u.shadowSoft;
  float occ = haloOcclusion(sp, minDim, u);
  occ += haloOcclusion(sp + float2( soft, 0.0), minDim, u);
  occ += haloOcclusion(sp + float2(-soft, 0.0), minDim, u);
  occ += haloOcclusion(sp + float2(0.0,  soft), minDim, u);
  occ += haloOcclusion(sp + float2(0.0, -soft), minDim, u);
  occ /= 5.0;
  
  float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength * 0.45;
  float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.2);
  float3 mul = mix(float3(1.0), tint, dark);
  return float4(mul, 1.0);
}

fragment float4 halo_fragment(
    VSOut in [[stage_in]],
    constant HaloUniforms &u [[buffer(0)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float2 res = u.resolution;
  float minDim = min(res.x, res.y);

  if(u.shadow > 0.5) {
    return haloShadowColor(frag, minDim, u);
  }

  float3 col = haloLight(frag, minDim, u);

  
  col = dop_tonemapACES(col * 0.95);

  
  
  
  
  
  if(u.style > 0.001) {
    float2 rel = (frag - u.origin) / minDim;
    float rn = length(rel);
    float radius = liveRadius(u);
    float halfW = max(u.ringWidth, 1e-3);
    float cov = ringCoverage(rn, radius, halfW);
    
    float rot = TAU * u.phase;
    float2 rdir = rot2(rot) * rel;
    float angN = atan2(rdir.y, rdir.x) / TAU + 0.5;
    float tcol = abs(fract(angN + sin(TAU * u.phase) * 0.045) * 2.0 - 1.0);
    float3 ringCol = dop_paletteMix(clamp(tcol, 0.0, 1.0), u.c0, u.c1, u.c2);
    float breatheB = 1.0 + sin(TAU * u.phase) * u.breathe * 0.5;
    float gain = u.amp * u.exposure * breatheB;
    
    float band = smoothstep(0.35, 0.55, cov);
    
    float head = fract(u.phase * u.sweepTurns);
    float ad = fract(angN - head + 1.0);
    float arcHalf = max(u.sweepArc, 0.02);
    float celSweep = step(ad, arcHalf) * band;
    float3 cel = clamp(ringCol * 1.25, 0.0, 1.2) * band
             + mix(u.c2, float3(1.0), 0.5) * celSweep * 0.9;
    cel *= gain;
    col = mix(col, cel, u.style);
  }

  
  
  
  col = dop_ditherAdd(col, frag, u.loopS, 1.0 - u.style);

  col = max(col, 0.0);
    float bk = clamp(u.backdropLum, 0.0, 1.0);
    float luma = dot(col, float3(0.2126, 0.7152, 0.0722));
    col = max(mix(float3(luma), col, 1.0 + bk * 1.100), 0.0);
    float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    outA = pow(outA, 1.0 + bk * 1.600);
    return float4(col, outA);
}
