#include <metal_stdlib>
#include "DopamineLook.metal"
#include "RippleUniforms.metal"
using namespace metal;

#define MAX_RINGS 7

struct VSOut { float4 position [[position]]; };
vertex VSOut ripple_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float ringLaunch(int i) {
  return float(i) * 0.12;
}

inline void waveField(float rn, constant RippleUniforms &u, thread float &h, thread float &slope, thread float &front) {
  h = 0.0; slope = 0.0; front = 0.0;
  float k = TAU / max(u.wavelength, 0.001);        
  float w = k * u.speed;                            
  int rings = int(clamp(u.rings, 0.0, float(MAX_RINGS)) + 0.5);
  for(int i = 0; i < MAX_RINGS; i++) {
    if(i >= rings) break;
    float t0 = ringLaunch(i);
    float age = u.life - t0;                         
    if(age <= 0.0) continue;
    
    
    
    float front_r = u.speed * age;                   
    float width = u.wavelength * (1.0 + 2.6 * age);  
    float d = rn - front_r;                         
    float pkt = exp(-(d * d) / (2.0 * width * width));
    if(pkt < 0.002) continue;
    
    
    float decay = pow(max(1.0 - age, 0.0), 1.3);
    
    float spread = 1.0 / sqrt(max(rn, u.wavelength * 0.5));
    
    
    float phase = k * rn - w * u.life;
    float qstep = TAU * 0.5;
    float qphase = floor(phase / qstep) * qstep;
    phase = mix(phase, qphase, u.style * 0.85);
    float amp = u.amplitude * pkt * decay * spread;
    h += amp * cos(phase);
    
    slope += -amp * k * sin(phase);
    front = max(front, pkt * decay);
  }
}

inline float rippleOcclusion(float2 frag, constant RippleUniforms &u) {
  float minDim = min(u.resolution.x, u.resolution.y);
  float rn = length(frag - u.origin) / minDim;
  float h, slope, front;
  waveField(rn, u, h, slope, front);
  float trough = max(-h, 0.0);                      
  return clamp(trough * 2.2 * front * u.amp, 0.0, 1.0);
}

inline float4 rippleShadowColor(float2 frag, constant RippleUniforms &u) {
  float2 sp = frag - u.shadowOffset;
  float soft = u.shadowSoft;
  float occ = rippleOcclusion(sp, u);
  occ += rippleOcclusion(sp + float2( soft, 0.0), u);
  occ += rippleOcclusion(sp + float2(-soft, 0.0), u);
  occ += rippleOcclusion(sp + float2(0.0,  soft), u);
  occ += rippleOcclusion(sp + float2(0.0, -soft), u);
  occ /= 5.0;
  
  float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength * 0.5;
  float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.2);
  float3 mul = mix(float3(1.0), tint, dark);
  return float4(mul, 1.0);
}

fragment float4 ripple_fragment(
    VSOut in [[stage_in]],
    constant RippleUniforms &u [[buffer(0)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float2 res = u.resolution;
  float minDim = min(res.x, res.y);

  if(u.shadow > 0.5) {
    return rippleShadowColor(frag, u);
  }

  float3 col = float3(0.0);
  float2 rel = frag - u.origin;
  float r = length(rel);
  float rn = r / minDim;                            
  float2 rdir = rel / max(r, 1e-3);                   

  
  float h, slope, front;
  waveField(rn, u, h, slope, front);

  float gain = u.amp * u.exposure;

  
  
  
  
  float tcol = clamp(rn / (u.wavelength * float(MAX_RINGS) * 0.9), 0.0, 1.0);
  tcol = fract(tcol + u.timeS * 0.04 + dop_fbm(rel / minDim * 5.0 + u.rippleSeed) * 0.06);
  float3 ringCol = dop_paletteMix(tcol, u.c0, u.c1, u.c2);

  
  
  float crest = smoothstep(0.0, u.amplitude * 0.5, h) * front;
  col += ringCol * crest * gain * 0.9;

  
  
  
  
  float foc = abs(slope);
  float caustic = pow(clamp(foc / (u.amplitude * 1.2 + 1e-3), 0.0, 1.0), 1.8);
  
  float glit = 0.6 + 0.6 * dop_fbm(rel / minDim * 22.0 - u.timeS * 0.5 + u.rippleSeed);
  caustic *= glit * front;
  
  col += mix(u.c2, float3(1.0), 0.35) * caustic * u.caustic * gain * 1.3;

  
  float glint = smoothstep(0.85, 1.0, front) * smoothstep(u.amplitude * 0.55, u.amplitude * 0.9, h);
  col += float3(1.0) * glint * gain * 0.5 * (0.5 + 0.5 * u.caustic);

  
  col = dop_tonemapACES(col * 0.95);

  
  
  
  
  
  if(u.style > 0.001) {
    
    float band = smoothstep(0.18, 0.30, crest);
    float core = smoothstep(0.45, 0.60, crest);
    float3 celRing = clamp(ringCol * 1.3, 0.0, 1.2) * band
                 + clamp(u.c0 * 1.6 + 0.1, 0.0, 1.3) * core;
    
    
    
    float caus = clamp(caustic * u.caustic, 0.0, 1.0);
    float causQ = step(0.5, caus) * 0.6 + step(0.8, caus) * 0.4;
    float3 celCaustic = mix(u.c2, float3(1.0), 0.5) * causQ;
    float3 cel = (celRing + celCaustic) * gain;
    col = mix(col, cel, u.style);
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
