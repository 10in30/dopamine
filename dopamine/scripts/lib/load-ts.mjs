/**
 * Load a TypeScript module from source at build time (Node, no ts-node).
 *
 * The SDF baker (packages/core/src/engine/sdf.ts) is the SINGLE source of truth
 * for path→SDF, shared by the runtime AND the build-time pack/bake scripts. To
 * avoid duplicating it in JS, this transpiles the .ts on the fly with esbuild
 * (already a Vite dependency) and imports it as a data: module.
 */
import { transform } from "esbuild";
import { readFile } from "node:fs/promises";

/** Transpile + import a TS file, returning its module namespace. */
export async function importTs(absPath) {
  const src = await readFile(absPath, "utf8");
  const { code } = await transform(src, { loader: "ts", format: "esm", target: "es2020" });
  const url = `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
  return import(url);
}
