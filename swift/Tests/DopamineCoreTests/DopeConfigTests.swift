// Per-effect `.dope` config contracts — the Swift mirror of the per-effect web
// `dope-config.test.ts` suites.
//
// The five datafied effects (aurora, ripple, inkstroke, halo, fail) drive their
// factory metadata from the `.dope`: `render.consts`, `binding.scatterKey`,
// `render.config.usesOrigin` and `tempo.reducedMotion` (evaluated by the
// portable FrameExpr evaluator the Metal-only `DopePassConfig` is a thin shim
// over). This suite pins that metadata — the effect's expected config — and
// proves the doc-driven `resolveDopeParams(doc, feeling)` equals the explicit
// `consts:`/`scatterKey:` call. Numeric cross-platform parity is gated by the
// 192-case grid in ParityTests.swift; the per-frame evaluator by
// FrameExprTests.swift.
//
// The five CANONICAL `.dope` files are read from the repo via a
// #filePath-relative path (no extra committed copies — there is ONE `.dope`
// per effect). PORTABLE: runs on Linux `swift test` with no Apple SDK.

import Foundation
import XCTest
@testable import DopamineCore

final class DopeConfigTests: XCTestCase {

    // ── Helpers ──

    /// Load a canonical `effects/<name>/<name>.dope.json` from the repo,
    /// #filePath-relative (this file lives at swift/Tests/DopamineCoreTests/).
    private func loadCanonicalDope(_ name: String) throws -> DopeDoc {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()  // DopamineCoreTests
            .deletingLastPathComponent()  // Tests
            .deletingLastPathComponent()  // swift
            .deletingLastPathComponent()  // repo root
            .appendingPathComponent("effects/\(name)/\(name).dope.json")
        return try parseDope(String(contentsOf: url, encoding: .utf8))
    }

    /// The doc-driven resolve (consts + scatterKey from the `.dope`) equals an
    /// explicit-args call, byte-for-byte (DopeValue is Equatable).
    private func assertResolveMatchesExplicitArgs(
        _ doc: DopeDoc, consts: [String: Double], scatterKey: String
    ) throws {
        let feeling = DopeResolveInput(
            mood: doc.baselineOrder[0], intensity: 0.6, whimsy: 0.5, seed: 42)
        XCTAssertEqual(
            try resolveDopeParams(doc, feeling),
            try resolveDopeParams(doc, feeling, consts: consts, scatterKey: scatterKey))
    }

