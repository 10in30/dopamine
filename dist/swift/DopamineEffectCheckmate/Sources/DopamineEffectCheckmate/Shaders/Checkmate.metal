#include <metal_stdlib>
#include "DopamineLook.metal"
#include "CheckmateUniforms.metal"
using namespace metal;

#define MAX_SPARKLES 16

struct VSOut { float4 position [[position]]; };
vertex VSOut checkmate_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float3 prideSmooth(float t) {
  t = fract(t);
  return 0.5 + 0.5 * cos(TAU * (t + float3(0.0, 0.33, 0.67)));
}

inline float3 prideFlag(float t) {
  t = fract(t);
  if(t < 0.16667) return float3(0.94, 0.10, 0.12);   
  if(t < 0.33333) return float3(1.00, 0.55, 0.06);   
  if(t < 0.50000) return float3(1.00, 0.93, 0.10);   
  if(t < 0.66667) return float3(0.18, 0.70, 0.22);   
  if(t < 0.83333) return float3(0.10, 0.36, 0.90);   
  return float3(0.46, 0.12, 0.62);                     
}

inline float3 prideColor(float t, float style) {
  return mix(prideSmooth(t), prideFlag(t), style);
}

inline float sdBox(float2 p, float2 b) {
  float2 d = abs(p) - b;
  return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
}

inline float sdTrapezoid(float2 p, float r1, float r2, float he) {
  float2 k1 = float2(r2, he);
  float2 k2 = float2(r2 - r1, 2.0 * he);
  p.x = abs(p.x);
  float2 ca = float2(p.x - min(p.x, (p.y < 0.0) ? r1 : r2), abs(p.y) - he);
  float2 cb = p - k1 + k2 * clamp(dot(k1 - p, k2) / dot(k2, k2), 0.0, 1.0);
  float s = (cb.x < 0.0 && ca.y < 0.0) ? -1.0 : 1.0;
  return s * sqrt(min(dot(ca, ca), dot(cb, cb)));
}

inline float queenDist(float2 q) {
  float d = sdTrapezoid(q - float2(0.0, -0.74), 0.60, 0.40, 0.12); 
  d = min(d, sdTrapezoid(q - float2(0.0, -0.10), 0.46, 0.15, 0.50)); 
  d = min(d, sdBox(q - float2(0.0, 0.40), float2(0.32, 0.05)) - 0.02); 
  
  d = min(d, length(q - float2(-0.46, 0.55)) - 0.115);
  d = min(d, length(q - float2(-0.23, 0.62)) - 0.125);
  d = min(d, length(q - float2( 0.00, 0.71)) - 0.145);
  d = min(d, length(q - float2( 0.23, 0.62)) - 0.125);
  d = min(d, length(q - float2( 0.46, 0.55)) - 0.115);
  d = min(d, dop_sdSeg(q, float2(-0.46, 0.55), float2(-0.28, 0.42)) - 0.045);
  d = min(d, dop_sdSeg(q, float2(-0.23, 0.62), float2(-0.14, 0.42)) - 0.045);
  d = min(d, dop_sdSeg(q, float2( 0.00, 0.71), float2( 0.00, 0.42)) - 0.055);
  d = min(d, dop_sdSeg(q, float2( 0.23, 0.62), float2( 0.14, 0.42)) - 0.045);
  d = min(d, dop_sdSeg(q, float2( 0.46, 0.55), float2( 0.28, 0.42)) - 0.045);
  return d;
}

inline float starGlint(float2 p, float2 c, float size) {
  float2 d = (p - c) / max(size, 1e-3);
  float r = length(d);
  float core = exp(-r * r * 5.0);
  float sx = exp(-abs(d.x) * 6.0) * exp(-abs(d.y) * 1.4);
  float sy = exp(-abs(d.y) * 6.0) * exp(-abs(d.x) * 1.4);
  return core + (sx + sy) * 0.7;
}

inline float queenFill(float2 frag, constant CheckmateUniforms &u) {
  float R = min(u.resolution.x, u.resolution.y) * u.sizeFrac;
  float scale = mix(0.34, 1.0, clamp(u.pop, 0.0, 1.4));      
  float2 q = (frag - u.origin) / max(R, 1e-3) / max(scale, 1e-3);
  float d = queenDist(q);
  float aa = 1.6 / max(R, 1e-3);                            
  return smoothstep(aa, -aa, d);
}

inline float occlusion(float2 frag, constant CheckmateUniforms &u) {
  return clamp(queenFill(frag, u) * u.amp, 0.0, 1.0);
}

inline float4 shadowColor(float2 frag, constant CheckmateUniforms &u) {
  float2 sp = frag - u.shadowOffset;
  float s = u.shadowSoft;
  float occ = occlusion(sp, u);
  occ += occlusion(sp + float2(s, 0.0), u);
  occ += occlusion(sp + float2(-s, 0.0), u);
  occ += occlusion(sp + float2(0.0, s), u);
  occ += occlusion(sp + float2(0.0, -s), u);
  occ /= 5.0;
  float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength;
  
  float3 tint = mix(float3(1.0), float3(0.74, 0.70, 0.78), 1.0);
  float3 mul = mix(float3(1.0), tint, dark);
  return float4(mul, 1.0);
}

