#include <metal_stdlib>
#include "DopamineLook.metal"
#include "DotsUniforms.metal"
using namespace metal;

#define MAX_DOTS 7

struct VSOut { float4 position [[position]]; };
vertex VSOut dots_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline int dotCount(constant DotsUniforms &u) {
  return int(clamp(u.dotCount, 1.0, float(MAX_DOTS)) + 0.5);
}

inline float liveRadius(constant DotsUniforms &u) {
  return u.dotRadius * (1.0 + sin(TAU * u.phase) * u.breathe * 0.45);
}

inline float dotCenterX(int i, int count, constant DotsUniforms &u) {
  float c = float(count);
  return(float(i) - (c - 1.0) * 0.5) * u.dotGap;
}

inline float pulseLit(int i, int count, constant DotsUniforms &u) {
  float head = fract(u.phase) * float(count);          
  float d = abs(float(i) + 0.5 - head);
  d = min(d, float(count) - d);                        
  float sharp = mix(0.9, 2.4, clamp(u.chase, 0.0, 1.5) / 1.5);
  return exp(-(d * d) * sharp);
}

inline float3 dotsLight(float2 frag, float minDim, constant DotsUniforms &u) {
  float2 rel = (frag - u.origin) / minDim;       
  int count = dotCount(u);
  float radius = max(liveRadius(u), 1e-3);

  
  float breatheB = 1.0 + sin(TAU * u.phase) * u.breathe * 0.5;
  float gain = u.amp * u.exposure * breatheB;

  float3 col = float3(0.0);
  for(int i = 0; i < MAX_DOTS; i++) {
    if(i >= count) break;
    float cx = dotCenterX(i, count, u);
    float2 dpos = rel - float2(cx, 0.0);
    float dist = length(dpos);

    
    
    float tcol = (count > 1) ? float(i) / float(count - 1) : 0.5;
    float3 dotCol = dop_paletteMix(clamp(tcol, 0.0, 1.0), u.c0, u.c1, u.c2);

    
    float lit = pulseLit(i, count, u);
    float bright = 0.35 + 0.65 * lit;          

    
    float cov = exp(-(dist * dist) / (2.0 * radius * radius));
    col += dotCol * cov * gain * bright;

    
    float gr = radius * 2.6;
    float glow = exp(-(dist * dist) / (2.0 * gr * gr));
    col += mix(dotCol, u.c2, lit * 0.4) * glow * u.glow * gain * 0.3 * bright;
  }
  return col;
}

inline float dotsOcclusion(float2 frag, float minDim, constant DotsUniforms &u) {
  float2 rel = (frag - u.origin) / minDim;
  int count = dotCount(u);
  float radius = max(liveRadius(u), 1e-3);
  float occ = 0.0;
  for(int i = 0; i < MAX_DOTS; i++) {
    if(i >= count) break;
    float2 dpos = rel - float2(dotCenterX(i, count, u), 0.0);
    float dist = length(dpos);
    occ = max(occ, exp(-(dist * dist) / (2.0 * radius * radius)));
  }
  return clamp(occ * u.amp, 0.0, 1.0);
}

inline float4 dotsShadowColor(float2 frag, float minDim, constant DotsUniforms &u) {
  float2 sp = frag - u.shadowOffset;
  float soft = u.shadowSoft;
  float occ = dotsOcclusion(sp, minDim, u);
  occ += dotsOcclusion(sp + float2( soft, 0.0), minDim, u);
  occ += dotsOcclusion(sp + float2(-soft, 0.0), minDim, u);
  occ += dotsOcclusion(sp + float2(0.0,  soft), minDim, u);
  occ += dotsOcclusion(sp + float2(0.0, -soft), minDim, u);
  occ /= 5.0;
  float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength * 0.5;
  float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.2);
  float3 mul = mix(float3(1.0), tint, dark);
  return float4(mul, 1.0);
}

fragment float4 dots_fragment(
    VSOut in [[stage_in]],
    constant DotsUniforms &u [[buffer(0)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float2 res = u.resolution;
  float minDim = min(res.x, res.y);

  if(u.shadow > 0.5) {
    return dotsShadowColor(frag, minDim, u);
  }

  float3 col = dotsLight(frag, minDim, u);

  
  col = dop_tonemapACES(col * 0.95);

  
  
  
  
  
  if(u.style > 0.001) {
    float2 rel = (frag - u.origin) / minDim;
    int count = dotCount(u);
    float radius = max(liveRadius(u), 1e-3);
    float breatheB = 1.0 + sin(TAU * u.phase) * u.breathe * 0.5;
    float gain = u.amp * u.exposure * breatheB;
    float3 cel = float3(0.0);
    for(int i = 0; i < MAX_DOTS; i++) {
      if(i >= count) break;
      float2 dpos = rel - float2(dotCenterX(i, count, u), 0.0);
      float dist = length(dpos);
      float disc = 1.0 - smoothstep(radius * 0.85, radius, dist);   
      float tcol = (count > 1) ? float(i) / float(count - 1) : 0.5;
      float3 dotCol = clamp(dop_paletteMix(clamp(tcol, 0.0, 1.0), u.c0, u.c1, u.c2) * 1.25, 0.0, 1.2);
      float lit = pulseLit(i, count, u);
      float litStep = step(0.6, lit);                                
      cel += dotCol * disc * (0.4 + 0.6 * litStep)
           + mix(u.c2, float3(1.0), 0.5) * disc * litStep * 0.4;
    }
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
