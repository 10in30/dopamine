#include <metal_stdlib>
#include "DopamineLook.metal"
#include "AuroraUniforms.metal"
using namespace metal;

#define CURTAINS 7

struct VSOut { float4 position [[position]]; };
vertex VSOut aurora_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float bandProfile(float ny) {
  
  
  float hem = smoothstep(0.0, 0.45, ny);          
  float top = 1.0 - smoothstep(0.7, 1.0, ny);      
  
  float bias = mix(0.6, 1.0, smoothstep(0.1, 0.85, ny));
  return clamp(hem * top * bias, 0.0, 1.0);
}

inline float curtain(int i, float x, float ny, constant AuroraUniforms &u, thread float &along) {
  float fi = float(i);
  float2 h = dop_hash21(fi * 3.17 + u.auroraSeed);
  
  float base = (fi + 0.5) / float(CURTAINS) + (h.x - 0.5) * 0.10;
  
  
  float n1 = dop_fbm(float2(fi * 1.7 + u.auroraSeed, ny * 1.3 + u.timeS * 0.13)) - 0.5;
  float n2 = dop_fbm(float2(fi * 0.9 + u.auroraSeed + 7.0, ny * 2.6 - u.timeS * 0.07)) - 0.5;
  float drift = (n1 * 0.7 + n2 * 0.3) * u.sway;
  
  float bow = (h.y - 0.5) * u.sway * 0.6 * (1.0 - ny);
  float cx = base + drift + bow + u.sweep;
  along = x - cx;
  
  float w = mix(0.045, 0.085, h.y) * (0.85 + 0.3 * u.coverage);
  float cov = exp(-pow(along / w, 2.0));
  return cov;
}

inline float auroraField(float2 uv, constant AuroraUniforms &u, thread float &cov, thread float &hue) {
  
  float top = u.bandY + u.bandHeight;
  float bot = u.bandY - u.bandHeight;
  float ny = (uv.y - bot) / max(top - bot, 1e-3);     
  float vprof = bandProfile(ny);
  cov = 0.0;
  hue = 0.0;
  if(vprof <= 0.0) return 0.0;

  
  
  float lit = mix(2.5, float(CURTAINS), clamp(u.coverage, 0.0, 1.0));

  float total = 0.0;
  float hueAccum = 0.0;
  for(int i = 0; i < CURTAINS; i++) {
    float gate = clamp(lit - float(i), 0.0, 1.0);       
    if(gate <= 0.0) break;
    float along;
    float c = curtain(i, uv.x, ny, u, along) * gate;
    if(c <= 0.001) continue;
    total += c;
    
    float hi = (float(i) + 0.5) / float(CURTAINS);
    hueAccum += c * hi;
  }
  cov = total * vprof;
  hue = total > 1e-3 ? hueAccum / total : 0.5;

  
  
  
  
  float flute = dop_fbm(float2(uv.x * 55.0 + u.auroraSeed, uv.y * 4.0 - u.timeS * 0.2));
  float striate = 1.0 + u.striation * (flute - 0.5) * 0.7;
  cov *= striate;

  
  
  
  float rayBand = pow(max(0.0, sin(uv.x * 60.0 + dop_fbm(float2(uv.x * 5.0, u.timeS * 0.3)) * 5.0)), 3.0);
  float rayGate = smoothstep(0.5, 0.95, dop_fbm(float2(uv.x * 9.0 + u.auroraSeed, u.timeS * 0.25)));
  cov += rayBand * rayGate * u.rays * smoothstep(0.05, 0.5, cov) * 0.5;

  return cov;
}

inline float auroraOcclusion(float2 frag, constant AuroraUniforms &u) {
  float2 uv = frag / u.resolution;
  float top = u.bandY + u.bandHeight;
  float bot = u.bandY - u.bandHeight;
  float ny = (uv.y - bot) / max(top - bot, 1e-3);
  float vprof = bandProfile(ny);
  if(vprof <= 0.0) return 0.0;
  float lit = mix(2.5, float(CURTAINS), clamp(u.coverage, 0.0, 1.0));
  float total = 0.0;
  for(int i = 0; i < CURTAINS; i++) {
    float gate = clamp(lit - float(i), 0.0, 1.0);
    if(gate <= 0.0) break;
    float along;
    total += curtain(i, uv.x, ny, u, along) * gate;
  }
  return clamp(total * vprof * u.amp, 0.0, 1.0);
}

inline float4 auroraShadowColor(float2 frag, constant AuroraUniforms &u) {
  float2 sp = frag - u.shadowOffset;
  float occ = auroraOcclusion(sp, u);
  float soft = u.shadowSoft;
  occ += auroraOcclusion(sp + float2( soft, 0.0), u);
  occ += auroraOcclusion(sp + float2(-soft, 0.0), u);
  occ += auroraOcclusion(sp + float2(0.0,  soft), u);
  occ += auroraOcclusion(sp + float2(0.0, -soft), u);
  occ /= 5.0;
  
  float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength * 0.35;
  float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.2);
  float3 mul = mix(float3(1.0), tint, dark);
  return float4(mul, 1.0);
}

fragment float4 aurora_fragment(
    VSOut in [[stage_in]],
    constant AuroraUniforms &u [[buffer(0)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float2 res = u.resolution;

  if(u.shadow > 0.5) {
    return auroraShadowColor(frag, u);
  }

  float2 uv = frag / res;
  float3 col = float3(0.0);
  float gain = u.amp * u.exposure;

  
  
  
  float washY = exp(-pow((uv.y - (u.bandY + u.bandHeight * 0.45)) / max(u.bandHeight, 1e-3), 2.0));
  col += mix(u.c0, u.c2, 0.5) * washY * 0.06 * gain;

  
  float cov, hue;
  auroraField(uv, u, cov, hue);

  
  
  float pulse = 0.85 + 0.15 * sin(u.timeS * 0.9 + hue * 4.0 + u.auroraSeed);
  float hueShift = hue + 0.15 * sin(u.timeS * 0.4 + u.auroraSeed * 6.28) + 0.1 * (dop_fbm(float2(uv.x * 3.0, u.timeS * 0.2)) - 0.5);

  float3 curtainCol = dop_paletteMix(clamp(hueShift, 0.0, 1.0), u.c0, u.c1, u.c2);
  col += curtainCol * clamp(cov, 0.0, 4.0) * pulse * gain;

  
  
  float crown = smoothstep(0.0, 0.5, cov) * smoothstep(u.bandY + u.bandHeight * 0.2, u.bandY + u.bandHeight, uv.y);
  col += u.c2 * crown * 0.4 * gain;

  
  col = dop_tonemapACES(col * 0.9);

  
  
  
  if(u.style > 0.001) {
    
    
    float lum = clamp(cov * pulse * u.exposure * u.amp, 0.0, 1.5);
    float steps = mix(6.0, 3.0, u.style);              
    float q = floor(lum * steps) / steps;
    float3 celCol = dop_paletteMix(clamp(hueShift, 0.0, 1.0), u.c0, u.c1, u.c2) * (q * 1.15 + 0.05);
    
    float band = lum * steps;
    float edge = abs(fract(band) - 0.5);
    float rim = (1.0 - smoothstep(0.0, 0.12, edge)) * smoothstep(0.06, 0.2, lum);
    celCol += clamp(u.c2 * 1.5 + 0.1, 0.0, 1.4) * rim * 0.6;
    float mask = smoothstep(0.04, 0.14, lum);          
    float3 styled = mix(col, celCol, mask);
    col = mix(col, styled, u.style);
  }

  
  
  col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style);

  col = max(col, 0.0);
    float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    return float4(col, outA);
}
