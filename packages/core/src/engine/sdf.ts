/**
 * SVG path → signed-distance-field (SDF) baker + runtime decoder.
 *
 * This is the "geometry seam": an effect's icon outline lives in its `.dope` as
 * an `svgPath` string (authored, host-swappable). A BUILD step (scripts/bake-sdf
 * or scripts/pack-dope) rasterizes that path into a small, self-contained SDF and
 * inlines it into the distributed `.dope` (a `data:`-style base64 blob, no remote
 * fetch). At RUNTIME the effect only DECODES + SAMPLES the SDF — it never does a
 * live path→SDF conversion — so swapping the path in the `.dope` changes the
 * rendered icon with no shader edit.
 *
 * The SDF here is a stroked-outline distance field: distance to the path's
 * centerline (a polyline flattened from the bezier/line segments), so the icon
 * reads as a *drawn stroke in light* (a tick, a cross, a custom mark), matching
 * the "drawn-in-light" language of the built-ins. The field is signed only in the
 * stroke sense (we store distance-to-stroke, with a coverage falloff applied at
 * sample time by the shader against the declared stroke width), which is all the
 * "drawn in light" look needs and keeps the bake free of robust point-in-polygon
 * winding for arbitrary self-intersecting glyphs.
 *
 * Encoding (intentionally tiny, dependency-free, portable to Swift):
 *   - a fixed-size square grid of `size`×`size` 8-bit samples,
 *   - each sample = clamp(distance / range, 0..1) * 255 (0 = on the stroke,
 *     255 = `range` author-units or more away),
 *   - serialized as a 4-byte header (magic 'D','S', size hi/lo) + the bytes,
 *     base64-encoded. `range` + `viewBox` travel as JSON next to the blob.
 */

/** A flattened 2D point in author/viewBox units. */
export interface Pt {
  x: number;
  y: number;
}

/**
 * Parse a (subset of) SVG path data into a list of polylines (each a list of
 * points in author units). Supports absolute + relative M/L/H/V/C/Q/Z (the
 * commands a designer's checkmark / cross / icon outline actually use). Curves
 * are flattened to line segments at `steps` subdivisions — plenty for an SDF.
 */
export function parseSvgPath(d: string, steps = 24): Pt[][] {
  const polylines: Pt[][] = [];
  let cur: Pt[] = [];
  let cx = 0;
  let cy = 0;
  let startX = 0;
  let startY = 0;

  // Tokenize into command letters + numeric runs.
  const tokens = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? [];
  let i = 0;
  const num = (): number => Number(tokens[i++]);
  const has = (): boolean => i < tokens.length && /^-?\.?\d/.test(tokens[i]!);

  const push = (x: number, y: number): void => {
    cur.push({ x, y });
    cx = x;
    cy = y;
  };
  const flushCur = (): void => {
    if (cur.length > 1) polylines.push(cur);
    cur = [];
  };

  let cmd = "";
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (/[a-zA-Z]/.test(t)) {
      cmd = t;
      i++;
    } else if (!cmd) {
      i++;
      continue;
    }
    const rel = cmd === cmd.toLowerCase();
    switch (cmd.toUpperCase()) {
      case "M": {
        flushCur();
        const x = num() + (rel ? cx : 0);
        const y = num() + (rel ? cy : 0);
        startX = x;
        startY = y;
        push(x, y);
        cmd = rel ? "l" : "L"; // subsequent pairs are implicit lineto
        while (has()) {
          const lx = num() + (rel ? cx : 0);
          const ly = num() + (rel ? cy : 0);
          push(lx, ly);
        }
        break;
      }
      case "L": {
        do {
          const x = num() + (rel ? cx : 0);
          const y = num() + (rel ? cy : 0);
          push(x, y);
        } while (has());
        break;
      }
      case "H": {
        do {
          const x = num() + (rel ? cx : 0);
          push(x, cy);
        } while (has());
        break;
      }
      case "V": {
        do {
          const y = num() + (rel ? cy : 0);
          push(cx, y);
        } while (has());
        break;
      }
      case "C": {
        do {
          const x1 = num() + (rel ? cx : 0);
          const y1 = num() + (rel ? cy : 0);
          const x2 = num() + (rel ? cx : 0);
          const y2 = num() + (rel ? cy : 0);
          const x = num() + (rel ? cx : 0);
          const y = num() + (rel ? cy : 0);
          const p0 = { x: cx, y: cy };
          for (let s = 1; s <= steps; s++) {
            const u = s / steps;
            const mt = 1 - u;
            const bx =
              mt * mt * mt * p0.x + 3 * mt * mt * u * x1 + 3 * mt * u * u * x2 + u * u * u * x;
            const by =
              mt * mt * mt * p0.y + 3 * mt * mt * u * y1 + 3 * mt * u * u * y2 + u * u * u * y;
            push(bx, by);
          }
        } while (has());
        break;
      }
      case "Q": {
        do {
          const x1 = num() + (rel ? cx : 0);
          const y1 = num() + (rel ? cy : 0);
          const x = num() + (rel ? cx : 0);
          const y = num() + (rel ? cy : 0);
          const p0 = { x: cx, y: cy };
          for (let s = 1; s <= steps; s++) {
            const u = s / steps;
            const mt = 1 - u;
            const bx = mt * mt * p0.x + 2 * mt * u * x1 + u * u * x;
            const by = mt * mt * p0.y + 2 * mt * u * y1 + u * u * y;
            push(bx, by);
          }
        } while (has());
        break;
      }
      case "Z": {
        if (cur.length) {
          push(startX, startY);
          flushCur();
        }
        break;
      }
      default:
        // Unknown command — skip its number to avoid an infinite loop.
        if (has()) num();
        break;
    }
  }
  flushCur();
  return polylines;
}

