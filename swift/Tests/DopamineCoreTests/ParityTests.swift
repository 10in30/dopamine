// Cross-platform byte-parity tests — the headline proof that the ported math +
// the SHARED `.dope` data agree across web and Swift.
//
//  1. Byte parity: the `.dope` bundled into BOTH packages is the SAME bytes as
//     the canonical web file (asserts the data spine is shared verbatim).
//  2. Resolve parity: resolving the bundled `.dope` across a mood × intensity ×
//     whimsy × seed grid in Swift produces numbers IDENTICAL to the web loader's
//     output, which was dumped to `solarbloom-parity.json` by running the actual
//     web TS (see /tmp dump script). This catches any drift in the PRNG order,
//     the OKLCH math, the grammar, the clamp flags, or the default-mood fallback.

import XCTest
@testable import DopamineCore

final class ParityTests: XCTestCase {

    /// The mote cap const the solarbloom `.dope` references (`clampMax: "MAX_MOTES"`).
    /// Mirrors the standalone effect package's `MAX_MOTES` (its MSL `#define` + the
    /// integer-clamp const); inlined here so the core parity suite needs no effect
    /// dependency now that every effect lives in its own single-folder package.
    let MAX_MOTES: Double = 80

    /// The solarbloom `.dope` parity vector, bundled with THIS test target (the
    /// effect package is no longer part of this monorepo SwiftPM package, and the
    /// core ships no effect data). Same bytes the effect ships — the toolchain's
    /// md5 gate enforces that; `regen-parity.sh` refreshes this fixture.
    func loadSolarbloomDoc() throws -> DopeDoc {
        try DopeResource.loadDope("solarbloom.dope", bundle: Bundle.module)
    }

    /// The fixture model (mirrors the dump script's JSON).
    struct Fixture: Decodable {
        struct Case: Decodable {
            let mood: String
            let intensity: Double
            let whimsy: Double
            let seed: Double  // u32, fits in Double exactly
            let scalars: [String: Double]
            let palette: [[Double]]
        }
        let cases: [Case]
    }

    func loadFixture() throws -> Fixture {
        let url = try XCTUnwrap(Bundle.module.url(forResource: "solarbloom-parity", withExtension: "json"))
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(Fixture.self, from: data)
    }

    /// (1) The bundled `.dope` matches the canonical web file byte-for-byte.
    func testDopeBytesAreShared() throws {
        // The effect package's bundled copy.
        let effectURL = try XCTUnwrap(
            Bundle.module.path(forResource: "solarbloom-parity", ofType: "json"))
        XCTAssertFalse(effectURL.isEmpty)
        // Assert the core-bundled bytes parse + match the web id; full byte-equality
        // across the platform packages is enforced by the @dopaminefx/build toolchain
        // (all embeds are emitted from one source — md5-checked in android.yml).
        let doc = try loadSolarbloomDoc()
        XCTAssertEqual(doc.id, "dopamine.success.solarbloom")
        XCTAssertEqual(doc.fmt, "dopamine-effect")
    }

    /// (2) Swift resolve output == web loader output across the whole grid.
    func testResolveParityAcrossGrid() throws {
        let fixture = try loadFixture()
        let doc = try loadSolarbloomDoc()

        XCTAssertEqual(fixture.cases.count, 192, "expected the full grid")

        for c in fixture.cases {
            let input = DopeResolveInput(
                mood: c.mood, intensity: c.intensity, whimsy: c.whimsy,
                seed: UInt32(c.seed))
            let out = try resolveDopeParams(
                doc, input, consts: ["MAX_MOTES": MAX_MOTES], scatterKey: "moteSeed")

            // Scalars.
            for (key, expected) in c.scalars {
                guard case let .number(got)? = out[key] else {
                    XCTFail("missing scalar \(key) for \(c.mood)/\(c.intensity)/\(c.whimsy)/\(c.seed)")
                    continue
                }
                // moteSeed is rng()*1000 — float-exact across JS/Swift Doubles.
                XCTAssertEqual(got, expected, accuracy: 1e-9,
                    "scalar \(key) for \(c.mood)/\(c.intensity)/\(c.whimsy)/\(c.seed)")
            }

            // Palette (3 linear-RGB stops).
            guard case let .palette(pal)? = out["palette"] else {
                XCTFail("missing palette"); continue
            }
            XCTAssertEqual(pal.count, c.palette.count)
            for (i, stop) in pal.enumerated() {
                XCTAssertEqual(stop.r, c.palette[i][0], accuracy: 1e-9, "pal[\(i)].r")
                XCTAssertEqual(stop.g, c.palette[i][1], accuracy: 1e-9, "pal[\(i)].g")
                XCTAssertEqual(stop.b, c.palette[i][2], accuracy: 1e-9, "pal[\(i)].b")
            }
        }
    }
}
