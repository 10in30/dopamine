// P2 frame-parity gates — the Swift mirror of the per-effect web
// `frame-parity.test.ts` suites.
//
// The per-frame logic hooks (frame() / shadowHeightFrac) of the five datafied
// effects (aurora, ripple, inkstroke, halo, fail) moved from the hand-written
// per-effect Swift configs (+ InkstrokeTempo.swift / FailTempo.swift /
// haloBreathe / SWEEP_SPEED) into each `.dope`'s `tempo.frame` /
// `render.shadowHeightFrac`, evaluated by the portable FrameExpr evaluator
// (which the Metal-only `DopePassConfig` is a thin shim over). This suite pins
// the datafied eval EXACTLY (==) against FROZEN copies of the deleted
// hand-written logic, across a feeling grid × a clock grid — both sides call
// the same Tempo.swift primitives, so equality is bit-exact.
//
// It also pins the datafied factory metadata (`render.consts`,
// `binding.scatterKey`, `render.config.usesOrigin`, `tempo.reducedMotion`)
// against the old hand-written literals, and proves the doc-driven
// `resolveDopeParams(doc, feeling)` equals the old explicit
// `consts:`/`scatterKey:` call.
//
// The five CANONICAL `.dope` files are read from the repo via a
// #filePath-relative path (no extra committed copies — there is ONE `.dope`
// per effect). PORTABLE: runs on Linux `swift test` with no Apple SDK.
//
// NOTE the cross-platform alignment pinned here: fail's stamp/shake run on the
// REAL un-stepped clock (`elapsedMs`) — what this Swift port always did; the
// web aligned to it in P2.

import Foundation
import XCTest
@testable import DopamineCore

final class FrameParityTests: XCTestCase {

    // ── Grid (mirrors the web frame-parity suites) ──
    private let intensities: [Double] = [0.15, 0.6, 0.95]
    private let whimsies: [Double] = [0, 0.5, 1]
    private let seeds: [UInt32] = [1, 42]
    private let lives: [Double] = [0, 0.01, 0.049, 0.05, 0.1, 0.18, 0.3, 0.549, 0.55, 0.7, 0.9, 0.999, 1]

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

    private func num(_ params: [String: DopeValue], _ key: String) -> Double {
        if case let .number(v)? = params[key] { return v }
        XCTFail("missing numeric param \(key)")
        return 0
    }

    /// Evaluate the datafied `tempo.frame` exactly as `DopePassConfig.frame`
    /// does (that type is Metal-guarded; the eval itself is portable).
    private func evalFrame(
        _ doc: DopeDoc, animMs: Double, life: Double, elapsedMs: Double,
        params: [String: DopeValue]
    ) throws -> (amp: Double, extras: [String: Double]) {
        let frame = try XCTUnwrap(doc.frame, "\(doc.id) has no tempo.frame")
        let ctx = FrameExprCtx(animMs: animMs, life: life, elapsedMs: elapsedMs, params: params)
        var extras: [String: Double] = [:]
        for (name, expr) in frame.extras {
            extras[name] = try evalFrameExpr(expr, ctx)
        }
        return (try evalFrameExpr(frame.amp, ctx), extras)
    }

    /// Walk the full feeling × clock grid for one effect, handing each resolved
    /// bag + clock point to the per-effect assertion closure.
    private func forEachGridPoint(
        _ doc: DopeDoc,
        _ body: (_ p: [String: DopeValue], _ animMs: Double, _ life: Double, _ elapsedMs: Double) throws -> Void
    ) throws {
        XCTAssertGreaterThanOrEqual(doc.baselineOrder.count, 3, "\(doc.id): want ≥3 moods")
        for mood in doc.baselineOrder {
            for intensity in intensities {
                for whimsy in whimsies {
                    for seed in seeds {
                        let p = try resolveDopeParams(doc, DopeResolveInput(
                            mood: mood, intensity: intensity, whimsy: whimsy, seed: seed))
                        let durationMs = num(p, "durationMs")
                        for life in lives {
                            let animMs = life * durationMs
                            // Exercise elapsedMs ≠ animMs too (fail's stamp/shake
                            // read the un-stepped clock).
                            for elapsedMs in [animMs, animMs / 0.7] {
                                try body(p, animMs, life, elapsedMs)
                            }
                        }
                    }
                }
            }
        }
    }

    /// The doc-driven resolve (consts + scatterKey from the `.dope`) equals the
    /// old explicit-literals call, byte-for-byte (DopeValue is Equatable).
    private func assertResolveMatchesLegacyCall(
        _ doc: DopeDoc, consts: [String: Double], scatterKey: String
    ) throws {
        let feeling = DopeResolveInput(
            mood: doc.baselineOrder[0], intensity: 0.6, whimsy: 0.5, seed: 42)
        XCTAssertEqual(
            try resolveDopeParams(doc, feeling),
            try resolveDopeParams(doc, feeling, consts: consts, scatterKey: scatterKey))
    }

