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

        if let shadow { shadow.cb.present(shadow.drawable); shadow.cb.commit() }
        light.cb.present(light.drawable); light.cb.commit()
    }
}
#endif
