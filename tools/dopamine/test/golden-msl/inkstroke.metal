#include <metal_stdlib>
#include "DopamineLook.metal"
#include "InkstrokeUniforms.metal"
using namespace metal;

#define MAX_DROPS 64

struct VSOut { float4 position [[position]]; };
vertex VSOut inkstroke_vertex(uint vid [[vertex_id]]) {
    VSOut o;
    float2 pos = float2(float((vid << 1) & 2), float(vid & 2));
    o.position = float4(pos * 2.0 - 1.0, 0.0, 1.0);
    return o;
}

inline float4 dopMarkOut(float3 glow, float3 markInk, float markA, constant InkstrokeUniforms &u) {
  glow = max(glow, 0.0);
  float bk = clamp(u.backdropLum, 0.0, 1.0);
  
  
  
  
  if(bk <= 0.0) return float4(glow, clamp(max(max(glow.r, glow.g), glow.b), 0.0, 1.0));
  float luma = dot(glow, float3(0.2126, 0.7152, 0.0722));
  float3 gcol = max(mix(float3(luma), glow, 1.0 + bk * 1.100), 0.0);
  float ga = clamp(max(max(gcol.r, gcol.g), gcol.b), 0.0, 1.0);
  ga = pow(ga, 1.0 + bk * 1.600);
  float mA = clamp(markA, 0.0, 1.0) * bk;
  float3 outRgb = mix(gcol, max(markInk, 0.0), mA);
  float outA = mix(ga, 1.0, mA);
  return float4(outRgb, outA);
}

inline float2 ballisticPos(float2 origin, float2 dir, float speed, float gravity, float t) {
  return origin + dir * speed * t - float2(0.0, 1.0) * gravity * t * t;
}

inline float inkDraw(constant InkstrokeUniforms &u) {
  float drawDur = 360.0 * clamp(u.resolution.x / max(u.target.x, 1.0), 1.0, 1.4);
  float t = clamp(u.timeS * 1000.0 / drawDur, 0.0, 1.0);
  return 1.0 - pow(1.0 - t, 3.0);
}

inline void strokeGeom(float jitterScale, constant InkstrokeUniforms &u, thread float2 &A, thread float2 &B, thread float2 &C) {
  float2 res = u.resolution;
  float minDim = min(res.x, res.y);
  
  
  float len = u.scale * u.target.x;
  float2 mid = u.origin;
  float bt = floor(u.timeS * 12.0);
  float2 jit = (dop_hash21(bt + u.inkSeed) - 0.5) * minDim * 0.02 * u.style * jitterScale;
  A = mid + float2(-0.42, 0.18) * len + jit;   
  B = mid + float2(-0.12, -0.30) * len + jit;  
  C = mid + float2(0.55, 0.42) * len + jit;    
}

inline float2 checkPos(float2 A, float2 B, float2 C, float uu, thread float &segT, thread float &leg) {
  float l1 = length(B - A);
  float l2 = length(C - B);
  float total = max(l1 + l2, 1e-3);
  float d = uu * total;
  if(d <= l1) {
    segT = d / max(l1, 1e-3);
    leg = 0.0;
    return mix(A, B, segT);
  }
  segT = (d - l1) / max(l2, 1e-3);
  leg = 1.0;
  return mix(B, C, segT);
}

inline float inkPressure(float uu, constant InkstrokeUniforms &u) {
  return exp(-pow((uu - 0.46) * 2.2, 2.0)) * u.pressure;
}

inline float inkTaper(float uu) {
  return smoothstep(0.0, 0.05, uu) * (1.0 - smoothstep(0.88, 1.0, uu));
}