fragment float4 checkmate_fragment(
    VSOut in [[stage_in]],
    constant CheckmateUniforms &u [[buffer(0)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float minDim = min(u.resolution.x, u.resolution.y);

  if(u.shadow > 0.5) { return shadowColor(frag, u); }

  float2 rel = frag - u.origin;
  float r = length(rel);
  float rn = r / minDim;                          
  float theta = atan2(rel.y, rel.x);               
  float gain = u.amp * u.exposure;
  float style = u.style;

  float3 col = float3(0.0);

  
  float rayN = max(u.rays, 1.0);
  float rays = 0.5 + 0.5 * cos(theta * rayN - u.timeS * u.spin * 2.4);
  rays = pow(clamp(rays, 0.0, 1.0), mix(2.2, 5.0, style));   
  float rayMask = smoothstep(0.02, 0.16, rn) * (1.0 - smoothstep(0.30, 0.62, rn));
  float3 rayCol = prideColor(theta / TAU + 0.5 + u.checkmateSeed, style);
  col += rayCol * rays * rayMask * gain * 0.5;

  
  
  float front = u.swoosh * (0.10 + 0.78 * u.life);
  float width = 0.035 + 0.16 * u.life;
  float dr = (rn - front) / max(width, 1e-3);
  float ring = exp(-dr * dr);
  float3 ringCol = prideColor(theta / TAU + u.spin * u.timeS * 0.15 + u.checkmateSeed, style);
  col += ringCol * ring * gain * 1.35;
  
  col += float3(1.0) * smoothstep(0.0, 1.0, ring) * smoothstep(0.0, -1.2, dr) * gain * 0.35;

  
  float R = minDim * u.sizeFrac;
  float scale = mix(0.34, 1.0, clamp(u.pop, 0.0, 1.4));
  float2 q = rel / max(R, 1e-3) / max(scale, 1e-3);
  float dq = queenDist(q);
  float aa = 1.6 / max(R, 1e-3);
  float fill = smoothstep(aa, -aa, dq);
  float edge = smoothstep(aa * 2.5, 0.0, abs(dq));          
  float halo = exp(-max(dq, 0.0) / 0.06);                   
  
  float qt = q.y * 0.42 + 0.5 + u.checkmateSeed + u.timeS * 0.05;
  float3 body = prideColor(qt, style);
  float3 queenCol = body * fill * 1.45                         
                + mix(body, float3(1.0), 0.6) * edge * 0.8     
                + body * halo * 0.55;                        
  
  queenCol += float3(1.0) * fill * (1.0 - smoothstep(0.0, 0.22, u.life)) * 0.35;
  col += queenCol * (u.exposure * (0.35 + 0.65 * u.amp));

  
  float sparkleReach = (0.16 + 0.62 * u.life) * minDim;
  float3 bling = float3(0.0);
  for(int i = 0; i < MAX_SPARKLES; i++) {
    float fi = float(i);
    float2 h = dop_hash21(fi * 3.17 + u.checkmateSeed * 31.0);
    float ang = h.x * TAU;
    float rad = (0.45 + 0.55 * h.y) * sparkleReach;          
    float2 pos = u.origin + float2(cos(ang), sin(ang)) * rad;
    
    float ph = h.x * 17.0 + h.y * 9.0;
    float tw = pow(0.5 + 0.5 * sin(u.timeS * 7.0 + ph), mix(3.0, 7.0, style));
    float sz = minDim * (0.012 + 0.018 * h.y) * (0.8 + 0.5 * u.bling);
    float g = starGlint(frag, pos, sz) * tw;
    
    float3 tint = mix(float3(1.0), dop_paletteMix(fract(fi * 0.137 + u.checkmateSeed), u.c0, u.c1, u.c2), 0.55);
    bling += tint * g;
  }
  col += bling * u.bling * gain * 0.9;

  
  float flashT = 1.0 - smoothstep(0.0, 0.22, u.life);
  float flash = exp(-rn * rn * 26.0) * flashT;
  col += mix(float3(1.0), prideColor(u.timeS * 0.3 + u.checkmateSeed, style), 0.4) * flash * u.exposure * 1.4;

  
  col = dop_tonemapACES(col * 0.95);
  
  
  col = dop_ditherAdd(col, frag, u.timeS, 1.0 - style);

  col = max(col, 0.0);
    float bk = clamp(u.backdropLum, 0.0, 1.0);
    float luma = dot(col, float3(0.2126, 0.7152, 0.0722));
    col = max(mix(float3(luma), col, 1.0 + bk * 0.600), 0.0);
    float outA = clamp(max(max(col.r, col.g), col.b), 0.0, 1.0);
    outA = clamp(outA * (1.0 + bk * 0.800), 0.0, 1.0);
    return float4(col, outA);
}
