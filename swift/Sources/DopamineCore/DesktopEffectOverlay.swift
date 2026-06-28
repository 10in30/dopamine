// Desktop effect overlay — the macOS "effects bleed past the app window" host.
//
// On a macOS DESKTOP app the nicest-looking way to play a dopamine effect is to
// render it on a surface a little BIGGER than the app window so the glow spills
// past the window's edges onto whatever is behind — but rendering the whole
// screen is too expensive. So this hosts the effect in a borderless, click-through,
// floating NSPanel sized to the tracked window's frame + a margin (default 200pt
// on every side), and applies a RADIAL FADE so the effect dissolves toward the
// panel edges instead of hard-cutting. It follows the window across moves and
// displays, and offers an optional whole-screen mode.
//
// This is the turnkey version of the pattern every desktop consumer was otherwise
// hand-rolling (an oversized transparent NSPanel + a CAGradientLayer mask + a
// display-link tick). An app creates ONE of these pointed at its window, prepares
// an effect host (resolve params → `prepare`), and calls `present`. The per-effect
// host stays app-side (the app imports the effect packages); everything else —
// window, fade, tick, anchor mapping — lives here.
//
// macOS-only, and `@available(macOS 14, *)` because it uses `NSView.displayLink`
// (macOS 14+). The portable DopamineCore floor stays macOS 12 — this type is just
// unavailable below 14; pre-14 hosts drive `MetalOverlayHost.tick` themselves.

#if os(macOS) && canImport(AppKit)
import AppKit
import Metal
import QuartzCore
import simd

/// The slice of `MetalOverlayHost` the desktop overlay drives. Type-erases the
/// per-effect `Config` so different effects share one overlay. `MetalOverlayHost`
/// already exposes every member publicly, so the conformance is empty. (This was
/// duplicated in every desktop consumer — it lives here once now.)
public protocol DopamineEffectHost: AnyObject {
    /// The premultiplied-light Metal layer the overlay attaches + sizes.
    var lightLayer: CAMetalLayer { get }
    /// Slow-motion time scale (1.0 = real time).
    var timeScale: Double { get set }
    /// Start the (already-prepared) effect's clock.
    func play()
    /// Render one frame. `anchorPx`/`targetPx` are in the overlay view's device px.
    func tick(now: CFTimeInterval, dpr: Float, anchorPx: SIMD2<Float>, targetPx: SIMD2<Float>)
    /// Attach `lightLayer` to a host view, oriented for its coordinate space.
    func attach(to view: NSView)
}

extension MetalOverlayHost: DopamineEffectHost {}

/// A floating, click-through macOS overlay window that plays dopamine effects on a
/// surface larger than the tracked app window, with a radial edge fade.
@available(macOS 14.0, *)
@MainActor
public final class DesktopEffectOverlay {
    /// How far the effect surface extends beyond the tracked window on each side
    /// (points). Bigger ⇒ more bleed past the window; the cost scales with area, so
    /// this stays well under full-screen. Default 200 (the perf/look sweet spot).
    public var margin: CGFloat { didSet { if margin != oldValue { reposition() } } }

    /// When true the surface covers the union of all screens instead of
    /// window+margin (the slower, "fills the desktop" mode). Default false.
    public var coversWholeScreen: Bool { didSet { if coversWholeScreen != oldValue { reposition() } } }

    /// Cap on the Retina render scale (these are soft-glow effects; 2× is crisp
    /// without over-sampling a large surface). Default 2.
    public var renderScaleCap: CGFloat = 2.0 { didSet { view.renderScaleCap = renderScaleCap } }

    /// Radial fade: the effect is at full strength out to this fraction of the
    /// surface radius, then dissolves to transparent at the edge. Default 0.55.
    public var fadeInnerFraction: CGFloat = 0.55 { didSet { view.fadeInnerFraction = fadeInnerFraction } }

    /// Extra seconds the tick keeps running past an effect's duration so it fully
    /// fades before the overlay goes idle (zero GPU when idle). Default 0.5.
    public var idleTailSeconds: CFTimeInterval = 0.5 { didSet { view.idleTailSeconds = idleTailSeconds } }