inline float inkOcclusion(float2 p, constant InkstrokeUniforms &u) {
  float2 res = u.resolution;
  float minDim = min(res.x, res.y);
  float2 A, B, C;
  strokeGeom(0.0, u, A, B, C);   
  
  
  float base = minDim * 0.045 * min(u.target.x / res.x, 1.0);
  float occ = 0.0;
  float draw = inkDraw(u);   

  
  float segT, leg;
  const int STEPS = 16;
  for(int i = 0; i < STEPS; i++) {
    float u0 = float(i) / float(STEPS);
    float u1 = float(i + 1) / float(STEPS);
    if(u0 > draw) break;
    float uc = clamp((u0 + u1) * 0.5, 0.0, draw);
    float2 a = checkPos(A, B, C, u0, segT, leg);
    float2 b = checkPos(A, B, C, min(u1, draw), segT, leg);
    float belly = inkPressure(uc, u);
    float taper = inkTaper(uc);
    float rad = base * (0.55 + 1.25 * belly) * (0.4 + 0.6 * taper);
    float dist = dop_sdSeg(p, a, b);
    occ = max(occ, 1.0 - smoothstep(rad * 0.7, rad, dist));
  }

  
  float2 launch = checkPos(A, B, C, 0.86, segT, leg);
  float2 launchDir = normalize(checkPos(A, B, C, 0.92, segT, leg)
                           - checkPos(A, B, C, 0.78, segT, leg));
  float len = u.scale * u.target.x;
  for(int i = 0; i < MAX_DROPS; i++) {
    if(float(i) >= u.droplets) break;
    float2 hh = dop_hash21(float(i) * 5.3 + u.inkSeed + 11.0);
    float dl = 0.6 + hh.x * 0.25;
    float dlife = clamp((draw - dl) / max(1.0 - dl, 0.001), 0.0, 1.0);
    if(dlife <= 0.0) continue;
    float spd = (0.4 + hh.y) * len * 0.9;
    float spread = (hh.x - 0.5) * 1.4;
    float2 dir = normalize(launchDir + float2(-launchDir.y, launchDir.x) * spread);
    float2 dp = launch + dir * spd * dlife - float2(0.0, 1.0) * (len * 0.9) * dlife * dlife;
    float dsz = len * 0.006 * (0.4 + hh.y * 0.9) * (1.0 - 0.5 * dlife);
    float dd = length(p - dp);
    occ = max(occ, (1.0 - smoothstep(dsz * 0.5, dsz * 1.2, dd)) * (1.0 - dlife) * 0.7);
  }

  return clamp(occ * u.amp, 0.0, 1.0);
}

inline float4 inkShadowColor(float2 frag, constant InkstrokeUniforms &u) {
  float2 sp = frag - u.shadowOffset;
  float occ = inkOcclusion(sp, u);
  float soft = u.shadowSoft;
  occ += inkOcclusion(sp + float2( soft, 0.0), u);
  occ += inkOcclusion(sp + float2(-soft, 0.0), u);
  occ += inkOcclusion(sp + float2(0.0,  soft), u);
  occ += inkOcclusion(sp + float2(0.0, -soft), u);
  float s2 = soft * 0.7071;
  occ += inkOcclusion(sp + float2( s2,  s2), u);
  occ += inkOcclusion(sp + float2(-s2,  s2), u);
  occ += inkOcclusion(sp + float2( s2, -s2), u);
  occ += inkOcclusion(sp + float2(-s2, -s2), u);
  occ /= 9.0;
  float dark = clamp(occ, 0.0, 1.0) * u.shadowStrength;
  float3 tint = mix(float3(1.0), 0.6 + 0.4 * normalize(u.c0 + 1e-3), 0.25);
  float3 mul = mix(float3(1.0), tint, dark);
  return float4(mul, 1.0);
}

