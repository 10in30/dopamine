// CAMetalLayer overlay host — the Swift mirror of the web `overlay.ts`.
//
// macOS/iOS ONLY. The web library composites onto the page through two stacked
// canvases: a `mix-blend-mode: screen` "light" canvas and a `mix-blend-mode:
// multiply` "shadow" canvas, both pointer-events:none, pinned over the target.
//
// CORE-ANIMATION-vs-CSS-BLEND DIVERGENCE (report (c)): Core Animation has NO
// `screen`/`multiply` LAYER compositing mode (`CALayer.compositingFilter` exists
// only on macOS AppKit, NOT on iOS). So we cannot lean on the OS to blend the
// overlay against arbitrary UIKit content beneath, the way CSS blends against
// the page. Two honest options, documented here for the macOS implementer:
//   1. SELF-CONTAINED overlay: render BOTH the light (screen) and shadow
//      (multiply) passes into ONE offscreen target using the per-PASS Metal
//      blend factors in `MetalPassRunner` (screen = src + dst·(1−src); multiply
//      = src·dst), then present that composited texture in a single
//      `CAMetalLayer`. The blend math is identical to CSS; only the *backdrop*
//      differs (a captured snapshot of the UI, or a transparent target that
//      reads as additive light over a dark host view). This is the recommended
//      path and what the demo app stub assumes.
//   2. On macOS only, set `caMetalLayer.compositingFilter = "screenBlendMode"`
//      to blend against the live backdrop, accepting it is unavailable on iOS.
//
// This host owns the layer(s) + a CADisplayLink-style tick; it is intentionally
// thin and UIKit-light so the bulk of the logic stays in `MetalPassRunner`.

#if canImport(Metal) && canImport(QuartzCore)
import Metal
import QuartzCore
import CoreGraphics
import simd

/// A minimal overlay host: owns a CAMetalLayer for the light pass and (optionally)
/// one for the shadow pass, plus the device/library, and drives a runner.
public final class MetalOverlayHost<Config: PassConfig> {
    public let device: MTLDevice
    private let queue: MTLCommandQueue
    public let lightLayer: CAMetalLayer
    public let shadowLayer: CAMetalLayer?
    private var runner: MetalPassRunner<Config>?
    private var startTime: CFTimeInterval = 0
    private var config: Config
    private let library: MTLLibrary
    private let wantsShadow: Bool

    // --- Frame capture (off by default) ---
    // On a virtualized CI runner `simctl io recordVideo` cannot finalize a video
    // (the AppleM2ScalerCSCDriver hardware is absent), so the demo captures frames
    // IN-APP: each rendered light frame is read back to a CGImage and handed to
    // this sink (the demo writes PNGs the CI then muxes). Reading the drawable
    // requires `framebufferOnly = false`, so this is gated on `wantsCapture`.
    private let wantsCapture: Bool
    public var onLightFrame: ((CGImage) -> Void)?
    private var captureTex: MTLTexture?

    /// `library` is the effect's compiled `default.metallib` (built on macOS).
    /// `wantsCapture` enables per-frame read-back (a small perf cost) for the
    /// in-app recorder; leave false in production overlays.
    public init(config: Config, device: MTLDevice, library: MTLLibrary, wantsShadow: Bool, wantsCapture: Bool = false) throws {
        guard let q = device.makeCommandQueue() else { throw MetalPassError.pipelineFailed("no command queue") }
        self.device = device
        self.queue = q
        self.config = config
        self.library = library
        self.wantsShadow = wantsShadow
        self.wantsCapture = wantsCapture

        lightLayer = CAMetalLayer()
        lightLayer.device = device
        lightLayer.pixelFormat = .bgra8Unorm
        // Capture needs the drawable texture readable as a blit source.
        lightLayer.framebufferOnly = !wantsCapture
        lightLayer.isOpaque = false

        if wantsShadow {
            let sl = CAMetalLayer()
            sl.device = device
            sl.pixelFormat = .bgra8Unorm
            sl.framebufferOnly = true
            sl.isOpaque = false
            shadowLayer = sl
        } else {
            shadowLayer = nil
        }
    }

    /// Begin a fire: resolve params → build the runner. `params` is the loader's
    /// flat bag for one feeling.
    public func play(params: [String: DopeValue]) throws {
        runner = try MetalPassRunner(
            config: config, params: params, device: device, library: library,
            pixelFormat: lightLayer.pixelFormat, wantsShadow: wantsShadow
        )
        startTime = CACurrentMediaTime()
    }

