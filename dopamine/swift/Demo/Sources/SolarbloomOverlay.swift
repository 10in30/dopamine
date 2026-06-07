// SwiftUI bridge to the Metal overlay. Wraps a UIView that owns a
// `MetalOverlayHost<SolarbloomConfig>` (its light + shadow CAMetalLayers) and a
// CADisplayLink tick. When `fireToken` changes it resolves the current feeling
// through the SHARED `.dope` loader and plays the effect.
//
// This is the integration seam the simulator recording captures: SwiftUI state →
// DopamineCore resolve → MetalPassRunner → CAMetalLayer.

import SwiftUI
import Metal
import simd
import DopamineCore
import DopamineEffectSolarbloom

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

/// The UIView that hosts the Metal overlay layers + drives the per-frame tick.
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
            print("[DopamineDemo] no Metal device")
            return
        }
        // The effect's compiled shaders live in the effect package's resource
        // bundle (SwiftPM compiled Shaders/*.metal → default.metallib).
        guard let library = try? device.makeDefaultLibrary(bundle: SolarbloomResources.bundle) else {
            print("[DopamineDemo] failed to load effect metallib")
            return
        }
        host = try? MetalOverlayHost(config: SolarbloomConfig(), device: device, library: library, wantsShadow: true)
        solar = try? Solarbloom()
        if host == nil { print("[DopamineDemo] failed to build overlay host") }

        if let shadow = host?.shadowLayer { layer.addSublayer(shadow) }
        if let light = host?.lightLayer { layer.addSublayer(light) }

        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = window?.screen.scale ?? UIScreen.main.scale
        let size = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        for l in [host?.lightLayer, host?.shadowLayer].compactMap({ $0 }) {
            l.frame = bounds
            l.contentsScale = scale
            l.drawableSize = size
        }
    }

    func fire(mood: String, intensity: Double, whimsy: Double) {
        guard let host, let solar else { return }
        let params = (try? solar.resolve(DopeResolveInput(
            mood: mood, intensity: intensity, whimsy: whimsy, seed: nil))) ?? [:]
        try? host.play(params: params)
        print("[DopamineDemo] fired solarbloom mood=\(mood) intensity=\(intensity) whimsy=\(whimsy)")
    }

    @objc private func tick() {
        let scale = Float(window?.screen.scale ?? UIScreen.main.scale)
        let pt = anchorPoint2D == .zero
            ? SIMD2<Float>(Float(bounds.midX), Float(bounds.midY))
            : SIMD2<Float>(Float(anchorPoint2D.x), Float(anchorPoint2D.y))
        host?.tick(now: CACurrentMediaTime(), dpr: scale, anchorPx: pt)
    }
}
