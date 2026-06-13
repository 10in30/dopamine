// Unit tests for the per-frame expression evaluator (FrameExpr.swift) — the
// Swift mirror of `packages/core/test/frame-expr.test.ts`. Portable: runs on
// Linux with no Apple SDK.

import XCTest
@testable import DopamineCore

final class FrameExprTests: XCTestCase {

    private func expr(_ json: String) throws -> JSONValue { try parseOrderedJSON(json) }

    private func ctx(
        animMs: Double = 250, life: Double = 0.25, elapsedMs: Double = 300,
        params: [String: DopeValue] = ["overshoot": .number(0.7), "scale": .number(0.5)]
    ) -> FrameExprCtx {
        FrameExprCtx(animMs: animMs, life: life, elapsedMs: elapsedMs, params: params)
    }

    func testLiteralsConstsParamsAndInputs() throws {
        XCTAssertEqual(try evalFrameExpr(expr("3.5"), ctx()), 3.5)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"const": -2}"#), ctx()), -2)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"param": "overshoot"}"#), ctx()), 0.7)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"input": "animMs"}"#), ctx()), 250)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"input": "life"}"#), ctx()), 0.25)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"input": "elapsedMs"}"#), ctx()), 300)
    }

    func testLoopClockInputs() throws {
        // Supplied by the caller (the dope-pass frame derivation) for effects
        // with tempo.loop; the calm default is 0, never a throw.
        let looping = FrameExprCtx(
            animMs: 375, life: 0.0625, elapsedMs: 375,
            loopS: 0.375, phase: 0.25, params: [:])
        XCTAssertEqual(try evalFrameExpr(expr(#"{"input": "loopS"}"#), looping), 0.375)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"input": "phase"}"#), looping), 0.25)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"input": "loopS"}"#), ctx()), 0)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"input": "phase"}"#), ctx()), 0)
        // halo's periodic breathe amp peaks at a quarter period.
        let amp = try evalFrameExpr(
            expr(#"{"add": [0.85, {"mul": [0.15, {"sin": {"mul": [6.283185307179586, {"input": "phase"}]}}]}]}"#),
            looping)
        XCTAssertEqual(amp, 1.0, accuracy: 1e-9)
    }

    func testThrowsOnMissingParamUnknownInputAndUnknownNode() throws {
        XCTAssertThrowsError(try evalFrameExpr(expr(#"{"param": "nope"}"#), ctx()))
        // A non-numeric (palette/string) param is missing for the grammar's purposes.
        XCTAssertThrowsError(try evalFrameExpr(
            expr(#"{"param": "palette"}"#), ctx(params: ["palette": .string("x")])))
        XCTAssertThrowsError(try evalFrameExpr(expr(#"{"input": "wat"}"#), ctx()))
        XCTAssertThrowsError(try evalFrameExpr(expr(#"{"frob": 1}"#), ctx()))
    }

    func testArithmeticReduceSemantics() throws {
        XCTAssertEqual(try evalFrameExpr(expr(#"{"add": [1, 2, 3]}"#), ctx()), 6)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"sub": [10, 3, 2]}"#), ctx()), 5)  // left fold
        XCTAssertEqual(try evalFrameExpr(expr(#"{"sub": [1, {"input": "life"}]}"#), ctx()), 0.75)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"mul": [2, 3, 4]}"#), ctx()), 24)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"div": [12, 3, 2]}"#), ctx()), 2)  // left fold
        XCTAssertEqual(try evalFrameExpr(expr(#"{"div": [1, 0]}"#), ctx()), .infinity)  // plain IEEE
        XCTAssertEqual(try evalFrameExpr(expr(#"{"min": [3, 1, 2]}"#), ctx()), 1)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"max": [3, 1, 2]}"#), ctx()), 3)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"pow": [2, 10]}"#), ctx()), 1024)
    }

    func testMathAndTempoPrimitivesMatchTempoSwift() throws {
        XCTAssertEqual(try evalFrameExpr(expr(#"{"sin": 1.2}"#), ctx()), sin(1.2))
        XCTAssertEqual(try evalFrameExpr(expr(#"{"cos": 1.2}"#), ctx()), cos(1.2))
        XCTAssertEqual(try evalFrameExpr(expr(#"{"exp": -0.5}"#), ctx()), exp(-0.5))
        XCTAssertEqual(try evalFrameExpr(expr(#"{"clamp01": 1.7}"#), ctx()), tempoClamp01(1.7))
        XCTAssertEqual(
            try evalFrameExpr(expr(#"{"envelope": [{"input": "life"}, {"param": "overshoot"}]}"#), ctx()),
            envelope(0.25, overshoot: 0.7))
        XCTAssertEqual(try evalFrameExpr(expr(#"{"easeOutCubic": 0.3}"#), ctx()), easeOutCubic(0.3))
        XCTAssertEqual(
            try evalFrameExpr(expr(#"{"easeOutBack": [0.3, 0.7]}"#), ctx()),
            easeOutBack(0.3, overshoot: 0.7))
    }

    func testLtPicksAndLazilyEvaluatesBranches() throws {
        XCTAssertEqual(try evalFrameExpr(expr(#"{"lt": [1, 2, 10, 20]}"#), ctx()), 10)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"lt": [2, 1, 10, 20]}"#), ctx()), 20)
        XCTAssertEqual(try evalFrameExpr(expr(#"{"lt": [1, 1, 10, 20]}"#), ctx()), 20)  // strict <
        // The untaken branch is never evaluated (a missing param there cannot throw).
        XCTAssertEqual(try evalFrameExpr(expr(#"{"lt": [1, 2, 10, {"param": "nope"}]}"#), ctx()), 10)
    }

    func testParamExprIsParamsOnly() throws {
        XCTAssertEqual(
            try evalParamExpr(expr(#"{"mul": [{"param": "scale"}, 0.5]}"#), ["scale": .number(0.8)]),
            0.4)
        XCTAssertEqual(try evalParamExpr(expr("0.42"), [:]), 0.42)
        // {input} throws in a params-only expression.
        XCTAssertThrowsError(try evalParamExpr(expr(#"{"input": "life"}"#), [:]))
        // The pass-geometry inputs are render.pass-only, too.
        XCTAssertThrowsError(try evalParamExpr(expr(#"{"input": "targetMinDimPx"}"#), [:]))
    }

    func testPassExprInputs() throws {
        // The pass-geometry inputs, supplied by the runner once per pass.
        let pass = PassExprInputs(targetMinDimPx: 400, sdfRange: 18, sdfViewBoxW: 100, dpr: 2)
        XCTAssertEqual(try evalPassExpr(expr(#"{"input": "targetMinDimPx"}"#), [:], pass), 400)
        XCTAssertEqual(try evalPassExpr(expr(#"{"input": "sdfRange"}"#), [:], pass), 18)
        XCTAssertEqual(try evalPassExpr(expr(#"{"input": "sdfViewBoxW"}"#), [:], pass), 100)
        // heartburst's halftone cell: dotSize scaled to device px.
        XCTAssertEqual(
            try evalPassExpr(
                expr(#"{"mul": [{"param": "dotSize"}, {"input": "dpr"}]}"#),
                ["dotSize": .number(7.5)], pass),
            15)
        // fail's ✗ box: 0.15 × the target min dim; params address like any mode.
        XCTAssertEqual(
            try evalPassExpr(expr(#"{"mul": [0.15, {"input": "targetMinDimPx"}]}"#), [:], pass),
            0.15 * 400)
        XCTAssertEqual(
            try evalPassExpr(
                expr(#"{"mul": [{"param": "scale"}, {"input": "targetMinDimPx"}]}"#),
                ["scale": .number(0.5)], pass),
            200)
        // fail's SDF range mapping: range * (2*boxPx / viewBoxW).
        XCTAssertEqual(
            try evalPassExpr(
                expr(#"{"mul": [{"input": "sdfRange"}, {"div": [{"mul": [2, {"mul": [0.15, {"input": "targetMinDimPx"}]}]}, {"max": [{"input": "sdfViewBoxW"}, 1e-6]}]}]}"#),
                [:], pass),
            18 * ((2 * (0.15 * 400)) / 100))
    }

    func testPassExprRejectsFrameClocks() throws {
        let pass = PassExprInputs(targetMinDimPx: 400)
        for name in ["animMs", "life", "elapsedMs", "loopS", "phase"] {
            XCTAssertThrowsError(try evalPassExpr(expr(#"{"input": "\#(name)"}"#), [:], pass))
        }
        XCTAssertThrowsError(try evalPassExpr(expr(#"{"input": "wat"}"#), [:], pass))
        // …and the pass inputs are rejected in frame expressions.
        XCTAssertThrowsError(try evalFrameExpr(expr(#"{"input": "targetMinDimPx"}"#), ctx()))
    }
}
