// Baked-SDF runtime DECODER — the pure-JVM port of `engine/sdf.ts`'s `decodeSdf`.
//
// An effect's icon outline is baked at build time into a tiny, self-contained
// distance field and inlined into the `.dope` as a `data:` base64 blob (see
// `engine/sdf.ts` for the baker + the wire format). At RUNTIME the platform only
// DECODES + SAMPLES it (never re-bakes), so this is all the native side needs.
//
// This lives in `dopamine-core` (PURE JVM, no `android.*`) so the decode is
// testable on the parity grid with no Android SDK; the GL upload/bind of the
// decoded bytes lives in `dopamine-gl`.
//
// Wire format (must match `engine/sdf.ts`):
//   - a 4-byte header: magic 'D'(0x44), 'S'(0x53), then size hi/lo (big-endian),
//   - followed by size×size single-channel (0..255) distance bytes,
//   - the whole blob base64-encoded behind a `data:...;base64,` URI.

package ai.dopamine.core

import java.util.Base64

/** A decoded SDF ready to upload: the grid `size` + its `size*size` distance bytes. */
class DopeDecodedSdf(val size: Int, val bytes: ByteArray)

/** The MIME prefix the baker writes (`engine/sdf.ts`'s `SDF_DATA_PREFIX`). */
private const val SDF_DATA_PREFIX = "data:application/octet-stream;base64,"

private const val MAGIC0 = 0x44 // 'D'
private const val MAGIC1 = 0x53 // 'S'

/**
 * Decode a baked-SDF `data:...;base64,` (or bare base64) blob → its raw
 * single-channel distance bytes + grid size. Validates the magic + that the
 * declared size matches the byte count; returns null on a bad/short/mismatched
 * blob (so a caller can fall back to the analytic path rather than throwing).
 *
 * Bytes are SIGNED in Kotlin — the size header is read with `.toInt() and 0xFF`.
 */
fun decodeDopeSdf(dataURI: String): DopeDecodedSdf? {
    val b64 = if (dataURI.startsWith(SDF_DATA_PREFIX)) dataURI.substring(SDF_DATA_PREFIX.length) else dataURI
    val blob = try {
        Base64.getDecoder().decode(b64.trim())
    } catch (e: IllegalArgumentException) {
        return null
    }
    if (blob.size < 4) return null
    if ((blob[0].toInt() and 0xFF) != MAGIC0 || (blob[1].toInt() and 0xFF) != MAGIC1) return null
    val size = ((blob[2].toInt() and 0xFF) shl 8) or (blob[3].toInt() and 0xFF)
    val bytes = blob.copyOfRange(4, blob.size)
    if (bytes.size != size * size) return null
    return DopeDecodedSdf(size, bytes)
}
