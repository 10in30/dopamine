/**
 * Phase 2 — `.dope` zip reader (dotLottie-style).
 *
 * Builds a tiny STORED zip (manifest + effect json + a relative SDF asset) in
 * memory, reads it back through readDopeZip, and asserts the relative asset is
 * inlined to a `data:` URI so the resulting doc is self-contained. Also checks a
 * remote asset ref is rejected.
 */

import { describe, expect, it } from "vitest";
import { readDopeZip } from "../src/framework/dope-zip.js";
import { bakeSdf } from "../src/engine/sdf.js";

// --- minimal STORED zip writer (method 0, no compression) -------------------
function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function storedZip(files: { name: string; bytes: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  const w16 = (dv: DataView, o: number, v: number) => dv.setUint16(o, v, true);
  const w32 = (dv: DataView, o: number, v: number) => dv.setUint32(o, v >>> 0, true);
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.bytes);
    const lh = new Uint8Array(30);
    const ldv = new DataView(lh.buffer);
    w32(ldv, 0, 0x04034b50);
    w16(ldv, 4, 20);
    w16(ldv, 8, 0); // STORED
    w32(ldv, 14, crc);
    w32(ldv, 18, f.bytes.length);
    w32(ldv, 22, f.bytes.length);
    w16(ldv, 26, name.length);
    chunks.push(lh, name, f.bytes);
    const ch = new Uint8Array(46);
    const cdv = new DataView(ch.buffer);
    w32(cdv, 0, 0x02014b50);
    w16(cdv, 10, 0);
    w32(cdv, 16, crc);
    w32(cdv, 20, f.bytes.length);
    w32(cdv, 24, f.bytes.length);
    w16(cdv, 28, name.length);
    w32(cdv, 42, offset);
    central.push(ch, name);
    offset += lh.length + name.length + f.bytes.length;
  }
  const localBuf = concat(chunks);
  const centralBuf = concat(central);
  const eocd = new Uint8Array(22);
  const edv = new DataView(eocd.buffer);
  w32(edv, 0, 0x06054b50);
  w16(edv, 8, files.length);
  w16(edv, 10, files.length);
  w32(edv, 12, centralBuf.length);
  w32(edv, 16, localBuf.length);
  return concat([localBuf, centralBuf, eocd]);
}
function concat(arrs: Uint8Array[]): Uint8Array {
  const len = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrs) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

const enc = new TextEncoder();

function baseDoc(sdfRef: string): object {
  return {
    fmt: "dopamine-effect",
    v: "1.0.0",
    id: "test.zip.effect",
    palette: { perMood: { celebratory: { hueCenter: 50, hueRange: 320, lightness: 0.8, chroma: 0.16 } } },
    baselines: { celebratory: {} },
    render: { params: {} },
    geometry: {
      viewBox: [0, 0, 100, 100],
      outlines: { checkmark: { svgPath: "M 5 55 L 38 88 L 95 12", sdf: { size: 64, range: 18, viewBox: [0, 0, 100, 100], data: sdfRef } } },
    },
  };
}

describe("readDopeZip", () => {
  it("inlines a relative SDF asset to a data: URI", async () => {
    const baked = bakeSdf("M 5 55 L 38 88 L 95 12", [0, 0, 100, 100], 64, 18);
    // strip the data: prefix → raw bytes for the relative asset
    const b64 = baked.data.replace(/^data:[^,]*,/, "");
    const sdfBytes = Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0));
    const doc = baseDoc("assets/checkmark.sdf");
    const zip = storedZip([
      { name: "manifest.json", bytes: enc.encode(JSON.stringify({ effects: [{ id: "test.zip.effect", path: "effects/e.json" }] })) },
      { name: "effects/e.json", bytes: enc.encode(JSON.stringify(doc)) },
      { name: "assets/checkmark.sdf", bytes: sdfBytes },
    ]);
    const out = (await readDopeZip(zip)) as { geometry: { outlines: { checkmark: { sdf: { data: string } } } } };
    const data = out.geometry.outlines.checkmark.sdf.data;
    expect(data.startsWith("data:")).toBe(true);
    expect(data).toBe(baked.data); // inlined bytes match the original blob
  });

  it("rejects a remote asset ref", async () => {
    const doc = baseDoc("https://cdn.example.com/x.sdf");
    const zip = storedZip([
      { name: "effects/e.json", bytes: enc.encode(JSON.stringify(doc)) },
    ]);
    await expect(readDopeZip(zip)).rejects.toThrow(/relative/);
  });
});
