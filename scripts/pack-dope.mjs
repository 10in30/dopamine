/**
 * pack-dope — authored `.dope` → distributed STANDALONE `.dope`.
 *
 * The authored doc is human-editable (SVG path strings, full notes). This packs
 * it into a runtime-ready, self-contained artifact (docs/effect-format.md §2b):
 *
 *   • outline svgPaths  → baked SDF (inline data: blob)            ← the key one
 *   • assets            → inline (already inline for the built-ins)
 *   • remote/absolute refs → REJECTED (the artifact must be standalone)
 *
 * Output: a single JSON `.dope` (default) with everything inline, or — with
 * --zip — a dotLottie-style `.dope` zip (manifest.json + effects/<id>.json +
 * assets/ with the SDF written out as a relative file). Both forms load with the
 * runtime's loadEffect(); the zip's relative asset is inlined on read.
 *
 * Usage:
 *   node scripts/pack-dope.mjs <authored.dope.json> [out.dope.json] [--zip] [--size N] [--range R]
 */
import { fileURLToPath } from "node:url";
import { dirname, join, basename } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import { importTs } from "./lib/load-ts.mjs";
import { bakeDoc } from "./bake-sdf.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const sdf = await importTs(join(root, "packages/core/src/engine/sdf.ts"));

const REMOTE_RE = /^(?:[a-z][a-z0-9+.-]*:)?\/\//i;
const ABS_RE = /^(?:\/|[A-Za-z]:[\\/])/;

/** Throw on any remote/absolute string anywhere in the doc (except data: URIs). */
function assertStandalone(node, path = "$") {
  if (typeof node === "string") {
    if (node.startsWith("data:")) return;
    if (REMOTE_RE.test(node) || ABS_RE.test(node)) {
      throw new Error(`pack-dope: non-standalone ref at ${path}: "${node}"`);
    }
    return;
  }
  if (Array.isArray(node)) node.forEach((v, i) => assertStandalone(v, `${path}[${i}]`));
  else if (node && typeof node === "object")
    for (const [k, v] of Object.entries(node)) assertStandalone(v, `${path}.${k}`);
}

// ---- a tiny zip writer (STORED + raw DEFLATE) for the --zip form ----------
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function zip(files) {
  // files: [{ name, bytes }]
  const enc = new TextEncoder();
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const nameBytes = enc.encode(f.name);
    const raw = f.bytes;
    const comp = deflateRawSync(raw);
    const useDeflate = comp.length < raw.length;
    const body = useDeflate ? comp : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(20, 4);
    lh.writeUInt16LE(0, 6);
    lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(0, 10); // time/date
    lh.writeUInt32LE(crc, 14);
    lh.writeUInt32LE(body.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(nameBytes.length, 26);
    lh.writeUInt16LE(0, 28);
    locals.push(lh, Buffer.from(nameBytes), Buffer.from(body));
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(20, 4);
    ch.writeUInt16LE(20, 6);
    ch.writeUInt16LE(0, 8);
    ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(0, 12);
    ch.writeUInt32LE(crc, 16);
    ch.writeUInt32LE(body.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(nameBytes.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, Buffer.from(nameBytes));
    offset += lh.length + nameBytes.length + body.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

async function main() {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith("--")));
  const pos = args.filter((a) => !a.startsWith("--"));
  const inFile = pos[0];
  if (!inFile) {
    console.error("usage: node scripts/pack-dope.mjs <authored.dope.json> [out] [--zip] [--size N] [--range R]");
    process.exit(1);
  }
  const sizeIdx = args.indexOf("--size");
  const rangeIdx = args.indexOf("--range");
  const size = sizeIdx >= 0 ? Number(args[sizeIdx + 1]) : 64;
  const range = rangeIdx >= 0 ? Number(args[rangeIdx + 1]) : 18;

  const doc = JSON.parse(await readFile(inFile, "utf8"));
  console.log(`packing ${inFile}`);

  // 1) bake outline paths → inline SDFs (idempotent).
  const baked = bakeDoc(doc, size, range);
  console.log(`  ${baked} outline(s) baked`);

  // 2) enforce standalone on the whole doc.
  assertStandalone(doc);

  if (flags.has("--zip")) {
    // Split the SDF blobs out to assets/, reference them by relative path.
    const enc = new TextEncoder();
    const files = [];
    const id = doc.id ?? basename(inFile).replace(/\.dope\.json$/, "");
    const geo = doc.geometry;
    if (geo?.outlines) {
      for (const [name, o] of Object.entries(geo.outlines)) {
        if (!o.sdf?.data) continue;
        const b64 = o.sdf.data.replace(/^data:[^,]*,/, "");
        const assetName = `assets/${name}.sdf`;
        files.push({ name: assetName, bytes: Buffer.from(b64, "base64") });
        o.sdf.data = assetName; // relative ref; the reader inlines it back
      }
    }
    const effPath = `effects/${id.split(".").pop()}.json`;
    files.unshift({
      name: "manifest.json",
      bytes: enc.encode(JSON.stringify({ fmt: "dopamine-effect", version: doc.v, effects: [{ id, path: effPath }] }, null, 2)),
    });
    files.push({ name: effPath, bytes: enc.encode(JSON.stringify(doc, null, 2)) });
    const out = pos[1] ?? inFile.replace(/\.dope\.json$/, ".dope");
    await writeFile(out, zip(files));
    console.log(`  → wrote zip ${out} (${files.length} entries)`);
  } else {
    const out = pos[1] ?? inFile.replace(/\.dope\.json$/, ".packed.dope.json");
    await writeFile(out, JSON.stringify(doc, null, 2) + "\n");
    console.log(`  → wrote ${out}`);
  }
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