    private weak var tracked: NSWindow?
    private let panel: NSPanel
    private let view: DesktopOverlayContentView
    private var observers: [NSObjectProtocol] = []

    /// Create an overlay tracking `window`. The overlay panel orders front
    /// immediately (it never becomes key/main and never intercepts clicks). Retain
    /// the returned object for as long as you want the overlay alive; call
    /// `close()` to dismiss it.
    public init(tracking window: NSWindow, margin: CGFloat = 200, coversWholeScreen: Bool = false) {
        self.tracked = window
        self.margin = margin
        self.coversWholeScreen = coversWholeScreen
        self.view = DesktopOverlayContentView(frame: NSRect(x: 0, y: 0, width: 100, height: 100))

        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 100, height: 100),
                        styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.ignoresMouseEvents = true                 // never intercept clicks
        panel.level = .screenSaver                       // float above other apps' windows
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary, .ignoresCycle]
        panel.contentView = view

        view.renderScaleCap = renderScaleCap
        view.fadeInnerFraction = fadeInnerFraction
        view.idleTailSeconds = idleTailSeconds

        reposition()
        panel.orderFrontRegardless()                     // show without stealing focus

        // Follow the window as it moves / changes screen / resizes.
        for name in [NSWindow.didMoveNotification, NSWindow.didChangeScreenNotification,
                     NSWindow.didResizeNotification, NSWindow.didEndLiveResizeNotification] {
            let o = NotificationCenter.default.addObserver(forName: name, object: window, queue: .main) { [weak self] _ in
                MainActor.assumeIsolated { self?.reposition() }
            }
            observers.append(o)
        }
    }

    deinit {
        // Thread-safe; the rest of teardown (display link, panel) is `close()`'s job.
        for o in observers { NotificationCenter.default.removeObserver(o) }
    }

    /// Play a PREPARED effect host (the caller already resolved its params and
    /// called `prepare`). `anchorScreen` is a global screen point (AppKit
    /// bottom-left origin) the effect emanates from — e.g. a clicked element's
    /// centre; nil centres it on the surface. `targetSizePt` is the element box the
    /// centrepiece is sized to (`.zero` ⇒ the effect's own default).
    public func present(_ host: DopamineEffectHost, durationMs: Double,
                        anchorScreen: CGPoint? = nil, targetSizePt: CGSize = .zero) {
        reposition()                                     // keep the surface around the window
        let local = anchorScreen.map(screenToLocal)
        view.present(host, durationMs: durationMs, anchorLocal: local, targetSizePt: targetSizePt)
    }

    /// The overlay surface size in DEVICE pixels (window+margin × render scale).
    /// Size an effect host's `lightLayer.drawableSize` to this BEFORE `prepare` so a
    /// hybrid effect's panel texture is built at the surface size, not the window's.
    public var surfaceSizePx: CGSize { view.surfaceSizePx }

    /// Stop rendering and release the overlay window (invalidates the display link
    /// + removes the window observers). Idempotent.
    public func close() {
        view.stop()
        for o in observers { NotificationCenter.default.removeObserver(o) }
        observers.removeAll()
        panel.orderOut(nil)
    }

    // MARK: - Geometry

    private func surfaceFrame() -> CGRect {
        if coversWholeScreen {
            let union = NSScreen.screens.reduce(CGRect.null) { $0.union($1.frame) }
            return union.isNull ? (NSScreen.main?.frame ?? .zero) : union
        }
        let base = tracked?.frame ?? CGRect(x: 0, y: 0, width: 480, height: 320)
        return base.insetBy(dx: -margin, dy: -margin)
    }

    private func reposition() { panel.setFrame(surfaceFrame(), display: true) }

    /// Global screen point (bottom-left origin) → overlay view local (top-left).
    private func screenToLocal(_ p: CGPoint) -> CGPoint {
        let f = panel.frame
        return CGPoint(x: p.x - f.minX, y: f.maxY - p.y)
    }
}

