// SwiftUI bridge to the Metal overlay, generalized to ALL effects — iOS AND macOS.
//
// Wraps a platform view (UIView on iOS, NSView on macOS) that owns the CURRENT
// effect's type-erased `AnyEffectHost` (its light CAMetalLayer) + a CADisplayLink
// tick. The shared `MetalOverlayHost` is already cross-platform (it's behind
// `canImport(Metal) && canImport(QuartzCore)`, both present on macOS); the ONLY
// platform-specific glue is here — the view class, how the display link is
// created, and the backing-scale / layer-attach calls. Drives autoplay itself:
//   • `-autoplay all`        → cycle every EffectRegistry.all effect in sequence
//                              (each plays its full, slow-mo-scaled duration),
//                              which the CI screen recording captures end-to-end.
//   • `-autoplay <name>`     → that one effect, re-fired on a loop.
//   • no autoplay            → first registered effect, fired by the Fire button.
//
// The integration seam the recording captures: SwiftUI state → DopamineCore
// resolve → MetalPassRunner → CAMetalLayer, rendered live on the GPU.

import SwiftUI
import Metal
import QuartzCore
import simd
import os
import DopamineCore

#if os(macOS)
import AppKit
typealias PlatformView = NSView
#else
import UIKit
typealias PlatformView = UIView
#endif

private let demoLog = Logger(subsystem: "ai.polyguard.DopamineDemo", category: "overlay")

/// A SwiftUI representable hosting the Metal overlay. The shared fields + the
/// `configure` body live once; only the protocol conformance (UIKit vs AppKit)
/// differs, so it's split into per-platform extensions below.
struct EffectOverlay {
    var effectName: String
    var fireToken: Int
    var mood: String
    var intensity: Double
    var whimsy: Double
    var anchor: CGPoint
    /// Per-effect target boxes (global points). The overlay aims the matching
    /// effect's centrepiece at the box centre, sized to the box.
    var targets: [String: CGRect] = [:]
    /// Backdrop relative luminance (0 dark .. ~light) the effect composites
    /// against — drives the light-out boost + direct glyph/ink on a light stage.
    var backdropLum: Double = 0
    /// macOS desktop overlay knobs: how far the effect surface extends past the
    /// window (pt), and whether to cover the whole desktop instead.
    var overlayMargin: Double = 200
    var fullScreenEffects: Bool = false
    /// Called (on the main thread) when playback STARTS (true) and when it ends
    /// and the overlay goes idle (false) — so the host can fade the targeted
    /// element's content out while the effect plays over it, then back in.
    var onActiveChange: (Bool) -> Void = { _ in }