    // ════════════════════════════════════════════════════════════════════════
    // FROZEN pre-P2 oracles — copied VERBATIM from the deleted hand-written
    // Swift hooks (AuroraConfig / RippleConfig / InkstrokeConfig + InkstrokeTempo
    // / HaloConfig + haloBreathe / FailConfig + FailTempo). Do not "fix" these:
    // they are the contract the datafied `.dope` must reproduce bit-exactly.
    // ════════════════════════════════════════════════════════════════════════

    // aurora (AuroraConfig + SWEEP_SPEED)
    private let SWEEP_SPEED: Double = 0.02

    // inkstroke (InkstrokeTempo.swift)
    private let STROKE_DRAW_MS: Double = 360
    private func oracleStrokeProgress(_ elapsedMs: Double) -> Double {
        easeOutCubic(elapsedMs / STROKE_DRAW_MS)
    }

    // halo (haloBreathe, Halo.swift)
    private func oracleHaloBreathe(_ timeS: Double, period periodS: Double) -> Double {
        let ph = (2.0 * Double.pi * timeS) / max(periodS, 1e-3)
        return 0.85 + 0.15 * sin(ph)
    }

    // fail (FailTempo.swift)
    private let FAIL_STAMP_MS: Double = 170
    private let FAIL_SHAKE_MS: Double = 300
    private func oracleStampProgress(_ elapsedMs: Double) -> Double {
        let x = tempoClamp01(elapsedMs / FAIL_STAMP_MS)
        return 1 - pow(1 - x, 5)
    }
    private func oracleFailEnvelope(_ life: Double) -> Double {
        let t = tempoClamp01(life)
        if t < 0.05 { return easeOutCubic(t / 0.05) }
        if t < 0.55 { return 1 }
        let fade = tempoClamp01(1 - (t - 0.55) / 0.45)
        return pow(fade, 1.7)
    }
    private func oracleShakeOffset(_ elapsedMs: Double, amount: Double = 1) -> Double {
        if elapsedMs <= 0 { return 0 }
        let decay = exp(-elapsedMs / (FAIL_SHAKE_MS * 0.35))
        let osc = sin((elapsedMs / FAIL_SHAKE_MS) * Double.pi * 7.0)
        return osc * decay * amount
    }

