/**
 * Measure per-entry bundle sizes for the code-split @dopamine/core.
 *
 * For each scenario (core-only, core + one effect, all effects) we write a tiny
 * entry that imports exactly that surface, bundle it with Vite (esbuild minify,
 * tree-shaking on, all chunks inlined into one file so the number is the TOTAL a
 * consumer ships for that scenario), and report raw + gzipped bytes.
 *
 * Usage: node scripts/bundle-size.mjs
 */
import { build } from "vite";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, "packages", "core", "src");

const SCENARIOS = {
  "core only (runtime/api, no effects)": `import * as core from ${JSON.stringify(join(srcDir, "core.ts"))};\nconsole.log(core.play, core.prepare, core.loadEffect, core.registerMood);`,
  "core + fail": entryWith("fail"),
  "core + inkstroke (Verdict)": entryWith("inkstroke"),
  "core + solarbloom": entryWith("solarbloom"),
  "core + comic": entryWith("comic"),
  "all four effects (everything / barrel)": `import * as all from ${JSON.stringify(join(srcDir, "index.ts"))};\nconsole.log(all.celebrate, all.fail, all.celebrateInk, all.celebrateComic);`,
};

function entryWith(name) {
  return (
    `import { play, prepare } from ${JSON.stringify(join(srcDir, "core.ts"))};\n` +
    `import { ${name} } from ${JSON.stringify(join(srcDir, "effects", name + ".ts"))};\n` +
    `console.log(play, prepare, ${name});`
  );
}

async function measure(code) {
  const dir = mkdtempSync(join(tmpdir(), "dope-size-"));
  const entry = join(dir, "entry.ts");
  writeFileSync(entry, code);
  const out = join(dir, "out");
  await build({
    root,
    logLevel: "silent",
    build: {
      outDir: out,
      lib: { entry, formats: ["es"], fileName: "bundle" },
      minify: "esbuild",
      // Inline every dynamic-import chunk so the reported size is the TOTAL the
      // consumer ships for this scenario (not just the entry chunk).
      rollupOptions: { output: { inlineDynamicImports: true } },
      reportCompressedSize: false,
    },
  });
  let raw = 0;
  let gz = 0;
  for (const f of readdirSync(out)) {
    if (!f.endsWith(".js") && !f.endsWith(".mjs")) continue;
    const buf = readFileSync(join(out, f));
    raw += buf.length;
    gz += gzipSync(buf).length;
  }
  rmSync(dir, { recursive: true, force: true });
  return { raw, gz };
}

const kb = (n) => (n / 1024).toFixed(1) + " KB";

async function main() {
  console.log("\nPer-entry bundle sizes (esbuild-minified, dynamic chunks inlined):\n");
  const rows = [];
  for (const [label, code] of Object.entries(SCENARIOS)) {
    const { raw, gz } = await measure(code);
    rows.push({ label, raw, gz });
    console.log(`  ${label.padEnd(42)}  ${kb(raw).padStart(9)} raw   ${kb(gz).padStart(9)} gz`);
  }
  console.log("");
  return rows;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
