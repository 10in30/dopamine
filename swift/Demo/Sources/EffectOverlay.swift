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
    /// Per-effect target boxes (global points). The overlay aims the matching
    /// effect's centrepiece at the box centre, sized to the box.
    var targets: [String: CGRect] = [:]

    func makeUIView(context: Context) -> OverlayUIView { OverlayUIView() }

    func updateUIView(_ view: OverlayUIView, context: Context) {
        view.anchorPoint2D = anchor
        view.targets = targets
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
/// autoplay sequence. Builds + prepares each effect (pipeline + panel texture)
/// AHEAD of time — the next effect is prepared during the current one's dwell, so
/// switching is just `play()` (start the clock), with no hitch.
final class OverlayUIView: UIView {
    /// A fully built + prepared effect, ready to `play()` instantly.
    private struct Prepared {
        let name: String
        let host: any AnyEffectHost
        let resolve: (DopeResolveInput) -> [String: DopeValue]
        let params: [String: DopeValue]
    }

    private var device: MTLDevice?
    private var displayLink: CADisplayLink?
    private var current: Prepared?    // attached + (once started) playing
    private var pending: Prepared?    // prebuilt next, layer not yet attached
    private var pendingIdx = 0

    var anchorPoint2D: CGPoint = .zero
    var targets: [String: CGRect] = [:]
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
        // Build + prepare the first effect now (so the very first play is instant)
        // and attach its layer. Don't start its clock until autoplay/Fire.
        idx = 0
        current = buildAndPrepare(0)
        if let current { attach(current) }
        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        displayLink = link
        if Autoplay.requestedEffect != nil {
            // Let the layer size + (in CI) the recorder warm up before the first play.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.startAutoplay() }
        }
    }

    private func canvasPx() -> CGSize {
        let scale = window?.screen.scale ?? UIScreen.main.scale
        var w = bounds.width, h = bounds.height
        if w < 1 || h < 1 { let s = UIScreen.main.bounds.size; w = s.width; h = s.height }
        return CGSize(width: w * scale, height: h * scale)
    }

    private func feeling() -> DopeResolveInput {
        DopeResolveInput(mood: mood, intensity: intensity, whimsy: whimsy, seed: randomSeed())
    }

    /// Build effect `i`'s host from its own metallib/bundle, size its layer, then
    /// do the heavy `prepare` (pipeline compile + panel texture). The layer is NOT
    /// attached and the clock is NOT started — that's `attach` + `play()`.
    private func buildAndPrepare(_ i: Int) -> Prepared? {
        guard let device, !effects.isEmpty else { return nil }
        let e = effects[i % effects.count]
        guard let built = e.build(device) else {
            demoLog.error("[DopamineDemo] failed to build effect=\(e.name, privacy: .public)"); return nil
        }
        built.host.timeScale = slowmo
        let scale = window?.screen.scale ?? UIScreen.main.scale
        let px = canvasPx()
        built.host.lightLayer.isOpaque = false
        built.host.lightLayer.contentsScale = scale
        built.host.lightLayer.drawableSize = px           // panel is sized from this
        let params = built.resolve(feeling())
        try? built.host.prepare(params: params)           // heavy: pipeline + panel upload
        return Prepared(name: e.name, host: built.host, resolve: built.resolve, params: params)
    }

    /// Attach a prepared effect's layer (sized to the view).
    private func attach(_ p: Prepared) {
        let l = p.host.lightLayer
        l.frame = bounds
        l.contentsScale = window?.screen.scale ?? UIScreen.main.scale
        l.drawableSize = canvasPx()
        layer.addSublayer(l)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = window?.screen.scale ?? UIScreen.main.scale
        if let l = current?.host.lightLayer {
            l.frame = bounds; l.contentsScale = scale
            l.drawableSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        }
    }

    /// Real-time seconds a play occupies = (duration / slow-mo) + gap.
    private func dwellSeconds(_ params: [String: DopeValue], gap: Double) -> Double {
        var ms = 1800.0
        if case let .number(v)? = params["durationMs"] { ms = v }
        return ms / 1000.0 / max(0.05, slowmo) + gap
    }

    /// Manual Fire: re-prepare the current effect with a fresh feeling, then play.
    func fireCurrent() {
        guard let cur = current else { return }
        let params = cur.resolve(feeling())
        try? cur.host.prepare(params: params)
        current = Prepared(name: cur.name, host: cur.host, resolve: cur.resolve, params: params)
        cur.host.play()
        demoLog.log("[DopamineDemo] fired \(cur.name, privacy: .public) slowmo=\(self.slowmo)")
    }

    // MARK: - Autoplay (prepare-ahead)

    private func startAutoplay() {
        guard let cur = current else { return }
        cur.host.play()
        demoLog.log("[DopamineDemo] fired \(cur.name, privacy: .public) slowmo=\(self.slowmo)")
        prefetchNext()
        scheduleAdvance()
    }

    /// Build + prepare the NEXT effect now, during the current one's dwell.
    private func prefetchNext() {
        pendingIdx = sequenceMode ? (idx + 1) % max(effects.count, 1) : idx
        pending = buildAndPrepare(pendingIdx)
    }

    private func scheduleAdvance() {
        guard let cur = current else { return }
        let gap = sequenceMode ? 1.2 : 1.0
        DispatchQueue.main.asyncAfter(deadline: .now() + dwellSeconds(cur.params, gap: gap)) { [weak self] in
            self?.advance()
        }
    }

    /// Swap to the prepared next effect (instant: just attach + start clock).
    private func advance() {
        guard let next = pending ?? buildAndPrepare(sequenceMode ? (idx + 1) % max(effects.count, 1) : idx) else { return }
        current?.host.lightLayer.removeFromSuperlayer()
        idx = pendingIdx
        current = next
        pending = nil
        attach(next)
        next.host.play()
        demoLog.log("[DopamineDemo] fired \(next.name, privacy: .public) slowmo=\(self.slowmo)")
        prefetchNext()
        scheduleAdvance()
    }

    @objc private func tick() {
        let scale = Float(window?.screen.scale ?? UIScreen.main.scale)
        // Resolve the anchor: a registered target box (centre + size) for the
        // current effect, else the card anchor, else the view centre.
        // anchorPoint2D and the target rects are in SwiftUI `.global` (window)
        // coords — convert them into THIS view's local space so the Metal layer
        // (sized to our bounds) lines up with the on-screen elements. Without this,
        // a non-zero overlay origin in the window shifts EVERY effect by a constant.
        var pt: SIMD2<Float>
        var target = SIMD2<Float>(0, 0)
        if let name = current?.name, let r = targets[name] {
            let c = localPoint(CGPoint(x: r.midX, y: r.midY))
            pt = SIMD2<Float>(Float(c.x), Float(c.y))
            target = SIMD2<Float>(Float(r.width), Float(r.height))
        } else if anchorPoint2D != .zero {
            let c = localPoint(anchorPoint2D)
            pt = SIMD2<Float>(Float(c.x), Float(c.y))
        } else {
            pt = SIMD2<Float>(Float(bounds.midX), Float(bounds.midY))  // already local
        }
        current?.host.tick(now: CACurrentMediaTime(), dpr: scale, anchorPx: pt, targetPx: target)
    }

    /// Map a SwiftUI `.global` (window) point into this view's local coordinates.
    /// Identity when the overlay already sits at the window origin.
    private func localPoint(_ global: CGPoint) -> CGPoint {
        window != nil ? convert(global, from: nil) : global
    }
}