fragment float4 inkstroke_fragment(
    VSOut in [[stage_in]],
    constant InkstrokeUniforms &u [[buffer(0)]]
) {
  float2 frag = float2(in.position.x, u.resolution.y - in.position.y);
  float2 res = u.resolution;
  float minDim = min(res.x, res.y);
  float3 col = float3(0.0);

  if(u.shadow > 0.5) {
    return inkShadowColor(frag, u);
  }

  
  
  
  
  float len = u.scale * u.target.x;
  float2 A, B, C;
  strokeGeom(1.0, u, A, B, C);   
  float draw = inkDraw(u);   

  
  
  
  float base = minDim * 0.045 * min(u.target.x / res.x, 1.0);  
  float ink = 0.0;       
  float edge = 0.0;      
  float bodyT = 0.0;     
  float nearAcross = 0.0;
  float2 tipPos = A; float tipR = base;              
  float bestDist = 1e9;
  float segT, leg;

  const int STEPS = 28;
  for(int i = 0; i < STEPS; i++) {
    float u0 = float(i) / float(STEPS);
    float u1 = float(i + 1) / float(STEPS);
    
    if(u0 > draw) break;
    float uc = clamp((u0 + u1) * 0.5, 0.0, draw);
    float2 a = checkPos(A, B, C, u0, segT, leg);
    float2 b = checkPos(A, B, C, min(u1, draw), segT, leg);

    
    
    float2 ba = b - a;
    float2 dirL = normalize(length(ba) > 1e-3 ? ba : (leg < 0.5 ? B - A : C - B));
    float2 across2 = float2(-dirL.y, dirL.x);

    
    
    float belly = inkPressure(uc, u);
    float taper = inkTaper(uc);
    float rad = base * (0.55 + 1.25 * belly) * (0.4 + 0.6 * taper);

    
    
    float wob = (dop_fbm(float2(uc * 8.0 + u.inkSeed, u.timeS * 0.2)) - 0.5) * u.wetness;
    rad *= (1.0 + 0.30 * wob);

    
    float2 pa = frag - a;
    float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-3), 0.0, 1.0);
    float2 near = a + ba * h;
    float dist = length(frag - near);

    if(dist < bestDist) {
      bestDist = dist;
      bodyT = uc;
      tipR = rad;
      
      nearAcross = clamp(dot(frag - near, across2) / max(rad, 1.0), -1.0, 1.0);
    }
    
    float cov = 1.0 - smoothstep(rad * 0.85, rad, dist);
    ink = max(ink, cov);
    edge = max(edge, (1.0 - smoothstep(rad, rad * 1.7, dist)) * (1.0 - cov));
    tipPos = b;
  }

  
  
  
  
  float bristleField = 0.5 + 0.5 * sin(nearAcross * 14.0 + u.inkSeed * 6.28
                       + dop_fbm(float2(bodyT * 6.0, nearAcross * 3.0) + u.inkSeed) * 4.0);
  float spine = smoothstep(0.9, 0.2, abs(nearAcross));          
  float rake = 1.0 - u.bristle * (1.0 - spine) * (1.0 - bristleField) * 0.7;
  ink *= rake;

  
  
  float bleed = edge * u.wetness * (0.5 + 0.7 * dop_fbm(frag / minDim * 18.0 + u.inkSeed));

  
  
  
  
  float wash = exp(-bestDist / (minDim * 0.10)) * 0.10 * smoothstep(0.02, 0.12, draw);

  float gain = u.amp * u.exposure;
  
  
  
  
  float3 inkCol = mix(u.c0, u.c1, 0.2 + 0.3 * bodyT);
  col += inkCol * ink * gain;
  col += mix(u.c1, u.c2, 0.6) * bleed * gain * 0.85;
  col += mix(u.c0, u.c1, 0.4) * wash * gain;

  
  
  
  
  
  
  float wetSheen = bleed * u.wetness * (1.0 - u.style);
  if(wetSheen > 0.001) {
    float irPhase = bodyT * 0.7 + nearAcross * 0.5 + u.timeS * 0.25
                  + dop_fbm(frag / minDim * 9.0 + u.inkSeed) * 1.2;
    float3 irid = dop_iridescent(fract(irPhase));
    col = mix(col, col * (0.55 + 1.2 * irid), wetSheen * 0.35);
    col += irid * wetSheen * 0.10 * gain;
    
    float disp = (0.04 + 0.08 * edge) * u.wetness * (1.0 - u.style) * (0.7 + 0.5 * u.amp);
    col.r += edge * disp * 0.6 * gain;
    col.b -= edge * disp * 0.5 * gain;
  }

  
  
  float drawing = smoothstep(0.0, 0.05, draw) * (1.0 - smoothstep(0.9, 1.04, draw));
  float td = length(frag - tipPos);
  float tipGlow = (tipR * 1.7) / (td + tipR * 0.5); tipGlow *= tipGlow;
  col += float3(1.0) * tipGlow * drawing * gain * 1.8;

  
  
  
  float2 launch = checkPos(A, B, C, 0.86, segT, leg);
  float2 launchDir = normalize(checkPos(A, B, C, 0.92, segT, leg)
                           - checkPos(A, B, C, 0.78, segT, leg));
  for(int i = 0; i < MAX_DROPS; i++) {
    if(float(i) >= u.droplets) break;
    float2 hh = dop_hash21(float(i) * 5.3 + u.inkSeed + 11.0);
    float dl = 0.6 + hh.x * 0.25;                 
    float dlife = clamp((draw - dl) / max(1.0 - dl, 0.001), 0.0, 1.0);
    if(dlife <= 0.0) continue;
    float spd = (0.4 + hh.y) * len * 0.9;
    float spread = (hh.x - 0.5) * 1.4;
    float2 dir = normalize(launchDir + float2(-launchDir.y, launchDir.x) * spread);
    
    float2 dp = ballisticPos(launch, dir, spd, len * 0.9, dlife);
    float dsz = len * 0.006 * (0.4 + hh.y * 0.9) * (1.0 - 0.5 * dlife);
    float dd = length(frag - dp);
    float drop = dop_particleSprite(dd, dsz);   
    
    if(u.style > 0.001) {
      float crisp = 1.0 - smoothstep(dsz * 0.9, dsz, dd);
      drop = mix(drop, crisp, u.style * 0.9);
    }
    float dfade = (1.0 - dlife) * smoothstep(0.0, 0.1, dlife);
    col += dop_paletteMix(0.6 + hh.y * 0.4, u.c0, u.c1, u.c2) * drop * dfade * gain * 1.1;
  }

  
  
  
  float ul = smoothstep(0.78, 0.92, draw) * (1.0 - smoothstep(0.45, 1.0, u.life));
  
  float ulY = B.y - len * 0.10;
  float uy = exp(-pow((frag.y - ulY) / (minDim * 0.012), 2.0));
  float ux = smoothstep(A.x, A.x + len * 0.1, frag.x) * (1.0 - smoothstep(C.x - len * 0.05, C.x, frag.x));
  col += dop_paletteMix(0.4, u.c0, u.c1, u.c2) * uy * ux * ul * gain * 0.8;

  
  
  
  
  
  col = dop_tonemapACES(col * 0.82);

  
  
  
  
  
  
  if(u.style > 0.001) {
    
    float fillMask = smoothstep(0.55, 0.62, ink);
    float coreMask = smoothstep(0.8, 0.86, ink);
    float3 neonCore = clamp(u.c0 * 1.5 + 0.15, 0.0, 1.2);
    float3 neonMid = clamp(mix(u.c0, u.c1, 0.6) * 1.3, 0.0, 1.1);
    float3 cel = neonMid * fillMask + (neonCore - neonMid) * coreMask;
    
    float rim = smoothstep(0.4, 0.56, ink) * (1.0 - fillMask);
    cel += clamp(u.c2 * 1.6 + 0.2, 0.0, 1.3) * rim;
    
    
    
    float strokeMask = clamp(fillMask + rim, 0.0, 1.0);
    float3 styled = mix(col, cel * gain, strokeMask);
    col = mix(col, styled, u.style);
  }

  
  
  col = dop_ditherAdd(col, frag, u.timeS, 1.0 - u.style);

  
  
  
  float markA = clamp(ink, 0.0, 1.0);
  float3 markInk = clamp(inkCol * 0.42, 0.0, 0.6);
  return dopMarkOut(max(col, 0.0), markInk, markA, u);
}
