/**
 * Minimal `.dope` zip (dotLottie-style) reader.
 *
 * A distributed `.dope` may be a zip: a `manifest.json` naming the effect doc
 * plus an `assets/` dir referenced by RELATIVE paths only. This reads the zip
 * entries (STORED or DEFLATE), finds the effect JSON via the manifest (or the
 * first `*.json` under `effects/`), and resolves any relative asset `$ref`s in
 * `geometry.outlines.*` by inlining them as `data:` URIs — so the doc handed to
 * the loader is fully self-contained. Remote/absolute refs are rejected (the
 * loader's standalone guard would reject them anyway; we fail early + clearly).
 *
 * Dependency-free: STORED entries are read directly; DEFLATE entries use the
 * platform `DecompressionStream` when present (browsers + Node ≥18). We don't
 * bundle a zlib.
 */

interface ZipEntry {
  name: string;
  method: number;
  data: Uint8Array; // raw (possibly compressed) bytes
}

function u16(b: Uint8Array, o: number): number {
  return b[o]! | (b[o + 1]! << 8);
}
function u32(b: Uint8Array, o: number): number {
  return (b[o]! | (b[o + 1]! << 8) | (b[o + 2]! << 16) | (b[o + 3]! << 24)) >>> 0;
}

/** Parse the local-file-header records of a zip into raw entries. */
function parseZip(buf: Uint8Array): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const dec = new TextDecoder();
  let i = 0;
  while (i + 4 <= buf.length) {
    const sig = u32(buf, i);
    if (sig !== 0x04034b50) break; // local file header; central dir / EOCD follow
    const method = u16(buf, i + 8);
    const compSize = u32(buf, i + 18);
    const nameLen = u16(buf, i + 26);
    const extraLen = u16(buf, i + 28);
    const nameStart = i + 30;
    const name = dec.decode(buf.subarray(nameStart, nameStart + nameLen));
    const dataStart = nameStart + nameLen + extraLen;
    const data = buf.subarray(dataStart, dataStart + compSize);
    entries.push({ name, method, data });
    i = dataStart + compSize;
  }
  if (entries.length === 0) throw new Error("dope: not a zip (no local file headers)");
  return entries;
}

async function inflate(entry: ZipEntry): Promise<Uint8Array> {
  if (entry.method === 0) return entry.data.slice(); // STORED
  if (entry.method === 8) {
    // raw DEFLATE
    if (typeof (globalThis as { DecompressionStream?: unknown }).DecompressionStream === "undefined") {
      throw new Error("dope: DEFLATE zip entry but no DecompressionStream available");
    }
    const DS = (globalThis as unknown as { DecompressionStream: new (f: string) => unknown })
      .DecompressionStream;
    const ds = new DS("deflate-raw") as unknown as TransformStream<Uint8Array, Uint8Array>;
    // Copy into a standalone ArrayBuffer-backed view for the Blob part.
    const part = new Uint8Array(entry.data.length);
    part.set(entry.data);
    const stream = new Response(new Blob([part]).stream().pipeThrough(ds));
    return new Uint8Array(await stream.arrayBuffer());
  }
  throw new Error(`dope: unsupported zip compression method ${entry.method}`);
}

const ABS_OR_REMOTE = /^(?:[a-z][a-z0-9+.-]*:)?\/\/|^\//i;

/**
 * Read a `.dope` zip → the fully-inlined effect document (a parsed object).
 * Resolves the effect JSON via manifest.json, then inlines relative `$ref`/asset
 * paths under geometry/outlines from the zip's `assets/`.
 */
export async function readDopeZip(buf: Uint8Array): Promise<object> {
  const entries = parseZip(buf);
  const files = new Map<string, ZipEntry>();
  for (const e of entries) files.set(e.name.replace(/^\.?\//, ""), e);

  const textOf = async (name: string): Promise<string> => {
    const e = files.get(name);
    if (!e) throw new Error(`dope zip: missing entry "${name}"`);
    return new TextDecoder().decode(await inflate(e));
  };

  // Locate the effect doc.
  let effectPath: string | undefined;
  if (files.has("manifest.json")) {
    const manifest = JSON.parse(await textOf("manifest.json")) as {
      effects?: { path?: string }[];
    };
    effectPath = manifest.effects?.[0]?.path?.replace(/^\.?\//, "");
  }
  if (!effectPath) {
    effectPath = [...files.keys()].find((n) => /^effects\/.+\.json$/.test(n)) ?? "effect.json";
  }
  const doc = JSON.parse(await textOf(effectPath)) as Record<string, unknown>;

  // Inline relative asset refs in geometry.outlines.*.sdf when stored as a path.
  const geo = doc.geometry as { outlines?: Record<string, Record<string, unknown>> } | undefined;
  if (geo?.outlines) {
    for (const outline of Object.values(geo.outlines)) {
      const sdf = outline.sdf as { data?: string } | undefined;
      const ref = (sdf?.data ?? outline.sdfRef) as string | undefined;
      if (typeof ref === "string" && !ref.startsWith("data:")) {
        if (ABS_OR_REMOTE.test(ref)) {
          throw new Error(`dope zip: outline asset must be a relative path, got "${ref}"`);
        }
        const e = files.get(ref.replace(/^\.?\//, ""));
        if (!e) throw new Error(`dope zip: missing asset "${ref}"`);
        const bytes = await inflate(e);
        const b64 =
          typeof Buffer !== "undefined"
            ? Buffer.from(bytes).toString("base64")
            : btoa(String.fromCharCode(...bytes));
        if (sdf) sdf.data = `data:application/octet-stream;base64,${b64}`;
      }
    }
  }
  return doc;
}