    // ── aurora ──
    func testAuroraDopeConfig() throws {
        let doc = try loadCanonicalDope("aurora")
        XCTAssertEqual(doc.consts, ["MAX_CURTAINS": 7])
        XCTAssertEqual(doc.binding?.scatterKey, "auroraSeed")
        XCTAssertEqual(doc.usesOrigin, false)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 520, holdMs: 520))
        try assertResolveMatchesExplicitArgs(doc, consts: ["MAX_CURTAINS": 7], scatterKey: "auroraSeed")
    }

    // ── ripple ──
    func testRippleDopeConfig() throws {
        let doc = try loadCanonicalDope("ripple")
        XCTAssertEqual(doc.consts, ["MAX_RINGS": 7, "MIN_RINGS": 2])
        XCTAssertEqual(doc.binding?.scatterKey, "rippleSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 280, holdMs: 380))
        try assertResolveMatchesExplicitArgs(
            doc, consts: ["MAX_RINGS": 7, "MIN_RINGS": 2], scatterKey: "rippleSeed")
    }

    // ── inkstroke ──
    func testInkstrokeDopeConfig() throws {
        let doc = try loadCanonicalDope("inkstroke")
        XCTAssertEqual(doc.consts, ["MAX_DROPS": 64])
        XCTAssertEqual(doc.binding?.scatterKey, "inkSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 300, holdMs: 360))
        try assertResolveMatchesExplicitArgs(doc, consts: ["MAX_DROPS": 64], scatterKey: "inkSeed")
    }

    // ── halo (CONTINUOUS: a calm looping ring — peakMs 0, steady hold) ──
    func testHaloDopeConfig() throws {
        let doc = try loadCanonicalDope("halo")
        XCTAssertEqual(doc.consts, [:])
        XCTAssertEqual(doc.binding?.scatterKey, "haloSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 0, holdMs: 600))
        // The first-class continuous-loop contract: 1.5 s period, snap-aligned.
        XCTAssertEqual(doc.loop, DopeLoopSpec(periodMs: 1500, snapAligned: true))
        try assertResolveMatchesExplicitArgs(doc, consts: [:], scatterKey: "haloSeed")
    }

    // ── tempo.loop validation (the seam invariants, enforced at parse) ──

    /// The canonical halo JSON with its loop period swapped, as raw text — the
    /// cheapest way to exercise the parser against an otherwise-valid doc.
    private func haloText(periodMs: String) throws -> String {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().deletingLastPathComponent()
            .appendingPathComponent("effects/halo/halo.dope.json")
        let text = try String(contentsOf: url, encoding: .utf8)
        XCTAssertTrue(text.contains("\"loop\": { \"periodMs\": 1500 }"))
        return text.replacingOccurrences(
            of: "\"loop\": { \"periodMs\": 1500 }",
            with: "\"loop\": { \"periodMs\": \(periodMs) }")
    }

    func testLoopPeriodOffTheOnTwosGridIsRejected() throws {
        // 100 ms is not a whole number of 1000/12 ms steps.
        XCTAssertThrowsError(try parseDope(haloText(periodMs: "100"))) { err in
            XCTAssertTrue("\(err)".contains("animate-on-twos"))
        }
    }

    func testLoopPeriodNotTilingDurationIsRejected() throws {
        // 2250 ms = 27 on-twos steps (grid-aligned), but 6000 / 2250 isn't whole.
        XCTAssertThrowsError(try parseDope(haloText(periodMs: "2250"))) { err in
            XCTAssertTrue("\(err)".contains("whole number of tempo.loop periods"))
        }
    }

    // ── fail (fully declarative: render.pass + the sampler SDF source) ──
    func testFailDopeConfig() throws {
        let doc = try loadCanonicalDope("fail")
        XCTAssertEqual(doc.consts, [:])
        XCTAssertEqual(doc.binding?.scatterKey, "failSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 200, holdMs: 320))
        try assertResolveMatchesExplicitArgs(doc, consts: [:], scatterKey: "failSeed")

        // The sampler's declarative SDF source (outline + on flag).
        XCTAssertEqual(doc.binding?.samplers, [DopeBindingSampler(
            web: "uSdfTex", name: "sdfTex", texture: 1, outline: "cross", on: "sdfOn")])

        // render.pass: the ✗ box/stroke/range per-pass uniforms, by canonical
        // extra name (the keys the generated Metal packer reads), carrying the
        // baked SDF's declared metadata (range 18, viewBox width 100).
        let pass = try XCTUnwrap(doc.renderPass)
        XCTAssertEqual(pass.entries.map { $0.0 }, ["boxPx", "sdfStrokePx", "sdfRangePx"])
        XCTAssertEqual(pass.sdfRange, 18)
        XCTAssertEqual(pass.sdfViewBoxW, 100)
        // Evaluated for a 400 px target min dim (the old packExtras math).
        let values = Dictionary(uniqueKeysWithValues: pass.evaluate(targetMinDimPx: 400, params: [:]))
        XCTAssertEqual(values["boxPx"], 0.15 * 400)
        XCTAssertEqual(values["sdfStrokePx"], 0.15 * 400 * 0.13)
        XCTAssertEqual(values["sdfRangePx"], 18 * ((2 * (0.15 * 400)) / 100))
    }

    // ── lightning (fully declarative + the binding.arrays frameArrays seam) ──
    func testLightningDopeConfig() throws {
        let doc = try loadCanonicalDope("lightning")
        XCTAssertEqual(doc.consts, ["MAX_FORKS": 7])
        XCTAssertEqual(doc.binding?.scatterKey, "boltSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 130, holdMs: 300))
        try assertResolveMatchesExplicitArgs(doc, consts: ["MAX_FORKS": 7], scatterKey: "boltSeed")

        // tempo.frame matches the hand-written tempo it replaced, BIT-identical
        // (the same FrameExpr evaluator the Metal-only DopePassConfig shims over).
        guard let frame = doc.frame else { return XCTFail("lightning has no tempo.frame") }
        let params: [String: DopeValue] = ["overshoot": .number(1.3), "flicker": .number(0.65)]
        for life in [0.0, 0.05, 0.2, 0.45, 0.9, 1.0] {
            let animMs = life * 850
            let ctx = FrameExprCtx(animMs: animMs, life: life, elapsedMs: animMs, params: params)
            // amp — the impact envelope.
            XCTAssertEqual(try evalFrameExpr(frame.amp, ctx), envelope(life, overshoot: 1.3))
            let extras = Dictionary(uniqueKeysWithValues: frame.extras)
            // strike — the 130 ms ease-out-quint crack-in (strikeProgress).
            let x = tempoClamp01(animMs / 130)
            XCTAssertEqual(try evalFrameExpr(try XCTUnwrap(extras["strike"]), ctx), 1 - pow(1 - x, 5))
            // flash — primary exp decay + sin^8 flicker re-pulses (flashStrobe).
            let t = tempoClamp01(life)
            let spike = max(0, sin(t * 6 * Double.pi * 2))
            let flash = exp(-t / 0.035) + pow(spike, 8) * (pow(1 - t, 2.2) * 0.28 * 0.65)
            XCTAssertEqual(try evalFrameExpr(try XCTUnwrap(extras["flash"]), ctx), flash)
        }
    }
}