/// The overlay's content view: a flipped, click-through NSView that hosts the
/// current effect's Metal layer behind a radial fade mask and drives the tick.
@available(macOS 14.0, *)
final class DesktopOverlayContentView: NSView {
    var renderScaleCap: CGFloat = 2.0
    var idleTailSeconds: CFTimeInterval = 0.5
    var fadeInnerFraction: CGFloat = 0.55 {
        didSet { fadeMask.locations = [0.0, NSNumber(value: Double(fadeInnerFraction)), 1.0] }
    }

    private let fadeMask = CAGradientLayer()
    private var link: CADisplayLink?
    private var current: DopamineEffectHost?
    private var activeUntil: CFTimeInterval = 0
    private var anchorLocal: CGPoint?
    private var targetSize: CGSize = .zero

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        wantsLayer = true
        layer?.backgroundColor = NSColor.clear.cgColor
        // Radial alpha mask: solid at the centre, fading to transparent at the edge,
        // so the effect dissolves into the surrounding window rather than hard-cutting.
        fadeMask.type = .radial
        fadeMask.colors = [NSColor.white.cgColor, NSColor.white.cgColor, NSColor.clear.cgColor]
        fadeMask.locations = [0.0, 0.55, 1.0]
        fadeMask.startPoint = CGPoint(x: 0.5, y: 0.5)
        fadeMask.endPoint = CGPoint(x: 1.0, y: 1.0)
        layer?.mask = fadeMask
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) unused") }

    /// Top-left origin to match SwiftUI / UIKit anchor coordinates.
    override var isFlipped: Bool { true }
    /// Never intercept clicks — the overlay plays over the live UI beneath.
    override func hitTest(_ point: NSPoint) -> NSView? { nil }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        if window != nil { ensureLink() }
    }

    private func ensureLink() {
        guard link == nil else { return }
        let l = displayLink(target: self, selector: #selector(tick))   // NSView.displayLink (macOS 14+)
        l.preferredFrameRateRange = CAFrameRateRange(minimum: 30, maximum: 60, preferred: 60)
        l.add(to: .main, forMode: .common)
        l.isPaused = true     // idle until the first present
        link = l
    }

    func stop() {
        link?.invalidate()
        link = nil
    }

    private var renderScale: CGFloat { min(window?.backingScaleFactor ?? 2, renderScaleCap) }
    private func canvasPx() -> CGSize {
        CGSize(width: max(bounds.width, 1) * renderScale, height: max(bounds.height, 1) * renderScale)
    }
    /// Surface size in device px (for sizing a host's drawable before prepare).
    var surfaceSizePx: CGSize { canvasPx() }

    func present(_ host: DopamineEffectHost, durationMs: Double, anchorLocal: CGPoint?, targetSizePt: CGSize) {
        self.anchorLocal = anchorLocal
        self.targetSize = targetSizePt
        if current !== host {
            current?.lightLayer.removeFromSuperlayer()
            let l = host.lightLayer
            l.isOpaque = false
            l.contentsScale = renderScale
            l.frame = bounds
            l.drawableSize = canvasPx()
            host.attach(to: self)     // orients the layer for this flipped view
            current = host
        }
        host.play()
        activeUntil = CACurrentMediaTime() + durationMs / 1000.0 + idleTailSeconds
        ensureLink()
        link?.isPaused = false
    }

    override func layout() {
        super.layout()
        CATransaction.begin()
        CATransaction.setDisableActions(true)            // no implicit animation on move/resize
        fadeMask.frame = bounds
        if let l = current?.lightLayer {
            l.frame = bounds
            l.contentsScale = renderScale
            l.drawableSize = canvasPx()
        }
        CATransaction.commit()
    }

    @objc private func tick() {
        let now = CACurrentMediaTime()
        if now > activeUntil {                            // faded out → stop spending GPU
            link?.isPaused = true
            return
        }
        guard let host = current else { return }
        let c = anchorLocal ?? CGPoint(x: bounds.midX, y: bounds.midY)
        host.tick(now: now, dpr: Float(renderScale),
                  anchorPx: SIMD2<Float>(Float(c.x), Float(c.y)),
                  targetPx: SIMD2<Float>(Float(targetSize.width), Float(targetSize.height)))
    }
}
#endif