    /// Build a command buffer + render encoder for one layer's next drawable.
    /// Returns nil if no drawable is available this frame (can happen
    /// transiently, especially on a headless simulator) — the caller then
    /// SKIPS the frame instead of force-unwrapping a nil encoder, which would
    /// crash the app.
    private func beginPass(_ layer: CAMetalLayer)
        -> (cb: MTLCommandBuffer, drawable: CAMetalDrawable, enc: MTLRenderCommandEncoder)? {
        guard let drawable = layer.nextDrawable(),
              let cb = queue.makeCommandBuffer() else { return nil }
        let rpd = MTLRenderPassDescriptor()
        rpd.colorAttachments[0].texture = drawable.texture
        rpd.colorAttachments[0].loadAction = .clear
        rpd.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        rpd.colorAttachments[0].storeAction = .store
        guard let enc = cb.makeRenderCommandEncoder(descriptor: rpd) else { return nil }
        return (cb, drawable, enc)
    }

    /// Drive one frame (call from a CADisplayLink / DisplayLink). `dpr` is the
    /// content scale; `anchorPx` the effect origin in points.
    public func tick(now: CFTimeInterval, dpr: Float, anchorPx: SIMD2<Float>) {
        guard let runner else { return }
        let elapsedMs = (now - startTime) * 1000

        // The LIGHT pass is mandatory. If no drawable is available this frame,
        // skip the whole tick rather than crash on a nil encoder.
        guard let light = beginPass(lightLayer) else { return }

        let w = Float(lightLayer.drawableSize.width)
        let h = Float(lightLayer.drawableSize.height)

        // Optional shadow pass into its own drawable / command buffer — keeping
        // the two CSS canvases' separation (see option (1) in the file header).
        let shadow = shadowLayer.flatMap { beginPass($0) }

        // Encode the draw calls FIRST, then end encoding. (Encoding into an
        // already-ended encoder is Metal API misuse and crashes — the draws
        // must happen while the encoder is still open.)
        runner.render(
            elapsedMs: elapsedMs, width: w, height: h, anchorPx: anchorPx, dpr: dpr,
            lightEncoder: light.enc, shadowEncoder: shadow?.enc
        )

        shadow?.enc.endEncoding()
        light.enc.endEncoding()

        // Capture: copy the rendered light texture into a CPU-readable texture
        // (within the same command buffer, before present), then read it back to
        // a CGImage in the completion handler and hand it to the sink.
        if wantsCapture, let sink = onLightFrame {
            let tex = captureTexture(width: light.drawable.texture.width, height: light.drawable.texture.height)
            if let tex, let blit = light.cb.makeBlitCommandEncoder() {
                blit.copy(from: light.drawable.texture, to: tex)
                blit.endEncoding()
                light.cb.addCompletedHandler { _ in
                    if let img = Self.makeCGImage(from: tex) { sink(img) }
                }
            }
        }

        if let shadow { shadow.cb.present(shadow.drawable); shadow.cb.commit() }
        light.cb.present(light.drawable); light.cb.commit()
    }

    /// Lazily (re)allocate the shared-storage capture texture for `width`×`height`.
    private func captureTexture(width: Int, height: Int) -> MTLTexture? {
        if let t = captureTex, t.width == width, t.height == height { return t }
        let d = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .bgra8Unorm, width: width, height: height, mipmapped: false)
        d.storageMode = .shared
        d.usage = [.shaderRead]
        captureTex = device.makeTexture(descriptor: d)
        return captureTex
    }

    /// Read a `.shared` bgra8 texture back into an sRGB CGImage.
    private static func makeCGImage(from tex: MTLTexture) -> CGImage? {
        let w = tex.width, h = tex.height, bpr = w * 4
        var buf = [UInt8](repeating: 0, count: bpr * h)
        buf.withUnsafeMutableBytes {
            tex.getBytes($0.baseAddress!, bytesPerRow: bpr,
                         from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
        }
        let cs = CGColorSpaceCreateDeviceRGB()
        // bgra8 in memory → byteOrder32Little + premultipliedFirst reads as BGRA.
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedFirst.rawValue
                                | CGBitmapInfo.byteOrder32Little.rawValue)
        guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: bpr, space: cs, bitmapInfo: info.rawValue) else { return nil }
        return ctx.makeImage()
    }
}
#endif
