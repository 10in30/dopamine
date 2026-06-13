// Baked-SDF blob decoder — the Swift port of `engine/sdf.ts`'s `decodeSdf`.
//
// PORTABLE (no `#if canImport(Metal)` guard): pure byte decoding of the inline
// `data:` SDF blob the build step inlines into the `.dope`. The native runner
// (MetalPassRunner) uploads the decoded single-channel bytes as an R8 texture;
// this decode step is shared and Linux-buildable, mirroring the web posture
// (decode at runtime, never re-bake).
//
// Encoding (from the baker, `engine/sdf.ts`): a 4-byte header — magic 'D','S'
// (0x44, 0x53), then size hi/lo — followed by `size*size` single-channel 0..255
// distance bytes, the whole thing base64-encoded behind a
// `data:application/octet-stream;base64,` URI.

import Foundation

/// A decoded SDF ready to upload: the single-channel distance bytes + the square
/// grid `size`. Mirror of the web `DecodedSdf` (minus the range/viewBox metadata,
/// which the native runtimes read off `render.pass` separately).
public struct DopeDecodedSdf {
    public let size: Int
    /// `size`×`size` single-channel (0..255) distance bytes.
    public let bytes: [UInt8]
    public init(size: Int, bytes: [UInt8]) {
        self.size = size
        self.bytes = bytes
    }
}

private let sdfDataPrefix = "data:application/octet-stream;base64,"
private let sdfMagic0: UInt8 = 0x44  // 'D'
private let sdfMagic1: UInt8 = 0x53  // 'S'

/// Decode a baked SDF `data:` URI (or a bare base64 blob) back to its raw
/// single-channel distance bytes. Validates the magic + the declared size
/// against the byte count; returns nil on a bad magic / size mismatch / invalid
/// base64 (the caller degrades to the analytic fallback rather than crashing).
public func decodeDopeSdf(_ dataURI: String) -> DopeDecodedSdf? {
    let b64 = dataURI.hasPrefix(sdfDataPrefix)
        ? String(dataURI.dropFirst(sdfDataPrefix.count))
        : dataURI  // tolerate a bare base64 blob too
    guard let blob = Data(base64Encoded: b64) else { return nil }
    guard blob.count >= 4, blob[0] == sdfMagic0, blob[1] == sdfMagic1 else { return nil }
    let size = (Int(blob[2]) << 8) | Int(blob[3])
    let body = blob.dropFirst(4)
    guard body.count == size * size else { return nil }
    return DopeDecodedSdf(size: size, bytes: [UInt8](body))
}