    /// Push the current SwiftUI state into the live overlay view (shared by both
    /// the UIKit `updateUIView` and the AppKit `updateNSView` seams).
    func configure(_ view: OverlayView) {
        view.anchorPoint2D = anchor
        view.targets = targets
        view.mood = mood
        view.intensity = intensity
        view.whimsy = whimsy
        view.backdropLum = backdropLum
        #if os(macOS)
        view.overlayMargin = CGFloat(overlayMargin)
        view.fullScreenEffects = fullScreenEffects
        #endif
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

#if os(macOS)
extension EffectOverlay: NSViewRepresentable {
    func makeNSView(context: Context) -> OverlayView { OverlayView(frame: .zero) }
    func updateNSView(_ view: OverlayView, context: Context) { configure(view) }
}
#else
extension EffectOverlay: UIViewRepresentable {
    func makeUIView(context: Context) -> OverlayView { OverlayView(frame: .zero) }
    func updateUIView(_ view: OverlayView, context: Context) { configure(view) }
}
#endif

/// Hosts the current effect's Metal layer + drives the per-frame tick and the
/// autoplay sequence. Builds + prepares each effect (pipeline + panel texture)
/// AHEAD of time — the next effect is prepared during the current one's dwell, so
/// switching is just `play()` (start the clock), with no hitch.
final class OverlayView: PlatformView {
    /// A fully built + prepared effect, ready to `play()` instantly.
    private struct Prepared {
        let name: String
        let host: any AnyEffectHost
        let resolve: (DopeResolveInput) -> [String: DopeValue]
        let params: [String: DopeValue]
    }

    private var device: MTLDevice?
    // Named `vsync` (not `displayLink`) so it never shadows the macOS
    // `NSView.displayLink(target:selector:)` factory method called below.
    private var vsync: CADisplayLink?
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
    /// Backdrop luminance for the light-out boost; updating it re-applies to the
    /// live host so a Light/Dark toggle takes effect on the next frame.
    var backdropLum: Double = 0 { didSet { current?.host.backdropLuminance = backdropLum } }

    #if os(macOS)
    /// The macOS desktop default: effects render on a floating `DesktopEffectOverlay`
    /// LARGER than the window (window + margin) with a radial edge fade, so they
    /// bleed past the window — not hosted in-window. Created once the view has a
    /// window. The overlay owns the display-link tick; this view drives no link.
    private var desktop: DesktopEffectOverlay?
    /// How far the effect surface extends beyond the window on each side (pt).
    var overlayMargin: CGFloat = 200 { didSet { desktop?.margin = overlayMargin } }
    /// Cover the whole desktop instead of window+margin (slower; bleeds everywhere).
    var fullScreenEffects: Bool = false { didSet { desktop?.coversWholeScreen = fullScreenEffects } }
    #endif

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

    /// The window/screen backing scale (Retina factor), platform-abstracted.
    private var backingScale: CGFloat {
        #if os(macOS)
        return window?.backingScaleFactor ?? NSScreen.main?.backingScaleFactor ?? 2
        #else
        return window?.screen.scale ?? UIScreen.main.scale
        #endif
    }

    /// Effective render scale = native scale clamped to `maxRenderScale`. Used for
    /// BOTH the layer `drawableSize` AND the `dpr` handed to the host, so the
    /// anchor/target device-px math stays consistent with the (capped) drawable.
    private var renderScale: CGFloat { min(backingScale, Self.maxRenderScale) }
    /// Manual mode only: host-clock time after which the current effect has played
    /// and faded — `tick` pauses the link past this. Pushed forward on each play.
    private var activeUntil: CFTimeInterval = 0

    override init(frame: CGRect) {
        super.init(frame: frame)
        #if os(macOS)
        // NSView is not layer-backed by default; the overlay composites its Metal
        // layers as sublayers, so it must own a backing layer. A flipped coordinate
        // system (top-left origin, y-down) matches UIKit + SwiftUI's space so the
        // anchor/target math is identical across platforms.
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
        #else
        backgroundColor = .clear
        isUserInteractionEnabled = false
        #endif
        setup()
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unused") }

    #if os(macOS)
    /// macOS only: a top-left origin so SwiftUI `.global` points (which the overlay
    /// receives as anchors/targets) map straight to this view's coordinate space.
    override var isFlipped: Bool { true }
    /// Pointer-transparent: the overlay never intercepts clicks (SwiftUI also wraps
    /// it in `.allowsHitTesting(false)`, but this guards a bare AppKit hit-test).
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    #endif

    private func setup() {
        guard let dev = MTLCreateSystemDefaultDevice() else {
            demoLog.error("[DopamineDemo] no Metal device"); return
        }
        device = dev
        idx = 0
        // iOS: build + prepare the first effect now (CADisplayLink works without a
        // window) and attach its layer. macOS: the effect is hosted by the floating
        // DesktopEffectOverlay, which needs the window + its surface size — so the
        // first build + autoplay are deferred to `viewDidMoveToWindow`.
        #if !os(macOS)
        current = buildAndPrepare(0)
        if let current { attach(current) }
        startDisplayLink()
        if Autoplay.requestedEffect != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.startAutoplay() }
        }
        #endif
    }

    /// Create the per-frame display link and add it to the main run loop. On macOS
    /// the link is vended by the view (`NSView.displayLink`, macOS 14+) and tracks
    /// the screen it's on; on iOS it's constructed directly.
    private func startDisplayLink() {
        guard vsync == nil else { return }
        #if os(macOS)
        let link = displayLink(target: self, selector: #selector(tick))
        #else
        let link = CADisplayLink(target: self, selector: #selector(tick))
        #endif
        // Cap to 60fps: on a ProMotion device CADisplayLink targets up to 120Hz,
        // doubling GPU cost for no perceptible benefit on these effects.
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        link.add(to: .main, forMode: .common)
        vsync = link
        link.isPaused = (Autoplay.requestedEffect == nil)
    }

    #if os(macOS)
    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        // Create the floating desktop overlay tracking this view's window, then build
        // the first effect (sized to the overlay's surface) + kick off autoplay.
        guard let w = window, desktop == nil else { return }
        desktop = DesktopEffectOverlay(tracking: w, margin: overlayMargin, coversWholeScreen: fullScreenEffects)
        idx = 0
        current = buildAndPrepare(0)
        if Autoplay.requestedEffect != nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in self?.startAutoplay() }
        }
    }
    #endif

