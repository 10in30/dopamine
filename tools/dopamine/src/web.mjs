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
 *
 * VERSIONING: each effect is versioned INDEPENDENTLY. The single source of truth
 * is the tracked workspace manifest `effects/<id>/web/package.json` (bumped by
 * Changesets) — its `version` and its `@dopaminefx/core` range are read here so
 * the emitted standalone package stays byte-honest with what npm actually ships.
 */

import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";

const REPO = "https://github.com/10in30/dopamine";

function emitWebPackageJson({ pkgName, slug, meta, version, coreRange, directory }) {
  return JSON.stringify(
    {
      name: pkgName,
      version,
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
      dependencies: { "@dopaminefx/core": coreRange },
      license: "MIT",
      author: "10in30",
      homepage: `${REPO}#readme`,
      repository: { type: "git", url: `git+${REPO}.git`, directory },
      bugs: { url: `${REPO}/issues` },
      publishConfig: { access: "public" },
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
export async function generateNpmPackage({ root, eff }) {
  const { dir, doc, slug, dope } = eff;
  const web = doc["x-build"].web ?? {};
  const pkgName = web.package ?? `@dopaminefx/effect-${slug}`;
  const sourcesRel = web.sources ?? "web";
  const srcAbs = join(dir, sourcesRel, "src");

  // The tracked workspace manifest is the per-effect version source of truth.
  const wsPkg = JSON.parse(await readFile(join(dir, sourcesRel, "package.json"), "utf8"));
  const version = wsPkg.version ?? "0.0.0";
  const coreRange = wsPkg.dependencies?.["@dopaminefx/core"] ?? "^0.1.0";
  const directory = (root ? relative(root, join(dir, sourcesRel)) : join(dir, sourcesRel)).replace(/\\/g, "/");

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
  out.push({ path: join(pkgRel, "package.json"), content: emitWebPackageJson({ pkgName, slug, meta: doc.meta, version, coreRange, directory }) });
  out.push({ path: join(pkgRel, "tsconfig.json"), content: emitWebTsconfig() });

  return out;
}
