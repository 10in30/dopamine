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

    /// Slow-motion time scale (1.0 = real time). The per-frame tick advances the
    /// effect clock by `realElapsed * timeScale`, so 0.25 plays it at quarter
    /// speed — used so a low-fps screen recording can sample the motion smoothly.
    public var timeScale: Double = 1.0

    /// Optional offscreen "panel" texture for HYBRID effects (comic word,
    /// heartburst hearts) — the analog of the web's Canvas2D panel the shader
    /// samples. Set it once per fire with `setPanel(_:)`; it's bound at fragment
    /// texture(0) every frame until cleared. nil for pure-shader effects.
    private var panelTex: MTLTexture?

    /// `library` is the effect's compiled `default.metallib` (built on macOS).
    public init(config: Config, device: MTLDevice, library: MTLLibrary, wantsShadow: Bool) throws {
        guard let q = device.makeCommandQueue() else { throw MetalPassError.pipelineFailed("no command queue") }
        self.device = device
        self.queue = q
        self.config = config
        self.library = library
        self.wantsShadow = wantsShadow

        lightLayer = CAMetalLayer()
        lightLayer.device = device
        lightLayer.pixelFormat = .bgra8Unorm
        lightLayer.framebufferOnly = true
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

    /// Set (or clear with nil) the offscreen panel image hybrid effects sample.
    /// Drawn host-side via Core Graphics (the web's Canvas2D panel) and uploaded
    /// to an `rgba8Unorm` texture bound at fragment texture(0).
    public func setPanel(_ image: CGImage?) {
        guard let image else { panelTex = nil; return }
        let w = image.width, h = image.height, bpr = w * 4
        guard w > 0, h > 0 else { panelTex = nil; return }
        let d = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm, width: w, height: h, mipmapped: false)
        d.usage = [.shaderRead]
        d.storageMode = .shared
        guard let tex = device.makeTexture(descriptor: d) else { panelTex = nil; return }
        var data = [UInt8](repeating: 0, count: bpr * h)
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedLast.rawValue
        guard let ctx = CGContext(data: &data, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: bpr, space: cs, bitmapInfo: info) else { panelTex = nil; return }
        ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
        data.withUnsafeMutableBytes {
            tex.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0,
                        withBytes: $0.baseAddress!, bytesPerRow: bpr)
        }
        panelTex = tex
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

    /// Drive one on-screen frame (call from a CADisplayLink). `dpr` is the content
    /// scale; `anchorPx` the effect origin in points.
    public func tick(now: CFTimeInterval, dpr: Float, anchorPx: SIMD2<Float>) {
        guard let runner else { return }
        let elapsedMs = (now - startTime) * 1000 * timeScale

        // The LIGHT pass is mandatory. If no drawable is available this frame,
        // skip the whole tick rather than crash on a nil encoder.
        guard let light = beginPass(lightLayer) else { return }

        let w = Float(lightLayer.drawableSize.width)
        let h = Float(lightLayer.drawableSize.height)

        // Optional shadow pass into its own drawable / command buffer.
        let shadow = shadowLayer.flatMap { beginPass($0) }

        // Encode the draw calls FIRST, then end encoding. (Encoding into an
        // already-ended encoder is Metal API misuse and crashes.)
        runner.render(
            elapsedMs: elapsedMs, width: w, height: h, anchorPx: anchorPx, dpr: dpr,
            lightEncoder: light.enc, shadowEncoder: shadow?.enc, panel: panelTex
        )

        shadow?.enc.endEncoding()
        light.enc.endEncoding()

        if let shadow { shadow.cb.present(shadow.drawable); shadow.cb.commit() }
        light.cb.present(light.drawable); light.cb.commit()
    }

    // MARK: - Off-screen capture (CI recorder)
    //
    // recordVideo can't finalize a video on a virtualized runner, so the demo
    // records the effect by rendering it OFF-SCREEN, frame by frame, at synthetic
    // times. This deliberately avoids CADisplayLink + CAMetalLayer.nextDrawable
    // (which, framebuffer-starved on a headless sim, blocks with 1s timeouts and
    // returns nil) — so timing is exact and the sequence is complete + smooth
    // regardless of the simulator's real frame rate. The light pass only.

    /// Render ONE light frame at `elapsedMs` into an owned, CPU-readable texture
    /// and return it as an sRGB CGImage. Synchronous (waits for the GPU).
    public func renderOffscreen(elapsedMs: Double, width: Int, height: Int,
                                dpr: Float, anchorPx: SIMD2<Float>) -> CGImage? {
        guard let runner, width > 0, height > 0 else { return nil }
        let desc = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: lightLayer.pixelFormat, width: width, height: height, mipmapped: false)
        desc.usage = [.renderTarget, .shaderRead]
        desc.storageMode = .shared
        guard let tex = device.makeTexture(descriptor: desc),
              let cb = queue.makeCommandBuffer() else { return nil }
        let rpd = MTLRenderPassDescriptor()
        rpd.colorAttachments[0].texture = tex
        rpd.colorAttachments[0].loadAction = .clear
        rpd.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        rpd.colorAttachments[0].storeAction = .store
        guard let enc = cb.makeRenderCommandEncoder(descriptor: rpd) else { return nil }
        runner.render(elapsedMs: elapsedMs, width: Float(width), height: Float(height),
                      anchorPx: anchorPx, dpr: dpr, lightEncoder: enc, shadowEncoder: nil)
        enc.endEncoding()
        cb.commit()
        cb.waitUntilCompleted()
        return Self.makeCGImage(from: tex)
    }

    /// Read a `.shared` bgra8 texture back into an sRGB CGImage. We swap B↔R into
    /// straight RGBA bytes and build the image as premultipliedLast — explicit and
    /// platform-independent (the byteOrder32Little/premultipliedFirst combo read
    /// the channels swapped on the simulator, turning the warm bloom cyan).
    private static func makeCGImage(from tex: MTLTexture) -> CGImage? {
        let w = tex.width, h = tex.height, bpr = w * 4
        var buf = [UInt8](repeating: 0, count: bpr * h)
        buf.withUnsafeMutableBytes {
            tex.getBytes($0.baseAddress!, bytesPerRow: bpr,
                         from: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0)
        }
        var i = 0
        while i < buf.count { buf.swapAt(i, i + 2); i += 4 }   // BGRA → RGBA
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue)
        guard let ctx = CGContext(data: &buf, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: bpr, space: cs, bitmapInfo: info.rawValue) else { return nil }
        return ctx.makeImage()
    }
}
#endif
