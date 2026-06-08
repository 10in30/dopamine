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
    var effectName: String
    var fireToken: Int
    var mood: String
    var intensity: Double
    var whimsy: Double
    var anchor: CGPoint
    /// Per-effect target boxes (global points). The overlay aims the matching
    /// effect's centrepiece at the box centre, sized to the box.
    var targets: [String: CGRect] = [:]
    /// Called (on the main thread) when playback STARTS (true) and when it ends
    /// and the overlay goes idle (false) — so the host can fade the targeted
    /// element's content out while the effect plays over it, then back in.
    var onActiveChange: (Bool) -> Void = { _ in }

    func makeUIView(context: Context) -> OverlayUIView { OverlayUIView() }

    func updateUIView(_ view: OverlayUIView, context: Context) {
        view.anchorPoint2D = anchor
        view.targets = targets
        view.mood = mood
        view.intensity = intensity
        view.whimsy = whimsy
        view.onActiveChange = onActiveChange
        // Picker selection: make the chosen effect current (does NOT play it; Fire
        // plays). No-op during autoplay or if it's already current.
        view.switchTo(effectName)
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
    var onActiveChange: ((Bool) -> Void)?
    private var reportedActive = false
    var lastFiredToken: Int = 0
    var mood = "celebratory"
    var intensity = 0.8
    var whimsy = 0.4

    // The ordered effect list + autoplay mode are fixed at launch.
    private let effects = EffectRegistry.resolve(Autoplay.requestedEffect)
    private let sequenceMode = (Autoplay.requestedEffect == "all" || Autoplay.requestedEffect == "sequence")
    private let slowmo = Autoplay.slowmoScale
    private var idx = 0

    // MARK: - Performance tuning knobs (device, parity-free)

    /// Cap the render resolution. These are soft glow effects, so rendering at the
    /// full native 3× of a ProMotion phone is wasteful super-sampling; 2× stays
    /// crisp while cutting fragment-shader fill cost ~2.25× on a 3× device (fill
    /// cost scales ~linearly with pixel count).
    static let maxRenderScale: CGFloat = 2.0
    /// Seconds to keep rendering past an effect's life so it fully fades before the
    /// display link is paused (idle ⇒ zero GPU/CPU).
    static let idleTailSeconds: CFTimeInterval = 0.4

    /// Effective render scale = native scale clamped to `maxRenderScale`. Used for
    /// BOTH the layer `drawableSize` AND the `dpr` handed to the host, so the
    /// anchor/target device-px math stays consistent with the (capped) drawable.
    private var renderScale: CGFloat {
        min(window?.screen.scale ?? UIScreen.main.scale, Self.maxRenderScale)
    }
    /// Manual mode only: host-clock time after which the current effect has played
    /// and faded — `tick` pauses the link past this. Pushed forward on each play.
    private var activeUntil: CFTimeInterval = 0

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
        // Cap to 60fps: on a ProMotion device CADisplayLink targets up to 120Hz,
        // doubling GPU cost for no perceptible benefit on these effects.
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        displayLink = link
        // Manual mode starts idle (nothing playing ⇒ nothing to draw); Fire resumes
        // it. Autoplay (CI) renders continuously, so it stays unpaused.
        link.isPaused = (Autoplay.requestedEffect == nil)
        if Autoplay.requestedEffect != nil {
            // Let the layer size + (in CI) the recorder warm up before the first play.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.startAutoplay() }
        }
    }

    private func canvasPx() -> CGSize {
        let scale = renderScale
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
        guard !effects.isEmpty else { return nil }
        return buildAndPrepare(effects[i % effects.count])
    }

    /// Build + prepare a specific effect (same as the index form, by `DemoEffect`).
    private func buildAndPrepare(_ e: DemoEffect) -> Prepared? {
        guard let device else { return nil }
        guard let built = e.build(device) else {
            demoLog.error("[DopamineDemo] failed to build effect=\(e.name, privacy: .public)"); return nil
        }
        built.host.timeScale = slowmo
        let scale = renderScale
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
        l.contentsScale = renderScale
        l.drawableSize = canvasPx()
        layer.addSublayer(l)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        let scale = renderScale
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

    /// Picker selection: make `name` the current effect WITHOUT playing it — the
    /// user taps Fire to play. Ignored during autoplay (CI / simulator) and when
    /// `name` is already current. Builds from the full `EffectRegistry.all`, so
    /// every effect is reachable manually.
    func switchTo(_ name: String) {
        guard Autoplay.requestedEffect == nil else { return }   // don't fight autoplay
        guard current?.name != name else { return }
        guard let e = EffectRegistry.all.first(where: { $0.name == name }),
              let next = buildAndPrepare(e) else {
            demoLog.error("[DopamineDemo] switchTo unknown/failed effect=\(name, privacy: .public)"); return
        }
        current?.host.lightLayer.removeFromSuperlayer()
        current = next
        attach(next)   // prepared + attached, but NOT played — Fire plays it
        demoLog.log("[DopamineDemo] switched to \(next.name, privacy: .public)")
    }

    /// Start (or restart) playback of `p`: start its clock, resume the display link,
    /// and set the idle deadline so `tick` can pause again once it has faded.
    private func beginPlaying(_ p: Prepared) {
        p.host.play()
        activeUntil = CACurrentMediaTime() + dwellSeconds(p.params, gap: Self.idleTailSeconds)
        displayLink?.isPaused = false
        notifyActive(true)
    }

    /// Report play/idle transitions to the host (deferred to the next runloop tick
    /// so we never mutate SwiftUI state inside an `updateUIView` call chain).
    private func notifyActive(_ active: Bool) {
        guard active != reportedActive else { return }
        reportedActive = active
        let cb = onActiveChange
        DispatchQueue.main.async { cb?(active) }
    }

    /// Manual Fire: re-prepare the current effect with a fresh feeling, then play.
    func fireCurrent() {
        guard let cur = current else { return }
        let params = cur.resolve(feeling())
        try? cur.host.prepare(params: params)
        let played = Prepared(name: cur.name, host: cur.host, resolve: cur.resolve, params: params)
        current = played
        beginPlaying(played)
        demoLog.log("[DopamineDemo] fired \(played.name, privacy: .public) slowmo=\(self.slowmo)")
    }

    // MARK: - Autoplay (prepare-ahead)

    private func startAutoplay() {
        guard let cur = current else { return }
        beginPlaying(cur)
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
        beginPlaying(next)
        demoLog.log("[DopamineDemo] fired \(next.name, privacy: .public) slowmo=\(self.slowmo)")
        prefetchNext()
        scheduleAdvance()
    }

    @objc private func tick() {
        let now = CACurrentMediaTime()
        // Idle pause (manual mode only): once the effect has played and faded, stop
        // rendering entirely — the overlay has nothing to show until the next Fire.
        // Autoplay (CI) renders continuously.
        if Autoplay.requestedEffect == nil && now > activeUntil {
            displayLink?.isPaused = true
            notifyActive(false)
            return
        }
        let scale = Float(renderScale)
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
        current?.host.tick(now: now, dpr: scale, anchorPx: pt, targetPx: target)
    }

    /// Map a SwiftUI `.global` (window) point into this view's local coordinates.
    /// Identity when the overlay already sits at the window origin.
    private func localPoint(_ global: CGPoint) -> CGPoint {
        window != nil ? convert(global, from: nil) : global
    }
}
