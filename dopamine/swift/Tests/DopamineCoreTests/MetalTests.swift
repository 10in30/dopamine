// Metal-only tests — compiled + run ONLY where the Apple toolchain exists
// (macOS CI). On Linux this file is empty, so the portable suite still runs.
//
// These DO NOT render (that needs a GPU + the recorded-frame CI stretch goal);
// they assert the things that are cheap but easy to break in the GLSL→MSL port:
//   - the uniform struct packs/strides sanely (a layout mismatch vs the `.metal`
//     struct is the classic Metal porting bug),
//   - the effect's pass config exposes the expected MSL entry-point names,
//   - the per-frame hook returns a finite envelope amp + check progress.

#if canImport(Metal)
import XCTest
import simd
@testable import DopamineCore
@testable import DopamineEffectSolarbloom

final class MetalTests: XCTestCase {

    func testUniformStructIsTriviallyPackable() {
        // The fragment reads `constant SolarbloomUniforms &u [[buffer(0)]]`; the
        // Swift struct must have a stable, nonzero stride to `setFragmentBytes`.
        let stride = MemoryLayout<SolarbloomUniforms>.stride
        XCTAssertGreaterThan(stride, 0)
        // SIMD3<Float> occupies 16 bytes in MSL too, so the struct should be a
        // multiple of 16 (the alignment of the widest member).
        XCTAssertEqual(stride % 16, 0, "MSL struct alignment must be 16-byte")
    }

    func testConfigEntryPoints() {
        let cfg = SolarbloomConfig()
        XCTAssertEqual(cfg.vertexFunction, "solarbloom_vertex")
        XCTAssertEqual(cfg.fragmentFunction, "solarbloom_fragment")
        XCTAssertTrue(cfg.usesOrigin)
    }

    func testFrameHookProducesFiniteValues() throws {
        let solar = try Solarbloom()
        let params = try solar.resolve(DopeResolveInput(
            mood: "celebratory", intensity: 0.7, whimsy: 0.5, seed: 42))
        let cfg = SolarbloomConfig()
        let (amp, extras) = cfg.frame(FrameInfo(animMs: 120, life: 0.3), params)
        XCTAssertTrue(amp.isFinite)
        XCTAssertNotNil(extras["check"])
        XCTAssertTrue((extras["check"] ?? .nan).isFinite)
        // shadow height = the resolved bloom radius.
        XCTAssertGreaterThan(cfg.shadowHeightFrac(params), 0)
    }
}
#endif
