// Bundle-resource helpers — load a `.dope` document from a SwiftPM resource
// bundle. Portable (no Apple-only API): `Bundle.module` is provided by SwiftPM
// on every platform, including Linux.

import Foundation

public enum DopeResource {
    // DopamineCore ships no resources of its own — it is effect-agnostic. Each
    // SwiftPM module gets its own `Bundle.module`, so a caller (an effect package,
    // or the parity test) passes ITS OWN `Bundle.module` to load a bundled `.dope`.

    /// Load + parse a bundled `.dope` JSON resource by base name (no extension)
    /// from the given module bundle.
    public static func loadDope(_ name: String, ext: String = "json", bundle: Bundle) throws -> DopeDoc {
        guard let url = bundle.url(forResource: name, withExtension: ext) else {
            throw DopeError.missingSections
        }
        let text = try String(contentsOf: url, encoding: .utf8)
        return try parseDope(text)
    }

    /// Read raw bytes of a bundled resource (used by the byte-parity test to
    /// confirm the Swift + web `.dope` are the SAME bytes).
    public static func rawData(_ name: String, ext: String = "json", bundle: Bundle) throws -> Data {
        guard let url = bundle.url(forResource: name, withExtension: ext) else {
            throw DopeError.missingSections
        }
        return try Data(contentsOf: url)
    }
}
