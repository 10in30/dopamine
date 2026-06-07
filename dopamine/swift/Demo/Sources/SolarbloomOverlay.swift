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
import os
import ImageIO
import CoreGraphics
import UniformTypeIdentifiers
import DopamineCore
import DopamineEffectSolarbloom

// Unified-logging channel. `print()` writes to stdout/stderr, which
// `simctl spawn … log show` does NOT capture; os.Logger lands in the unified
// log so the CI diagnostic can actually read these lines back.
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

/// The UIView that hosts the Metal overlay layers + drives the per-frame tick.
final class OverlayUIView: UIView {
    private var host: MetalOverlayHost<SolarbloomConfig>?
    private var solar: Solarbloom?
    private var displayLink: CADisplayLink?
    var anchorPoint2D: CGPoint = .zero
    var lastFiredToken: Int = 0

    // --- Off-screen frame capture (CI only) ---
    // recordVideo can't finalize a video on a virtualized runner, so when launched
    // for autoplay we render the effect OFF-SCREEN frame-by-frame at synthetic
    // times and write a PNG sequence into Documents/cap. CI pulls it with
    // `simctl get_app_container` and muxes a smooth clip — bypassing both the
    // missing video-encode hardware and the headless layer's blocking nextDrawable.
    private let captureEnabled = Autoplay.requestedEffect != nil
    private let captureQueue = DispatchQueue(label: "ai.polyguard.DopamineDemo.capture")
    // 110 frames at a synthetic 60fps == ~1.83s, covering the celebratory bloom
    // (~1.7s) plus a little afterglow tail.
    private let maxCaptureFrames = 110
    private let captureMaxWidth = 640
    private lazy var captureDir: URL = {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("cap", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }()

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
        host = try? MetalOverlayHost(config: SolarbloomConfig(), device: device, library: library,
                                     wantsShadow: false)
        solar = try? Solarbloom()
        if host == nil { demoLog.error("[DopamineDemo] failed to build overlay host") }

        if let shadow = host?.shadowLayer { layer.addSublayer(shadow) }
        if let light = host?.lightLayer { layer.addSublayer(light) }

        if captureEnabled {
            // CI capture renders OFF-SCREEN on a background queue after fire(); no
            // CADisplayLink (the headless layer's nextDrawable blocks ~1s/frame).
            demoLog.log("[DopamineDemo] off-screen capture ON → \(self.captureDir.path, privacy: .public)")
        } else {
            let link = CADisplayLink(target: self, selector: #selector(tick))
            link.add(to: .main, forMode: .common)
            displayLink = link
        }
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
            mood: mood, intensity: intensity, whimsy: whimsy, seed: randomSeed()))) ?? [:]
        try? host.play(params: params)
        demoLog.log("[DopamineDemo] fired solarbloom mood=\(mood, privacy: .public) intensity=\(intensity) whimsy=\(whimsy)")
        if captureEnabled { startCaptureLoop() }
    }

    @objc private func tick() {
        let scale = Float(window?.screen.scale ?? UIScreen.main.scale)
        let pt = anchorPoint2D == .zero
            ? SIMD2<Float>(Float(bounds.midX), Float(bounds.midY))
            : SIMD2<Float>(Float(anchorPoint2D.x), Float(anchorPoint2D.y))
        host?.tick(now: CACurrentMediaTime(), dpr: scale, anchorPx: pt)
    }

    // MARK: - Capture

    /// Render the effect OFF-SCREEN, frame-by-frame at a synthetic 60fps clock, on
    /// a background queue, writing a PNG sequence + a DONE marker. Sizes/anchor are
    /// read on the main thread (here) and passed by value into the loop.
    private func startCaptureLoop() {
        let scale = window?.screen.scale ?? UIScreen.main.scale
        var w = Int((bounds.width * scale).rounded())
        var h = Int((bounds.height * scale).rounded())
        if w <= 0 || h <= 0 {
            let s = UIScreen.main.bounds.size
            w = Int((s.width * scale).rounded()); h = Int((s.height * scale).rounded())
        }
        let dpr = Float(scale)
        let pt = anchorPoint2D == .zero
            ? SIMD2<Float>(Float(bounds.midX), Float(bounds.midY))
            : SIMD2<Float>(Float(anchorPoint2D.x), Float(anchorPoint2D.y))
        let n = maxCaptureFrames, maxW = captureMaxWidth, dir = captureDir
        captureQueue.async { [weak self] in
            guard let self, let host = self.host else { return }
            for i in 0..<n {
                let ms = Double(i) * (1000.0 / 60.0)
                guard let img = host.renderOffscreen(elapsedMs: ms, width: w, height: h,
                                                     dpr: dpr, anchorPx: pt) else { continue }
                let out = Self.downscale(img, maxWidth: maxW) ?? img
                Self.writePNG(out, to: dir.appendingPathComponent(String(format: "frame_%04d.png", i)))
            }
            FileManager.default.createFile(
                atPath: dir.appendingPathComponent("DONE").path, contents: Data("done".utf8))
            demoLog.log("[DopamineDemo] capture complete: \(n) frames")
        }
    }

    private static func downscale(_ img: CGImage, maxWidth: Int) -> CGImage? {
        let w = img.width, h = img.height
        guard w > maxWidth else { return img }
        let nw = maxWidth
        let nh = max(1, Int((Double(h) * Double(maxWidth) / Double(w)).rounded()))
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedLast.rawValue
        guard let ctx = CGContext(data: nil, width: nw, height: nh, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: cs, bitmapInfo: info) else { return nil }
        ctx.interpolationQuality = .high
        ctx.draw(img, in: CGRect(x: 0, y: 0, width: nw, height: nh))
        return ctx.makeImage()
    }

    private static func writePNG(_ img: CGImage, to url: URL) {
        guard let dst = CGImageDestinationCreateWithURL(
            url as CFURL, UTType.png.identifier as CFString, 1, nil) else { return }
        CGImageDestinationAddImage(dst, img, nil)
        CGImageDestinationFinalize(dst)
    }
}
