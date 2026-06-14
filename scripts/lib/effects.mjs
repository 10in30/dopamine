/**
 * THE canonical list of official Dopamine effects — discovered from the folders
 * in `effects/`, so there is ONE source of truth that every registry derives
 * from (the web umbrella + demo, the README gallery, the reel/media capture, and
 * the Swift + Android demo registries). Adding `effects/<name>/` and running
 * `node scripts/gen-registries.mjs` lights the effect up EVERYWHERE — no list can
 * drift (which is how `checkmate` was missing from the reels).
 *
 * Membership + order come from the folders (alphabetical by slug). Everything an
 * effect "is" comes from its `<slug>.dope.json` (display name, moods, whether it
 * loops). The only non-`.dope` data is per-effect PRESENTATION tuning (the
 * gallery category label + the capture intensity/whimsy/photogenic-still), which
 * lives in ONE table below; a new effect gets sensible defaults until tuned.
 */
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const EFFECTS_DIR = join(ROOT, "effects");

/** slug → Pascal (solarbloom → Solarbloom). */
export const pascal = (slug) => slug.replace(/(^|-)([a-z])/g, (_, __, c) => c.toUpperCase());

/**
 * Per-effect PRESENTATION tuning — NOT in the `.dope` (it's how we showcase the
 * effect, not what it is). `category` is the README gallery label; `intensity`/
 * `whimsy`/`still` tune the headless capture (still = the photogenic life
 * fraction for the PNG). Unlisted effects fall back to DEFAULT_PRESENTATION.
 */
const DEFAULT_PRESENTATION = { category: "effect", mood: "celebratory", intensity: 0.85, whimsy: 0.4, still: 0.4 };
const PRESENTATION = {
  solarbloom: { category: "success", mood: "celebratory", intensity: 0.85, whimsy: 0.35, still: 0.32 },
  inkstroke: { category: "success", mood: "celebratory", intensity: 0.85, whimsy: 0.45, still: 0.6 },
  comic: { category: "success", mood: "celebratory", intensity: 0.85, whimsy: 0.5, still: 0.3 },
  fail: { category: "error", mood: "electric", intensity: 0.9, whimsy: 0.4, still: 0.45 },
  aurora: { category: "success", mood: "serene", intensity: 0.85, whimsy: 0.4, still: 0.5 },
  ripple: { category: "success", mood: "celebratory", intensity: 0.85, whimsy: 0.4, still: 0.4 },
  confetti: { category: "celebration", mood: "celebratory", intensity: 0.9, whimsy: 0.4, still: 0.4 },
  heartburst: { category: "love", mood: "celebratory", intensity: 0.85, whimsy: 0.4, still: 0.32 },
  lightning: { category: "power-up", mood: "electric", intensity: 0.95, whimsy: 0.4, still: 0.3 },
  checkmate: { category: "celebration (pride)", mood: "celebratory", intensity: 0.9, whimsy: 0.55, still: 0.3 },
  halo: { category: "loading (continuous)", mood: "serene", intensity: 0.8, whimsy: 0.45, still: 0.5 },
  dots: { category: "loading (continuous)", mood: "celebratory", intensity: 0.8, whimsy: 0.4, still: 0.5 },
};

/**
 * Discover every official effect: a folder under `effects/` with a canonical
 * `<slug>/<slug>.dope.json`. Returns entries sorted by slug (folder order),
 * merging the `.dope` facts with the presentation tuning.
 */
export function discoverEffects(root = ROOT) {
  const dir = join(root, "effects");
  const slugs = readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, `${d.name}.dope.json`)))
    .map((d) => d.name)
    .sort();

  return slugs.map((slug) => {
    const doc = JSON.parse(readFileSync(join(dir, slug, `${slug}.dope.json`), "utf8"));
    const pres = { ...DEFAULT_PRESENTATION, ...(PRESENTATION[slug] ?? {}) };
    const moods = doc.controls?.mood?.options ?? ["serene", "celebratory", "electric"];
    const defaultMood = doc.controls?.mood?.default ?? moods[0];
    return {
      slug,
      Name: pascal(slug),
      displayName: doc.meta?.name ?? pascal(slug),
      tags: doc.meta?.tags ?? [],
      moods,
      defaultMood,
      loop: Boolean(doc.tempo?.loop),     // a CONTINUOUS effect (halo, dots)
      category: pres.category,
      label: slug,                        // demo-button label = the actual effect name
      // The single-source shader block (x-build.shader): { web, vertexExport,
      // fragmentExport, generateMSL } — present for every pure-shader effect.
      shader: doc["x-build"]?.shader ?? null,
      // Capture knobs: the demo success-mood toggle name (mapped per-effect by the
      // demo onto the effect's own register), intensity/whimsy, and the photogenic
      // still fraction for the README PNG.
      mood: pres.mood,
      intensity: pres.intensity,
      whimsy: pres.whimsy,
      still: pres.still,
      // Derived package/module identifiers, so every registry agrees on names.
      webPackage: `@dopaminefx/effect-${slug}`,
      swiftModule: `DopamineEffect${pascal(slug)}`,
      androidModule: `dopamine-effect-${slug}`,
      androidPackage: `ai.dopamine.effect.${slug}`,
    };
  });
}
