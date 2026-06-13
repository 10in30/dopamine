/**
 * dopamine toolchain — npm (web) package emitter.
 *
 * Turns a single effect folder into a STANDALONE, publishable npm package under
 * `dist/web/effect-<slug>/`:
 *
 *   dist/web/effect-comic/
 *     package.json                 (generated; deps @dopaminefx/core)
 *     tsconfig.json                (generated; standalone)
 *     src/*.ts                     (the hand-written web sources, copied)
 *     src/<slug>.dope.json         (the PORTABLE embedded data spine; index imports "./<slug>.dope.json")
 *
 * The in-repo workspace package (effects/comic/web) consumes the SAME sources +
 * a gitignored generated `src/<slug>.dope.json` (written by build.mjs), so the
 * monorepo builds/tests against source while this dist package is the publish form.
 */

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

function emitWebPackageJson({ pkgName, slug, meta }) {
  return JSON.stringify(
    {
      name: pkgName,
      version: "0.1.0",
      description: meta?.description ?? `${meta?.name ?? slug} — a Dopamine effect.`,
      keywords: ["dopamine-effect"],
      type: "module",
      main: "./dist/index.js",
      module: "./dist/index.js",
      types: "./dist/index.d.ts",
      exports: { ".": { types: "./dist/index.d.ts", default: "./dist/index.js" } },
      files: ["dist", "src"],
      sideEffects: ["./src/index.ts", "./dist/index.js"],
      scripts: { build: "tsc -p tsconfig.json" },
      dependencies: { "@dopaminefx/core": "^0.1.0" },
    },
    null,
    2,
  ) + "\n";
}

function emitWebTsconfig() {
  return JSON.stringify(
    {
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        lib: ["ES2022", "DOM"],
        declaration: true,
        outDir: "./dist",
        rootDir: "./src",
        strict: true,
        resolveJsonModule: true,
        esModuleInterop: true,
        skipLibCheck: true,
        forceConsistentCasingInFileNames: true,
      },
      include: ["src"],
    },
    null,
    2,
  ) + "\n";
}

/**
 * Generate the npm package artifacts for one loaded effect (`eff` from loadEffect).
 * @returns {Promise<Array<{ path: string, content: string }>>} dist-relative paths.
 */
export async function generateNpmPackage({ eff }) {
  const { dir, doc, slug, dope } = eff;
  const web = doc["x-build"].web ?? {};
  const pkgName = web.package ?? `@dopaminefx/effect-${slug}`;
  const srcAbs = join(dir, web.sources ?? "web", "src");

  const pkgRel = join("web", `effect-${slug}`);
  const out = [];

  // (1) hand-written web sources (src/*.ts — the factory, tempo, renderer, shader,
  //     fonts, params).
  for (const name of (await readdir(srcAbs)).sort()) {
    if (name.endsWith(".ts")) {
      out.push({ path: join(pkgRel, "src", name), content: await readFile(join(srcAbs, name), "utf8") });
    }
  }

  // (2) the PORTABLE embedded data spine, co-located with index (which imports
  //     "./<slug>.dope.json"). Toolchain keys stripped → standalone-safe.
  out.push({ path: join(pkgRel, "src", `${slug}.dope.json`), content: dope });

  // (3) generated package.json + tsconfig (standalone; external @dopaminefx/core dep).
  out.push({ path: join(pkgRel, "package.json"), content: emitWebPackageJson({ pkgName, slug, meta: doc.meta }) });
  out.push({ path: join(pkgRel, "tsconfig.json"), content: emitWebTsconfig() });

  return out;
}
