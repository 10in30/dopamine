/**
 * Solarbloom checkmark GLYPH rasterizer + bundled-font loader.
 *
 * Solarbloom's checkmark used to be an analytic two-segment SDF "drawn in light".
 * It is now a REAL typeface glyph (✓ U+2713 / ✔ U+2714) whose FACE + codepoint
 * are chosen by whimsy (engine/mood.ts `pickCheckGlyph`): low whimsy = a refined,
 * calligraphic check; high whimsy = a fat, playful heavy check. We mirror Comic's
 * hybrid pattern — rasterize the chosen glyph into an OFFSCREEN Canvas2D and
 * upload it as a small ALPHA texture the Solarbloom shader samples for the
 * checkmark layer (the bloom + motes stay procedural). The faces ship
 * base64-embedded (check-fonts.ts) and register via the FontFace API, so the
 * effect carries its own glyphs and NEVER fetches an asset at runtime.
 *
 * The texture is a centred square (the glyph fills it); the shader maps a square
 * box around the bloom origin to it and reveals it with a diagonal draw-in wipe.
 */

import { CHECK_FACES } from "./check-fonts.js";

let fontsReady: Promise<void> | null = null;

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Register + load the embedded check faces once. Resolves even if loading fails
 * (the shader then falls back to its analytic SDF checkmark, so the effect still
 * confirms the win). Safe to await before every paint — it's cached.
 */
export function ensureCheckFonts(): Promise<void> {
  if (fontsReady) return fontsReady;
  if (
    typeof document === "undefined" ||
    typeof FontFace === "undefined" ||
    !(document as Document).fonts
  ) {
    fontsReady = Promise.resolve();
    return fontsReady;
  }
  fontsReady = (async () => {
    await Promise.all(
      CHECK_FACES.map(async (f) => {
        try {
          const face = new FontFace(f.family, base64ToArrayBuffer(f.base64));
          await face.load();
          (document as Document).fonts.add(face);
        } catch {
          /* fall back to the analytic SDF checkmark for this fire */
        }
      }),
    );
    try {
      await (document as Document).fonts.ready;
    } catch {
      /* ignore */
    }
  })();
  return fontsReady;
}

// Kick font loading off at import so faces are usually ready by the first fire.
if (typeof document !== "undefined") void ensureCheckFonts();

/**
 * Has the named face actually loaded (so the glyph will render rather than a
 * fallback box)? Used by the renderer to decide whether to upload a glyph
 * texture or let the shader use its analytic checkmark.
 */
export function checkFaceReady(family: string): boolean {
  if (typeof document === "undefined" || !(document as Document).fonts) return false;
  try {
    return (document as Document).fonts.check(`64px "${family}"`);
  } catch {
    return false;
  }
}

/**
 * Rasterize the chosen check glyph, centred, into a square offscreen canvas. The
 * glyph is drawn WHITE on transparent so the shader can read coverage from the
 * alpha channel. Returns true if a glyph was drawn (face present); false if the
 * face wasn't ready (the caller should then disable the glyph texture so the
 * shader uses its analytic fallback). Pure given (family, char, size) — no time.
 */
export function drawCheckGlyph(
  ctx: CanvasRenderingContext2D,
  size: number,
  family: string,
  char: string,
): boolean {
  ctx.clearRect(0, 0, size, size);
  if (!checkFaceReady(family)) return false;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // Fill most of the box; leave a small margin so the wipe + glow have room and
  // CLAMP_TO_EDGE sampling never smears an inked edge.
  ctx.font = `${Math.round(size * 0.78)}px "${family}"`;
  ctx.fillStyle = "#fff";
  // Nudge up a hair: many check glyphs sit slightly low on the em box.
  ctx.fillText(char, size * 0.5, size * 0.52);
  ctx.restore();
  return true;
}
