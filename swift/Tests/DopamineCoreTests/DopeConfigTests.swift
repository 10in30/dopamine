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
        try assertResolveMatchesExplicitArgs(doc, consts: [:], scatterKey: "haloSeed")
    }

    // ── fail ──
    func testFailDopeConfig() throws {
        let doc = try loadCanonicalDope("fail")
        XCTAssertEqual(doc.consts, [:])
        XCTAssertEqual(doc.binding?.scatterKey, "failSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 200, holdMs: 320))
        try assertResolveMatchesExplicitArgs(doc, consts: [:], scatterKey: "failSeed")
    }
}
