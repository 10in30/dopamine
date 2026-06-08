// Portable unit tests — run on Linux (no Apple toolchain). They cover the
// ported math directly: the PRNG, OKLCH, the easing/envelope primitives, the
// mapping grammar, and the loader's default-mood fallback.

import XCTest
@testable import DopamineCore

final class CoreUnitTests: XCTestCase {

    // mulberry32 must match the JS bit-exact. These reference values were dumped
    // from the web `mulberry32` (the same code the parity fixture uses).
    func testMulberry32MatchesJS() throws {
        // seed 42, first three draws (from node: mulberry32(42)()).
        let r = mulberry32(42)
        let a = r(), b = r(), c = r()
        // Computed once from the web engine/seed.ts: mulberry32(42)() ×3.
        XCTAssertEqual(a, 0.6011037519201636, accuracy: 1e-15)
        XCTAssertEqual(b, 0.44829055899754167, accuracy: 1e-15)
        XCTAssertEqual(c, 0.8524657934904099, accuracy: 1e-15)
    }

    func testMulberry32MaxSeedDoesNotCrash() throws {
        // u32 max seed exercises the wrapping arithmetic.
        let r = mulberry32(UInt32.max)
        let v = r()
        XCTAssertTrue(v >= 0 && v < 1)
    }

    func testWrapHue() {
        XCTAssertEqual(wrapHue(-10), 350, accuracy: 1e-9)
        XCTAssertEqual(wrapHue(370), 10, accuracy: 1e-9)
        XCTAssertEqual(wrapHue(360), 0, accuracy: 1e-9)
    }

    func testOKLCHWhiteAndClamp() {
        // L=1, C=0 → white (1,1,1) after the OKLab round trip.
        let white = oklchToLinearSrgb(OKLCH(L: 1, C: 0, h: 0))
        XCTAssertEqual(white.r, 1, accuracy: 1e-6)
        XCTAssertEqual(white.g, 1, accuracy: 1e-6)
        XCTAssertEqual(white.b, 1, accuracy: 1e-6)
        // Out-of-gamut chroma stays clamped to [0,1].
        let hot = oklchToLinearSrgb(OKLCH(L: 0.8, C: 0.4, h: 30))
        for v in [hot.r, hot.g, hot.b] { XCTAssertTrue(v >= 0 && v <= 1) }
    }

    func testTempoPrimitives() {
        XCTAssertEqual(easeOutCubic(0), 0, accuracy: 1e-12)
        XCTAssertEqual(easeOutCubic(1), 1, accuracy: 1e-12)
        XCTAssertEqual(easeOutBack(1), 1, accuracy: 1e-9)       // settles to 1
        XCTAssertGreaterThan(easeOutBack(0.8, overshoot: 1), 1) // overshoots
        XCTAssertEqual(envelope(0), 0)
        XCTAssertEqual(envelope(1), 0)
        XCTAssertGreaterThan(envelope(0.1, overshoot: 1.5), 1)  // peak > 1 in attack
    }

    func testGrammarNodes() throws {
        let ctx = EvalCtx(controls: ["intensity": 0.5, "whimsy": 1],
                          baseline: ["b": 10], consts: ["MAX": 80])
        XCTAssertEqual(try evalExpr(.const(3), ctx), 3)
        XCTAssertEqual(try evalExpr(.control("intensity"), ctx), 0.5)
        XCTAssertEqual(try evalExpr(.baseline("b"), ctx), 10)
        XCTAssertEqual(try evalExpr(.lerp("intensity", 0, 100), ctx), 50)
        XCTAssertEqual(try evalExpr(.mul([.const(2), .const(3), .const(4)]), ctx), 24)
        XCTAssertEqual(try evalExpr(.add([.const(2), .const(3)]), ctx), 5)
        XCTAssertEqual(try evalExpr(.sub([.const(10), .const(3), .const(2)]), ctx), 5)
        XCTAssertEqual(try evalExpr(.floor(.const(2.9)), ctx), 2)
        XCTAssertEqual(try evalExpr(.round(.const(2.4)), ctx), 2)
        XCTAssertEqual(try evalExpr(.round(.const(2.5)), ctx), 3)
        // JS Math.round half-toward-+Inf: round(-0.5) == 0 (NOT -1).
        XCTAssertEqual(try evalExpr(.round(.const(-0.5)), ctx), 0)
        XCTAssertEqual(try evalExpr(.max([.const(1), .const(9), .const(3)]), ctx), 9)
        XCTAssertEqual(try evalExpr(.min([.const(1), .const(9), .const(3)]), ctx), 1)
        XCTAssertEqual(try evalExpr(.mix(.const(0), .const(100), "whimsy"), ctx), 100)
        // control clamps to [0,1].
        let ctx2 = EvalCtx(controls: ["x": 5], baseline: [:], consts: [:])
        XCTAssertEqual(try evalExpr(.control("x"), ctx2), 1)
    }

    func testUnknownBaselineThrows() {
        let ctx = EvalCtx(controls: [:], baseline: [:], consts: [:])
        XCTAssertThrowsError(try evalExpr(.baseline("nope"), ctx))
    }
}