    // ── aurora ──
    func testAuroraFrameParity() throws {
        let doc = try loadCanonicalDope("aurora")

        // Datafied factory metadata == the old hand-written literals.
        XCTAssertEqual(doc.consts, ["MAX_CURTAINS": 7])
        XCTAssertEqual(doc.binding?.scatterKey, "auroraSeed")
        XCTAssertEqual(doc.usesOrigin, false)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 520, holdMs: 520))
        try assertResolveMatchesLegacyCall(doc, consts: ["MAX_CURTAINS": 7], scatterKey: "auroraSeed")

        let shadowSpec = try XCTUnwrap(doc.shadowHeightFrac)
        try forEachGridPoint(doc) { p, animMs, life, elapsedMs in
            // Frozen AuroraConfig.shadowHeightFrac: bandHeight * 0.6.
            XCTAssertEqual(try evalParamExpr(shadowSpec, p), self.num(p, "bandHeight") * 0.6)
            let got = try self.evalFrame(doc, animMs: animMs, life: life, elapsedMs: elapsedMs, params: p)
            // Frozen AuroraConfig.frame: envelope amp + accumulated sideways sweep.
            XCTAssertEqual(got.amp, envelope(life, overshoot: self.num(p, "overshoot")))
            XCTAssertEqual(got.extras, ["sweep": self.SWEEP_SPEED * (animMs / 1000.0) * (1.0 - 0.5 * life)])
        }
    }

    // ── ripple ──
    func testRippleFrameParity() throws {
        let doc = try loadCanonicalDope("ripple")

        XCTAssertEqual(doc.consts, ["MAX_RINGS": 7, "MIN_RINGS": 2])
        XCTAssertEqual(doc.binding?.scatterKey, "rippleSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 280, holdMs: 380))
        try assertResolveMatchesLegacyCall(
            doc, consts: ["MAX_RINGS": 7, "MIN_RINGS": 2], scatterKey: "rippleSeed")

        let shadowSpec = try XCTUnwrap(doc.shadowHeightFrac)
        try forEachGridPoint(doc) { p, animMs, life, elapsedMs in
            // Frozen RippleConfig.shadowHeightFrac: min(wavelength·rings·0.6 + amplitude·0.3, 1).
            XCTAssertEqual(
                try evalParamExpr(shadowSpec, p),
                min(self.num(p, "wavelength") * self.num(p, "rings") * 0.6 + self.num(p, "amplitude") * 0.3, 1))
            let got = try self.evalFrame(doc, animMs: animMs, life: life, elapsedMs: elapsedMs, params: p)
            // Frozen RippleConfig.frame: envelope amp, no extras.
            XCTAssertEqual(got.amp, envelope(life, overshoot: self.num(p, "overshoot")))
            XCTAssertEqual(got.extras, [:])
        }
    }

    // ── inkstroke ──
    func testInkstrokeFrameParity() throws {
        let doc = try loadCanonicalDope("inkstroke")

        XCTAssertEqual(doc.consts, ["MAX_DROPS": 64])
        XCTAssertEqual(doc.binding?.scatterKey, "inkSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 300, holdMs: 360))
        try assertResolveMatchesLegacyCall(doc, consts: ["MAX_DROPS": 64], scatterKey: "inkSeed")

        let shadowSpec = try XCTUnwrap(doc.shadowHeightFrac)
        try forEachGridPoint(doc) { p, animMs, life, elapsedMs in
            // Frozen InkstrokeConfig.shadowHeightFrac: scale * 0.5.
            XCTAssertEqual(try evalParamExpr(shadowSpec, p), self.num(p, "scale") * 0.5)
            let got = try self.evalFrame(doc, animMs: animMs, life: life, elapsedMs: elapsedMs, params: p)
            // Frozen InkstrokeConfig.frame: envelope amp + strokeProgress(animMs)
            // (the stroke shares the on-twos clock — NOT elapsedMs).
            XCTAssertEqual(got.amp, envelope(life, overshoot: self.num(p, "overshoot")))
            XCTAssertEqual(got.extras, ["draw": self.oracleStrokeProgress(animMs)])
        }
    }

    // ── halo (CONTINUOUS: periodic breathe, not an envelope) ──
    func testHaloFrameParity() throws {
        let doc = try loadCanonicalDope("halo")

        XCTAssertEqual(doc.consts, [:])
        XCTAssertEqual(doc.binding?.scatterKey, "haloSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 0, holdMs: 600))
        try assertResolveMatchesLegacyCall(doc, consts: [:], scatterKey: "haloSeed")

        let shadowSpec = try XCTUnwrap(doc.shadowHeightFrac)
        try forEachGridPoint(doc) { p, animMs, life, elapsedMs in
            // Frozen HaloConfig.shadowHeightFrac: min(ringRadius + ringWidth·2, 1).
            XCTAssertEqual(
                try evalParamExpr(shadowSpec, p),
                min(self.num(p, "ringRadius") + self.num(p, "ringWidth") * 2, 1))
            let got = try self.evalFrame(doc, animMs: animMs, life: life, elapsedMs: elapsedMs, params: p)
            // Frozen HaloConfig.frame: the STEADY periodic haloBreathe gate
            // (periodic in animMs — halo's continuous-loop contract — NOT an
            // envelope of life).
            XCTAssertEqual(got.amp, self.oracleHaloBreathe(animMs / 1000, period: self.num(p, "period")))
            XCTAssertEqual(got.extras, [:])
        }
    }

    // ── fail (stamp/shake on the REAL un-stepped elapsedMs) ──
    func testFailFrameParity() throws {
        let doc = try loadCanonicalDope("fail")

        XCTAssertEqual(doc.consts, [:])
        XCTAssertEqual(doc.binding?.scatterKey, "failSeed")
        XCTAssertEqual(doc.usesOrigin, true)
        XCTAssertEqual(doc.reducedMotion, DopeReducedMotion(peakMs: 200, holdMs: 320))
        try assertResolveMatchesLegacyCall(doc, consts: [:], scatterKey: "failSeed")

        // Frozen FailConfig.shadowHeightFrac: the bare number 0.42.
        XCTAssertEqual(try evalParamExpr(XCTUnwrap(doc.shadowHeightFrac), [:]), 0.42)

        try forEachGridPoint(doc) { p, animMs, life, elapsedMs in
            let got = try self.evalFrame(doc, animMs: animMs, life: life, elapsedMs: elapsedMs, params: p)
            // Frozen FailConfig.frame: failEnvelope amp + stamp/shake on elapsedMs.
            XCTAssertEqual(got.amp, self.oracleFailEnvelope(life))
            XCTAssertEqual(got.extras, [
                "stamp": self.oracleStampProgress(elapsedMs),
                "shake": self.oracleShakeOffset(elapsedMs, amount: self.num(p, "shakeAmount")),
            ])
        }
    }
}