/** Distance from point p to segment a→b, in author units. */
function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-9 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + dx * t;
  const qy = ay + dy * t;
  return Math.hypot(px - qx, py - qy);
}

/** A baked SDF: a square grid + the metadata a sampler needs. */
export interface BakedSdf {
  /** Grid resolution (square). */
  size: number;
  /** Author-units of distance that map to the full 0..255 byte range. */
  range: number;
  /** The viewBox the path was authored in: [minX, minY, w, h]. */
  viewBox: [number, number, number, number];
  /**
   * A `data:` URI carrying the header + size×size 8-bit distance bytes (base64).
   * A `data:` URI (not a remote/absolute ref) keeps the `.dope` self-contained
   * and passes the loader's standalone guard. The runtime decodes + samples it.
   */
  data: string;
}

/** The MIME used for the inline SDF `data:` URI. */
const SDF_MIME = "application/octet-stream";
const SDF_DATA_PREFIX = `data:${SDF_MIME};base64,`;

const MAGIC0 = 0x44; // 'D'
const MAGIC1 = 0x53; // 'S'

/** Encode raw bytes to base64 in both Node and the browser. */
function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  // eslint-disable-next-line no-undef
  return btoa(bin);
}

/** Decode base64 to raw bytes in both Node and the browser. */
function base64ToBytes(b64: string): Uint8Array {
  if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
  // eslint-disable-next-line no-undef
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * BAKE: rasterize an SVG path into a stroked-distance SDF. Pure + deterministic.
 * `size` is the grid resolution; `range` is how many author-units of distance map
 * to the full byte range (a larger range = a softer, wider usable falloff). The
 * path is normalized into a centered square that preserves its aspect inside the
 * grid, leaving a small margin so the stroke + its glow never clip the edge.
 */
export function bakeSdf(
  svgPath: string,
  viewBox: [number, number, number, number],
  size = 64,
  range = 18,
): BakedSdf {
  const polylines = parseSvgPath(svgPath);
  const [vx, vy, vw, vh] = viewBox;
  const bytes = new Uint8Array(size * size);

  // Map a grid cell center to author/viewBox coordinates (y stays top-down, the
  // shader flips as needed). The whole viewBox maps to the grid 0..size.
  for (let gy = 0; gy < size; gy++) {
    for (let gx = 0; gx < size; gx++) {
      const ax = vx + ((gx + 0.5) / size) * vw;
      const ay = vy + ((gy + 0.5) / size) * vh;
      let best = Infinity;
      for (const poly of polylines) {
        for (let k = 0; k + 1 < poly.length; k++) {
          const d = distToSeg(ax, ay, poly[k]!.x, poly[k]!.y, poly[k + 1]!.x, poly[k + 1]!.y);
          if (d < best) best = d;
        }
      }
      const norm = best === Infinity ? 1 : Math.min(1, best / range);
      bytes[gy * size + gx] = Math.round(norm * 255);
    }
  }

  const header = new Uint8Array(4);
  header[0] = MAGIC0;
  header[1] = MAGIC1;
  header[2] = (size >> 8) & 0xff;
  header[3] = size & 0xff;
  const blob = new Uint8Array(header.length + bytes.length);
  blob.set(header, 0);
  blob.set(bytes, header.length);

  return { size, range, viewBox, data: SDF_DATA_PREFIX + bytesToBase64(blob) };
}

/** A decoded SDF ready to upload: the raw single-channel bytes + its size. */
export interface DecodedSdf {
  size: number;
  range: number;
  viewBox: [number, number, number, number];
  /** size×size single-channel (0..255) distance bytes. */
  bytes: Uint8Array;
}

/**
 * DECODE a baked SDF blob back to its raw distance bytes. Validates the magic +
 * the declared size against the byte count. Used by the runtime to upload an
 * `R8`/alpha texture — the runtime SAMPLES this; it never re-bakes.
 */
export function decodeSdf(baked: BakedSdf): DecodedSdf {
  const b64 = baked.data.startsWith(SDF_DATA_PREFIX)
    ? baked.data.slice(SDF_DATA_PREFIX.length)
    : baked.data; // tolerate a bare base64 blob too
  const blob = base64ToBytes(b64);
  if (blob.length < 4 || blob[0] !== MAGIC0 || blob[1] !== MAGIC1) {
    throw new Error("dope: not a baked SDF blob (bad magic)");
  }
  const size = (blob[2]! << 8) | blob[3]!;
  const bytes = blob.subarray(4);
  if (bytes.length !== size * size) {
    throw new Error(`dope: SDF size mismatch (header ${size}^2 != ${bytes.length} bytes)`);
  }
  return { size, range: baked.range, viewBox: baked.viewBox, bytes: bytes.slice() };
}
