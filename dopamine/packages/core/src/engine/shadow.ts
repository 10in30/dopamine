/**
 * Shadow-pass geometry — the pure math that turns an effect's amplitude,
 * "height" above the page, and stylization into the offset / softness /
 * strength of the cast soft shadow. Kept framework- and GL-free so it can be
 * unit-tested and reused by any effect that adopts the multiply shadow layer.
 *
 * Conventions (device pixels, gl coords where Y is UP):
 *   - The implied key light sits up-and-left of the floating effect, so the
 *     shadow falls DOWN-and-right: offset = (+x, -y).
 *   - `offset` grows with the occluder's height and with amplitude (a brighter,
 *     higher source throws a longer shadow).
 *   - `soft` (penumbra blur radius) is larger for a soft photoreal source and
 *     tightens toward the hard graphic drop-shadow of the cel end.
 *   - `strength` is the max darkening of the multiply layer (0 = none); kept
 *     ambient-occlusion subtle, a touch firmer toward cel.
 */

export interface ShadowGeometry {
  /** Silhouette offset in device px, gl coords (x right, y up). */
  offsetX: number;
  offsetY: number;
  /** Penumbra blur tap radius in device px. */
  soft: number;
  /** Max multiply darkening, 0..1. */
  strength: number;
}

export interface ShadowInput {
  /** Smaller canvas dimension in device px. */
  minDim: number;
  /**
   * The occluder's "height" above the page as a fraction of `minDim` — bigger
   * forms read as floating higher and cast longer, softer shadows. For
   * Solarbloom this is the bloom radius fraction; for Verdict, the stroke scale.
   */
  heightFrac: number;
  /** Envelope amplitude (peaks > 1). */
  amp: number;
  /** Stylization 0..1 (photoreal → cel). */
  style: number;
}

const clamp = (x: number, lo: number, hi: number): number =>
  x < lo ? lo : x > hi ? hi : x;

export function shadowGeometry({ minDim, heightFrac, amp, style }: ShadowInput): ShadowGeometry {
  const height = heightFrac * minDim;
  // Offset length: scales with height and (clamped) amplitude. A meaningful
  // drop so the silhouette clears the bright core (which the screen light owns)
  // and lands as a distinct shadow on the UI beside/below it.
  const off = height * 0.16 * (0.6 + 0.5 * Math.min(amp, 1.5));
  // Penumbra: wide & soft when photoreal, tight when cel; always a small floor.
  const soft = minDim * 0.014 * (1 - 0.6 * style) + minDim * 0.005;
  // Darkening of the multiply layer. Kept ambient at the soft end, firmer (a
  // graphic drop-shadow) toward cel. Reads clearly where it falls on the
  // lighter raised faces / the white primary button.
  const strength = clamp(0.6 * (0.8 + 0.45 * style), 0, 1);
  return {
    // Down-and-right: x positive, y negative (gl Y up). x is a fraction of the
    // drop so the shadow leans, not straight down.
    offsetX: off * 0.55,
    offsetY: -off,
    soft,
    strength,
  };
}
