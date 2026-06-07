// SwiftUI bridge to the Metal overlay. Wraps a UIView that owns a
// `MetalOverlayHost<SolarbloomConfig>` (its light CAMetalLayer) and a
// CADisplayLink tick. When `fireToken` changes it resolves the current feeling
// through the SHARED `.dope` loader and plays the effect.
//
// This is the integration seam the simulator recording captures: SwiftUI state →
// DopamineCore resolve → MetalPassRunner → CAMetalLayer, rendered live on-screen
// (the CI records the real composited screen via the GPU-accelerated simulator).

import SwiftUI
import Metal
import simd
import os
import DopamineCore
import DopamineEffectSolarbloom

// Unified-logging channel. `print()` writes to stdout/stderr, which
// `simctl spawn … log show` does NOT capture; os.Logger lands in the unified
// log so the CI diagnostic can read these lines back.
private let demoLog = Logger(subsystem: "ai.polyguard.DopamineDemo", category: "overlay")

struct SolarbloomOverlay: UIViewRepresentable {
    var fireToken: Int
    var mood: String
    var intensity: Double
    var whimsy: Double
    var anchor: CGPoint

    func makeUIView(context: Context) -> OverlayUIView {
        OverlayUIView()
    }

    func updateUIView(_ view: OverlayUIView, context: Context) {
        view.anchorPoint2D = anchor
        // Fire only when the token advances (not on every state tweak).
        if fireToken != view.lastFiredToken {
            view.lastFiredToken = fireToken
            view.fire(mood: mood, intensity: intensity, whimsy: whimsy)
        }
    }
}

/// The UIView that hosts the Metal overlay layer + drives the per-frame tick.
final class OverlayUIView: UIView {
    private var host: MetalOverlayHost<SolarbloomConfig>?
    private var solar: Solarbloom?
    private var displayLink: CADisplayLink?
    var anchorPoint2D: CGPoint = .zero
    var lastFiredToken: Int = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isUserInteractionEnabled = false
        setup()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) unused") }

    private func setup() {
        guard let device = MTLCreateSystemDefaultDevice() else {
            demoLog.error("[DopamineDemo] no Metal device")
            return
        }
        // The effect's compiled shaders live in the effect package's resource
        // bundle (SwiftPM compiled Shaders/*.metal → default.metallib).
        guard let library = try? device.makeDefaultLibrary(bundle: SolarbloomResources.bundle) else {
            demoLog.error("[DopamineDemo] failed to load effect metallib")
            return
        }
        demoLog.log("[DopamineDemo] Metal device=\(device.name, privacy: .public) library loaded")
        // Light pass only. The shadow pass is a SECOND full-screen CAMetalLayer,
        // and Core Animation has no layer-level `multiply` blend (see
        // MetalOverlayHost header) — stacked under a now-translucent light layer
        // it would composite as an opaque sheet over the UI. The headline is the
        // light bloom cast over the card; the shadow cast is deferred until the
        // two passes are composited into one target.
        host = try? MetalOverlayHost(config: SolarbloomConfig(), device: device, library: library, wantsShadow: false)
        solar = try? Solarbloom()
        if host == nil { demoLog.error("[DopamineDemo] failed to build overlay host") }

        if let light = host?.lightLayer { layer.addSublayer(light) }

        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = window?.screen.scale ?? UIScreen.main.scale
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        if let l = host?.lightLayer {
            l.frame = bounds
            l.contentsScale = scale
            l.drawableSize = size
        }
    }

    func fire(mood: String, intensity: Double, whimsy: Double) {
        guard let host, let solar else { return }
        let params = (try? solar.resolve(DopeResolveInput(
            mood: mood, intensity: intensity, whimsy: whimsy, seed: randomSeed()))) ?? [:]
        try? host.play(params: params)
        demoLog.log("[DopamineDemo] fired solarbloom mood=\(mood, privacy: .public) intensity=\(intensity) whimsy=\(whimsy)")
    }

    @objc private func tick() {
        let scale = Float(window?.screen.scale ?? UIScreen.main.scale)
        let pt = anchorPoint2D == .zero
            ? SIMD2<Float>(Float(bounds.midX), Float(bounds.midY))
            : SIMD2<Float>(Float(anchorPoint2D.x), Float(anchorPoint2D.y))
        host?.tick(now: CACurrentMediaTime(), dpr: scale, anchorPx: pt)
    }
}
