/**
 * Mood registry — the shared, effect-agnostic "emotional register" layer.
 *
 * A mood describes a *feeling baseline* (how warm, how energetic, how bright) in
 * effect-neutral terms. Every effect reads the same resolved mood, so adding a
 * mood ("triumphant", "focused", a brand mood) lights up across *all* effects at
 * once — no per-effect edits.
 *
 * Why a register, not a full param table: the three built-in effects share their
 * *color identity* per mood (the same `hueCenter`/`hueRange` — a serene blue, a
 * celebratory roam, a hot electric band) but each effect has its own spatial /
 * motion / typographic baselines (a bloom radius means nothing to a comic word).
 * So the registry owns the shared register + a normalized `energy`, and each
 * effect's `mood.ts` baseline table keys off the mood name (built-ins keep their
 * exact tuned values; an unfamiliar mood is derived from the register + energy
 * so it still renders sensibly everywhere). This keeps built-in output
 * byte-identical to the legacy `resolve*Params` while making moods extensible.
 */

/** Effect-neutral description of a mood's shared color register + energy. */
export interface MoodSpec {
  /** Preferred hue center in degrees (arousal rises blue→green→red). */
  hueCenter: number;
  /** Width of the random hue band around the center, in degrees. */
  hueRange: number;
  /** Perceptual lightness reference for palettes, 0..1. */
  lightness: number;
  /** Base chroma (colorfulness) reference for palettes, ~0..0.4. */
  chroma: number;
  /**
   * Normalized energy 0..1 (serene → electric). Effects use this to derive a
   * baseline for a mood they have no tuned table entry for (faster, denser,
   * harder slams toward 1). Built-in effects ignore it for their built-in moods.
   */
  energy: number;
}

/** A mood resolved for use: its spec plus the name it was registered under. */
export interface ResolvedMood extends MoodSpec {
  readonly name: string;
}

/**
 * The three built-in moods. The register values mirror the per-mood columns
 * shared by all three effects' baseline tables in `mood.ts`; `energy` orders
 * them serene(0) → celebratory(0.5) → electric(1).
 */
const BUILTIN_MOODS: Record<string, MoodSpec> = {
  serene: { hueCenter: 230, hueRange: 120, lightness: 0.83, chroma: 0.1, energy: 0.0 },
  celebratory: { hueCenter: 50, hueRange: 320, lightness: 0.81, chroma: 0.17, energy: 0.5 },
  electric: { hueCenter: 35, hueRange: 150, lightness: 0.79, chroma: 0.24, energy: 1.0 },
};

const moods = new Map<string, MoodSpec>(Object.entries(BUILTIN_MOODS));

/** The mood used when none is given or an unknown one is requested. */
export const DEFAULT_MOOD = "celebratory";

/**
 * Register (or override) a mood. Returns the name so it can be used inline.
 *
 * ```ts
 * registerMood("triumphant", { hueCenter: 280, hueRange: 160,
 *                              lightness: 0.8, chroma: 0.22, energy: 0.9 });
 * await celebrate({ mood: "triumphant" });   // now works for ALL effects
 * ```
 */
export function registerMood(name: string, spec: MoodSpec): string {
  moods.set(name, spec);
  return name;
}

/** Look up a mood, falling back to the default. Always returns a usable mood. */
export function resolveMood(name: string | undefined): ResolvedMood {
  const key = name && moods.has(name) ? name : DEFAULT_MOOD;
  return { name: key, ...moods.get(key)! };
}

/** Whether a mood name is currently registered. */
export function hasMood(name: string): boolean {
  return moods.has(name);
}

/** Names of all registered moods (built-in + custom). */
export function moodNames(): string[] {
  return [...moods.keys()];
}
