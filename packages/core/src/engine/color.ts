/**
 * Algorithmic color in OKLCH.
 *
 * OKLCH is perceptually uniform, so walking hue by the golden angle (137.5°)
 * yields palettes that are always harmonious yet never repeat — the novelty
 * that keeps a reward from habituating. Lightness/chroma come from the mood
 * (saturated + bright == higher arousal *and* positive valence).
 *
 * We hand the shader *linear* sRGB, because light should be summed in linear
 * space; sRGB gamma is only for talking to CSS.
 */

import type { Rng } from "./seed.js";

/** Linear sRGB, nominally 0..1 (may exceed before clamping). */
export interface RGB {
  r: number;
  g: number;
  b: number;
}

export interface OKLCH {
  /** Perceptual lightness, 0..1. */
  L: number;
  /** Chroma (colorfulness), ~0..0.4. */
  C: number;
  /** Hue in degrees, 0..360. */
  h: number;
}

export const GOLDEN_ANGLE_DEG = 137.50776405003785;

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/** Positive modulo into [0, 360). */
export const wrapHue = (h: number): number => ((h % 360) + 360) % 360;

/**
 * OKLCH → linear sRGB (Björn Ottosson's OKLab matrices). Result is gamut-clamped
 * to [0, 1] per channel.
 */
export function oklchToLinearSrgb({ L, C, h }: OKLCH): RGB {
  const hr = (h * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);

  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ * l_ * l_;
  const m = m_ * m_ * m_;
  const s = s_ * s_ * s_;

  return {
    r: clamp01(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: clamp01(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: clamp01(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  };
}

export interface PaletteParams {
  /** Base lightness for the stops. */
  lightness: number;
  /** Base chroma for the stops. */
  chroma: number;
  /** Center of the hue range this mood prefers, in degrees. */
  hueCenter: number;
  /** Width of the random hue range around the center, in degrees. */
  hueRange: number;
  /** 0..1 — how far the golden-angle stops fan out from the base hue. */
  hueSpread: number;
}

/**
 * Build a 3-stop linear-RGB palette. The base hue is drawn from `rng` (so an
 * un-pinned seed gives a unique palette each fire), biased toward the mood's
 * preferred range. Successive stops step by the golden angle, scaled by whimsy.
 * Lightness and chroma breathe slightly across the stops for depth.
 */
export function buildPalette(rng: Rng, p: PaletteParams): RGB[] {
  const baseHue = wrapHue(p.hueCenter + (rng() - 0.5) * p.hueRange);
  const step = GOLDEN_ANGLE_DEG * (0.35 + 0.65 * p.hueSpread);
  const lightSteps = [0.0, 0.06, -0.05];
  const chromaSteps = [0.0, 0.02, -0.01];

  return [0, 1, 2].map((i) =>
    oklchToLinearSrgb({
      L: clamp01(p.lightness + lightSteps[i]!),
      C: Math.max(0, p.chroma + chromaSteps[i]!),
      h: wrapHue(baseHue + step * i),
    }),
  );
}

/** A parsed backdrop colour the overlay composites against. */
export interface Backdrop {
  /** sRGB 0..1 (the value as authored — NOT linearised). */
  rgb: RGB;
  /** Rec.709 relative luminance in sRGB space, 0 (black) .. 1 (white). */
  luminance: number;
}

/** Parse `#rgb[a]` / `#rrggbb[aa]` hex (3/4/6/8 digits) into sRGB 0..1, or null. */
function parseHex(s: string): RGB | null {
  const m = /^#([0-9a-f]{3,8})$/i.exec(s);
  if (!m) return null;
  const h = m[1]!;
  const dup = (c: string): number => parseInt(c + c, 16) / 255;
  if (h.length === 3 || h.length === 4) return { r: dup(h[0]!), g: dup(h[1]!), b: dup(h[2]!) };
  if (h.length === 6 || h.length === 8) {
    const at = (i: number): number => parseInt(h.slice(i, i + 2), 16) / 255;
    return { r: at(0), g: at(2), b: at(4) };
  }
  return null;
}

/** Parse `rgb()/rgba()` (comma- or space-separated, 0–255 or %), or null. */
function parseRgbFunc(s: string): RGB | null {
  const m = /^rgba?\(([^)]+)\)$/i.exec(s.trim());
  if (!m) return null;
  const parts = m[1]!.split(/[\s,/]+/).filter(Boolean).slice(0, 3);
  if (parts.length < 3) return null;
  const chan = (p: string): number =>
    p.endsWith("%") ? clamp01(parseFloat(p) / 100) : clamp01(parseFloat(p) / 255);
  return { r: chan(parts[0]!), g: chan(parts[1]!), b: chan(parts[2]!) };
}

/**
 * Parse any CSS colour string into a {@link Backdrop} (sRGB 0..1 + luminance),
 * or `null` if it can't be understood. Handles hex and `rgb()/rgba()` directly;
 * for everything else (named colours, `hsl()`, `color()`) it falls back to the
 * browser's own normaliser via a throwaway 2D canvas when a DOM is present. The
 * runtime uses the luminance to decide how strongly to cast shadow as a surface
 * lightens; the colour itself isn't sent to the shader (the light layer
 * composites source-over against the live page).
 */
export function parseBackdrop(css: string): Backdrop | null {
  let rgb = parseHex(css) ?? parseRgbFunc(css);
  if (!rgb && typeof document !== "undefined") {
    try {
      const ctx = document.createElement("canvas").getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#000";
        ctx.fillStyle = css; // the browser normalises to #rrggbb or rgb(a)(...)
        rgb = parseHex(ctx.fillStyle) ?? parseRgbFunc(ctx.fillStyle);
      }
    } catch {
      /* no canvas — fall through to null */
    }
  }
  if (!rgb) return null;
  return { rgb, luminance: 0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b };
}
