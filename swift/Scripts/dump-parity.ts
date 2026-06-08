// Dump the WEB loader's resolved params across a mood × intensity × whimsy ×
// seed grid → a JSON fixture the Swift byte-parity test asserts against. This
// runs the ACTUAL web code (loader.ts) so the fixture is ground truth, not a
// reimplementation.
//
// Regenerate (Node >= 22, no build): `./regen-parity.sh` stages the web
// engine/{seed,color}.ts + framework/loader.ts with `.ts` import specifiers (so
// `node --experimental-strip-types` resolves them) into a temp dir, copies this
// script in, and runs it. The import below points at that staged copy.
import { readFileSync } from "node:fs";
import { parseDope, resolveDopeParams } from "./framework/loader.ts";

const docText = readFileSync(process.argv[2], "utf8");
const doc = parseDope(docText);

const moods = ["serene", "celebratory", "electric", "unknownMood"];
const intensities = [0, 0.3, 0.7, 1];
const whimsies = [0, 0.5, 1];
const seeds = [1, 42, 123456, 4294967295];

const MAX_MOTES = 80;
const cases: any[] = [];

for (const mood of moods)
  for (const intensity of intensities)
    for (const whimsy of whimsies)
      for (const seed of seeds) {
        const out = resolveDopeParams(
          doc,
          { mood, intensity, whimsy, seed },
          { MAX_MOTES },
          "moteSeed",
        );
        // Normalize palette RGB objects → flat arrays for stable comparison.
        const palette = (out.palette as any[]).map((c) => [c.r, c.g, c.b]);
        const scalars: Record<string, number> = {};
        for (const [k, v] of Object.entries(out)) {
          if (k === "palette") continue;
          scalars[k] = v as number;
        }
        cases.push({ mood, intensity, whimsy, seed, scalars, palette });
      }

process.stdout.write(JSON.stringify({ grid: { moods, intensities, whimsies, seeds }, cases }, null, 2));
