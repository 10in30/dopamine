// SwiftUI bridge to the Metal overlay, generalized to ALL effects.
//
// Wraps a UIView that owns the CURRENT effect's type-erased `AnyEffectHost`
// (its light CAMetalLayer) + a CADisplayLink tick. Drives autoplay itself:
//   • `-autoplay all`        → cycle every EffectRegistry.all effect in sequence
//                              (each plays its full, slow-mo-scaled duration),
//                              which the CI screen recording captures end-to-end.
//   • `-autoplay <name>`     → that one effect, re-fired on a loop.
//   • no autoplay            → first registered effect, fired by the Fire button.
//
// The integration seam the recording captures: SwiftUI state → DopamineCore
// resolve → MetalPassRunner → CAMetalLayer, rendered live on the GPU-accelerated
// simulator.

import SwiftUI
import Metal
import simd
import os
import DopamineCore

private let demoLog = Logger(subsystem: "ai.polyguard.DopamineDemo", category: "overlay")

struct EffectOverlay: UIViewRepresentable {
    var fireToken: Int
    var mood: String
    var intensity: Double
    var whimsy: Double
    var anchor: CGPoint

    func makeUIView(context: Context) -> OverlayUIView { OverlayUIView() }

    func updateUIView(_ view: OverlayUIView, context: Context) {
        view.anchorPoint2D = anchor
        view.mood = mood
        view.intensity = intensity
        view.whimsy = whimsy
        // Manual Fire: bump replays the CURRENT effect (not used during autoplay).
        if fireToken != view.lastFiredToken {
            view.lastFiredToken = fireToken
            view.fireCurrent()
        }
    }
}

/// Hosts the current effect's Metal layer + drives the per-frame tick and the
/// autoplay sequence.
final class OverlayUIView: UIView {
    private var device: MTLDevice?
    private var host: (any AnyEffectHost)?
    private var resolveFn: ((DopeResolveInput) -> [String: DopeValue])?
    private var displayLink: CADisplayLink?

    var anchorPoint2D: CGPoint = .zero
    var lastFiredToken: Int = 0
    var mood = "celebratory"
    var intensity = 0.8
    var whimsy = 0.4

    // The ordered effect list + autoplay mode are fixed at launch.
    private let effects = EffectRegistry.resolve(Autoplay.requestedEffect)
    private let sequenceMode = (Autoplay.requestedEffect == "all" || Autoplay.requestedEffect == "sequence")
    private let slowmo = Autoplay.slowmoScale
    private var idx = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        backgroundColor = .clear
        isUserInteractionEnabled = false
        setup()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unused") }

    private func setup() {
        guard let dev = MTLCreateSystemDefaultDevice() else {
            demoLog.error("[DopamineDemo] no Metal device"); return
        }
        device = dev
        loadEffect(0)
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        displayLink = link
        if Autoplay.requestedEffect != nil {
            // Let the layer size + (in CI) the recorder warm up before the first play.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.startAutoplay() }
        }
    }

    /// Swap in effect `i` (modulo the list): tear down the old layer, build the
    /// new effect's host from its own metallib/bundle, add its layer.
    private func loadEffect(_ i: Int) {
        guard let device, !effects.isEmpty else { return }
        host?.lightLayer.removeFromSuperlayer()
        let e = effects[i % effects.count]
        guard let built = e.build(device) else {
            demoLog.error("[DopamineDemo] failed to build effect=\(e.name, privacy: .public)")
            host = nil; resolveFn = nil; return
        }
        host = built.host
        resolveFn = built.resolve
        host?.timeScale = slowmo
        if let l = host?.lightLayer {
            l.isOpaque = false
            layer.addSublayer(l)
            sizeCurrentLayer()
        }
        demoLog.log("[DopamineDemo] loaded effect=\(e.name, privacy: .public)")
    }

    private func sizeCurrentLayer() {
        let scale = window?.screen.scale ?? UIScreen.main.scale
        if let l = host?.lightLayer {
            l.frame = bounds
            l.contentsScale = scale
            l.drawableSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        }
    }
    override func layoutSubviews() { super.layoutSubviews(); sizeCurrentLayer() }

    private func feeling() -> DopeResolveInput {
        DopeResolveInput(mood: mood, intensity: intensity, whimsy: whimsy, seed: randomSeed())
    }

    /// Real-time seconds the current play occupies = (duration / slow-mo) + gap.
    private func dwellSeconds(_ params: [String: DopeValue], gap: Double) -> Double {
        var ms = 1800.0
        if case let .number(v)? = params["durationMs"] { ms = v }
        return ms / 1000.0 / max(0.05, slowmo) + gap
    }

    /// Play the current effect once (also the manual Fire path).
    func fireCurrent() {
        guard let host, let resolveFn else { return }
        let name = effects.isEmpty ? "?" : effects[idx % effects.count].name
        try? host.play(params: resolveFn(feeling()))
        demoLog.log("[DopamineDemo] fired \(name, privacy: .public) slowmo=\(self.slowmo)")
    }

    // MARK: - Autoplay

    private func startAutoplay() {
        guard !effects.isEmpty else { return }
        if sequenceMode { sequenceStep() } else { singleLoop() }
    }

    /// One effect, re-fired on a loop spaced to its slowed duration.
    private func singleLoop() {
        guard let resolveFn else { return }
        let params = resolveFn(feeling())
        try? host?.play(params: params)
        DispatchQueue.main.asyncAfter(deadline: .now() + dwellSeconds(params, gap: 1.0)) { [weak self] in
            self?.singleLoop()
        }
    }

    /// Cycle through every registered effect in order, each playing its full
    /// (slow-mo) duration, then loop back to the first.
    private func sequenceStep() {
        guard let resolveFn else { return }
        let params = resolveFn(feeling())
        try? host?.play(params: params)
        DispatchQueue.main.asyncAfter(deadline: .now() + dwellSeconds(params, gap: 1.2)) { [weak self] in
            guard let self else { return }
            self.idx += 1
            self.loadEffect(self.idx)
            self.sequenceStep()
        }
    }

    @objc private func tick() {
        let scale = Float(window?.screen.scale ?? UIScreen.main.scale)
        let pt = anchorPoint2D == .zero
            ? SIMD2<Float>(Float(bounds.midX), Float(bounds.midY))
            : SIMD2<Float>(Float(anchorPoint2D.x), Float(anchorPoint2D.y))
        host?.tick(now: CACurrentMediaTime(), dpr: scale, anchorPx: pt)
    }
}