    private func canvasPx() -> CGSize {
        let scale = renderScale
        var w = bounds.width, h = bounds.height
        if w < 1 || h < 1 {
            #if os(macOS)
            let s = NSScreen.main?.frame.size ?? CGSize(width: 1280, height: 800)
            #else
            let s = UIScreen.main.bounds.size
            #endif
            w = s.width; h = s.height
        }
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
        // Light/dark stage: backdrop luminance drives the light-out boost + direct
        // glyph/ink (dopMarkOut) so effects stay legible on a light surface; 0 keeps
        // the classic dark look. Set before prepare so the first frame is correct.
        built.host.backdropLuminance = backdropLum
        let scale = renderScale
        // macOS: size to the floating overlay SURFACE (window+margin) so a hybrid
        // effect's panel texture is built at the surface size (prepare reads this).
        // iOS: the in-window view bounds.
        #if os(macOS)
        let px = desktop?.surfaceSizePx ?? canvasPx()
        #else
        let px = canvasPx()
        #endif
        built.host.lightLayer.isOpaque = false
        built.host.lightLayer.contentsScale = scale
        built.host.lightLayer.drawableSize = px           // panel is sized from this
        let params = built.resolve(feeling())
        try? built.host.prepare(params: params)           // heavy: pipeline + panel upload
        return Prepared(name: e.name, host: built.host, resolve: built.resolve, params: params)
    }

    /// Attach a prepared effect's layer (sized to the view). `host.attach(to:)` adds
    /// the layer AND orients it for this view's coordinate space — on a flipped NSView
    /// (which this is) it sets `isGeometryFlipped` so the Metal drawable presents
    /// upright. (Don't `addSublayer` the layer directly — see the AGENT NOTE on
    /// `MetalOverlayHost.attach(to:)`.)
    private func attach(_ p: Prepared) {
        #if os(macOS)
        // The DesktopEffectOverlay hosts + sizes the layer on present(); nothing in-window.
        #else
        let l = p.host.lightLayer
        l.frame = bounds
        l.contentsScale = renderScale
        l.drawableSize = canvasPx()
        p.host.attach(to: self)
        #endif
    }

    /// Resize the current effect's layer to the view bounds (shared by the UIKit
    /// `layoutSubviews` and AppKit `layout` hooks). No-op on macOS — the floating
    /// DesktopEffectOverlay owns the layer's layout/sizing.
    private func relayout() {
        #if !os(macOS)
        let scale = renderScale
        if let l = current?.host.lightLayer {
            l.frame = bounds; l.contentsScale = scale
            l.drawableSize = CGSize(width: bounds.width * scale, height: bounds.height * scale)
        }
        #endif
    }

    #if os(macOS)
    override func layout() {
        super.layout()
        relayout()
    }
    #else
    override func layoutSubviews() {
        super.layoutSubviews()
        relayout()
    }
    #endif

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
        notifyActive(true)
        #if os(macOS)
        // Present into the floating desktop overlay (bleeds past the window + radial
        // fade). The overlay owns the tick; it stops itself once the effect fades.
        let (anchorScreen, targetSize) = overlayAnchorTarget(for: p.name)
        let realMs = effectDurationMs(p.params) / Swift.max(0.05, slowmo)   // slow-mo extends real time
        if let host = p.host as? DopamineEffectHost {
            desktop?.present(host, durationMs: realMs, anchorScreen: anchorScreen, targetSizePt: targetSize)
        }
        // The overlay has no idle callback — mirror the dwell to fade the card UI back.
        DispatchQueue.main.asyncAfter(deadline: .now() + realMs / 1000.0 + Self.idleTailSeconds) { [weak self] in
            self?.notifyActive(false)
        }
        #else
        p.host.play()
        activeUntil = CACurrentMediaTime() + dwellSeconds(p.params, gap: Self.idleTailSeconds)
        vsync?.isPaused = false
        #endif
    }

    private func effectDurationMs(_ params: [String: DopeValue]) -> Double {
        if case let .number(v)? = params["durationMs"] { return v }
        return 1800.0
    }

    #if os(macOS)
    /// (anchorScreen, targetSize) for `name`: a registered target chip's centre+size,
    /// else the card anchor — mapped from SwiftUI `.global` (window top-left) to a
    /// global SCREEN point (AppKit bottom-left) the DesktopEffectOverlay expects.
    private func overlayAnchorTarget(for name: String) -> (CGPoint?, CGSize) {
        var size = CGSize.zero
        var g: CGPoint? = (anchorPoint2D == .zero) ? nil : anchorPoint2D
        if let r = targets[name] { g = CGPoint(x: r.midX, y: r.midY); size = r.size }
        guard let p = g, let w = window else { return (nil, size) }
        let h = w.contentView?.bounds.height ?? bounds.height
        let screen = w.convertPoint(toScreen: CGPoint(x: p.x, y: h - p.y))   // top-left → screen BL
        return (screen, size)
    }
    #endif

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
            vsync?.isPaused = true
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
        #if os(macOS)
        // The overlay fills the window (ignoresSafeArea) and shares SwiftUI's
        // top-left global space (the view is `isFlipped`), so global ≈ local —
        // and we avoid AppKit's bottom-left window-coordinate convert flip.
        return global
        #else
        return window != nil ? convert(global, from: nil) : global
        #endif
    }
}
