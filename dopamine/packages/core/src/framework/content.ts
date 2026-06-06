/**
 * `.dope` CONTENT + TYPOGRAPHY consumers (Phase 3).
 *
 * Phase 0–2 moved an effect's numeric/palette/tempo params + its icon geometry
 * into the `.dope`. Phase 3 finishes the job for the last code-shaped data:
 *
 *  - `content.words` / `content.checkToken` — Comic's affirmation pool + the
 *    checkmark sentinel, picked per-fire by seed.
 *  - `content.glyphBands` — Solarbloom's whimsy→check-glyph (face + char) bands.
 *  - `typography` — Comic's mood→face baselines + the whimsy/intensity CURVE
 *    table (skew/stretch/tracking/outlineLayers/extrude/jitter/roundness),
 *    evaluated with the mapping grammar (extended with mix/max/min).
 *
 * These resolvers reproduce the legacy `mood.ts` arithmetic EXACTLY (the legacy
 * functions stay as the parity reference, just like the numeric path), so a
 * built-in's output is byte-identical while reskinning (different words, font,
 * curves) becomes pure `.dope` editing.
 */

import { evalExpr, type EvalCtx, type ExprNode } from "./loader.js";
import { mulberry32 } from "../engine/seed.js";

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);

/**
 * Deterministically pick one of `list` from a seed. Matches Comic's `pickWord`:
 * `mulberry32(seed>>>0)()` → index. Same seed → same pick; un-pinned scatters.
 */
export function pickFromList<T>(list: readonly T[], seed: number): T {
  const r = mulberry32(seed >>> 0)();
  const idx = Math.min(list.length - 1, Math.floor(r * list.length));
  return list[idx]!;
}

/** A whimsy band entry — a value plus the band it occupies (equal-width bands). */
export interface GlyphBand {
  family: string;
  char: string;
}

/**
 * Pick a band by whimsy (0..1), splitting the slider into equal bands. Matches
 * Solarbloom's `pickCheckGlyph`: `floor(w * n)` clamped to the last band.
 */
export function pickBand<T>(bands: readonly T[], whimsy: number): T {
  const w = clamp01(whimsy);
  const idx = Math.min(bands.length - 1, Math.floor(w * bands.length));
  return bands[idx]!;
}

// ---------------------------------------------------------------------------
// TYPOGRAPHY — the declarative table that replaces `comicTypography`.
// ---------------------------------------------------------------------------

/** Per-mood typographic baselines (the `ComicBaseline` typographic fields). */
export interface TypographyMoodBaseline {
  face: string;
  skew: number;
  tilt: number;
  stretchX: number;
  tracking: number;
  roundness: number;
}

/** The `typography` section of a `.dope`. */
export interface DopeTypography {
  /** Robust CSS fallback chain appended after the mood's primary face. */
  fallbackStack: string;
  /** Per-mood baselines, keyed by mood name. */
  perMood: Record<string, TypographyMoodBaseline>;
  /**
   * Derived numeric fields, each an expression over `control` (intensity/whimsy)
   * + `baseline` (the per-mood typographic baseline). String fields (fontStack)
   * are assembled separately. clamp01/round flags mirror the param specs.
   */
  fields: Record<string, { from: ExprNode; clamp01?: boolean; round?: boolean }>;
}

/** Resolved typography (the numeric fields + the assembled font stack). */
export interface ResolvedTypography {
  fontStack: string;
  [field: string]: number | string;
}

/**
 * Evaluate a typography table for a mood + intensity + whimsy. Pure; the
 * `baseline` context is the per-mood typographic baseline so a field expr can
 * reference e.g. `{ "baseline": "stretchX" }` or `{ "baseline": "roundness" }`.
 */
export function resolveTypography(
  typo: DopeTypography,
  mood: string,
  intensity: number,
  whimsy: number,
): ResolvedTypography {
  const base = typo.perMood[mood] ?? typo.perMood.celebratory!;
  const ctx: EvalCtx = {
    controls: { intensity: clamp01(intensity), whimsy: clamp01(whimsy) },
    // Only the numeric baselines are visible to the grammar.
    baseline: {
      skew: base.skew,
      tilt: base.tilt,
      stretchX: base.stretchX,
      tracking: base.tracking,
      roundness: base.roundness,
    },
    consts: {},
  };
  const out: ResolvedTypography = { fontStack: `${base.face}, ${typo.fallbackStack}` };
  for (const [name, spec] of Object.entries(typo.fields)) {
    let v = evalExpr(spec.from, ctx);
    if (spec.round) v = Math.round(v);
    if (spec.clamp01) v = clamp01(v);
    out[name] = v;
  }
  return out;
}
