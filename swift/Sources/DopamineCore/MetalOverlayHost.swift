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

/// A hybrid effect that needs an offscreen "panel" (the web's Canvas2D layer it
/// samples in-shader — e.g. comic's word, heartburst's hearts) supplies ONLY its
/// CONTENT by conforming its `PassConfig` to this. The BACKBONE owns everything
/// else: allocating the surface, running the draw, uploading to a texture, and
/// binding it at fragment texture(0). The context is flipped to a top-left origin
/// so the draw matches the web's Canvas2D coordinate space. This mirrors the web,
/// where the panel RUNNER is shared framework and only the draw fn is per-effect.
/// Per-frame state for a hybrid panel draw (the Swift mirror of the web
/// `PanelFrameInfo`, extended with the targeted element's box).
public struct PanelFrame {
    /// Normalized effect progress 0..1 so the panel geometry can animate.
    public var life: Double
    /// The targeted element's CENTRE in panel device px (top-left origin, y-down —
    /// the panel's own coordinate space). The centrepiece is drawn here instead of
    /// the canvas centre, so it sits on the page element.
    public var centerPx: CGPoint
    /// The targeted element's SIZE in device px. The centrepiece is sized to this
    /// box. Defaults to the full canvas when no element is targeted.
    public var targetPx: CGSize
    public init(life: Double, centerPx: CGPoint, targetPx: CGSize) {
        self.life = life; self.centerPx = centerPx; self.targetPx = targetPx
    }
}

public protocol PanelDrawing {
    /// Panel pixel size for the given canvas size. Default: the whole canvas.
    func panelSizePx(canvasPx: CGSize, params: [String: DopeValue]) -> CGSize
    /// Paint the panel (RGBA channels per the effect's own shader contract) into
    /// `ctx` (top-left origin, extent = `sizePx`). `params` is the resolved bag
    /// (incl. the scatter seed) so the draw is deterministic for the feeling.
    /// `frame` carries the per-frame progress + the targeted element box, so the
    /// panel GEOMETRY animates AND lands on the page element — mirroring the web
    /// panel runner, which re-draws the Canvas2D panel every frame. The host
    /// redraws + re-uploads the panel on every tick.
    func drawPanel(_ ctx: CGContext, sizePx: CGSize, params: [String: DopeValue], frame: PanelFrame)
}
public extension PanelDrawing {
    func panelSizePx(canvasPx: CGSize, params: [String: DopeValue]) -> CGSize { canvasPx }
}

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

    /// Retained panel-draw state so the host can RE-DRAW the panel every tick (the
    /// web panel runner redraws its Canvas2D every frame so the panel geometry
    /// animates). An empty `panelSizePx` ⇒ a pure-shader effect with no panel.
    private var panelParams: [String: DopeValue] = [:]
    private var panelSizePx: CGSize = .zero
    /// Reused CPU staging buffer for the per-frame panel texture upload (avoids a
    /// multi-MB heap allocation every tick for hybrid effects). Sized lazily.
    private var uploadBuffer: [UInt8] = []

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

    /// Do ALL the expensive per-fire work AHEAD of `play()`: compile the pass
    /// pipelines (build the runner) and, for a hybrid effect, draw + upload the
    /// offscreen panel texture. After this returns, `play()` is just "start the
    /// clock", so a prepared effect begins instantly (the demo prepares the next
    /// effect during the current one's dwell). The layer's `drawableSize` must be
    /// set before calling this (the panel is sized from it).
    public func prepare(params: [String: DopeValue]) throws {
        // Build the pipelines ONCE per host (first prepare = at effect load /
        // selection). A re-fire only swaps params — rebuilding the runner every
        // fire would recompile pipelines on the main thread and make the first
        // Fire hitch.
        let builtNewRunner: Bool
        if let runner {
            runner.updateParams(params)
            builtNewRunner = false
        } else {
            runner = try MetalPassRunner(
                config: config, params: params, device: device, library: library,
                pixelFormat: lightLayer.pixelFormat, wantsShadow: wantsShadow
            )
            builtNewRunner = true
        }
        // The backbone retains the draw state and builds the first panel; `tick`
        // re-draws it every frame (so the panel geometry animates, mirroring the
        // web). Pure-shader effects clear it.
        if let pd = config as? PanelDrawing {
            let canvas = CGSize(width: lightLayer.drawableSize.width,
                                height: lightLayer.drawableSize.height)
            panelParams = params
            panelSizePx = pd.panelSizePx(canvasPx: canvas, params: params)
            // Initial pose: centred, full canvas (the live tick supplies the element box).
            redrawPanel(life: 0,
                        centerPx: CGPoint(x: panelSizePx.width * 0.5, y: panelSizePx.height * 0.5),
                        targetPx: panelSizePx)
        } else {
            panelParams = [:]
            panelSizePx = .zero
            setPanel(nil)
        }
        // Warm the freshly-built pipeline at LOAD time: render one tiny throwaway
        // offscreen frame so the first on-screen frame (the first Fire) doesn't
        // hitch on first-use shader compilation. Warmup cost is resolution-
        // independent, so 32×32 suffices; skipped on a cheap param-only re-prepare.
        if builtNewRunner {
            _ = renderOffscreen(elapsedMs: 0, width: 32, height: 32, dpr: 1,
                                anchorPx: SIMD2<Float>(16, 16))
        }
    }

    /// Re-draw + re-upload the hybrid panel for this frame. The web panel runner
    /// redraws its Canvas2D every frame, so the panel GEOMETRY (e.g. heartburst's
    /// burst hearts flying outward) animates AND lands on the page element; this
    /// mirrors that. No-op for pure-shader effects (empty `panelSizePx`).
    private func redrawPanel(life: Double, centerPx: CGPoint, targetPx: CGSize) {
        guard let pd = config as? PanelDrawing,
              panelSizePx.width >= 1, panelSizePx.height >= 1 else { return }
        let sz = panelSizePx
        let frame = PanelFrame(life: life, centerPx: centerPx, targetPx: targetPx)
        setPanel(Self.makePanelImage(sz) { ctx in
            pd.drawPanel(ctx, sizePx: sz, params: panelParams, frame: frame)
        })
    }

    /// Convert the per-tick anchor + element box (POINTS) into the panel's device-px
    /// space (y-down, top-left). A non-positive `targetPx` ⇒ the full canvas.
    private func panelFrameInputs(dpr: Float, anchorPx: SIMD2<Float>, targetPx: SIMD2<Float>)
        -> (center: CGPoint, target: CGSize) {
        let d = CGFloat(dpr)
        let center = CGPoint(x: CGFloat(anchorPx.x) * d, y: CGFloat(anchorPx.y) * d)
        let target = (targetPx.x > 0 && targetPx.y > 0)
            ? CGSize(width: CGFloat(targetPx.x) * d, height: CGFloat(targetPx.y) * d)
            : panelSizePx
        return (center, target)
    }

    /// Start the (already-prepared) effect's animation clock. Cheap — no pipeline
    /// build, no texture upload.
    public func play() {
        startTime = CACurrentMediaTime()
    }

    /// Allocate an RGBA panel CGContext (top-left origin, matching Canvas2D), run
    /// the effect's draw, and return the image. Pure Core Graphics — the shared
    /// "panel runner" the per-effect `drawPanel` plugs into.
    private static func makePanelImage(_ sizePx: CGSize, _ draw: (CGContext) -> Void) -> CGImage? {
        let w = max(1, Int(sizePx.width.rounded())), h = max(1, Int(sizePx.height.rounded()))
        let cs = CGColorSpaceCreateDeviceRGB()
        guard let ctx = CGContext(data: nil, width: w, height: h, bitsPerComponent: 8,
                                  bytesPerRow: 0, space: cs,
                                  bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        ctx.clear(CGRect(x: 0, y: 0, width: w, height: h))
        ctx.translateBy(x: 0, y: CGFloat(h)); ctx.scaleBy(x: 1, y: -1)  // top-left origin
        draw(ctx)
        return ctx.makeImage()
    }

    /// Set (or clear with nil) the offscreen panel image hybrid effects sample.
    /// Drawn host-side via Core Graphics (the web's Canvas2D panel) and uploaded
    /// to an `rgba8Unorm` texture bound at fragment texture(0).
    public func setPanel(_ image: CGImage?) {
        guard let image else { panelTex = nil; return }
        let w = image.width, h = image.height, bpr = w * 4
        guard w > 0, h > 0 else { panelTex = nil; return }
        // Reuse the existing texture when the size is unchanged — the panel is
        // re-uploaded every frame, so allocating a fresh full-screen texture each
        // tick would churn ~12 MB/frame.
        let tex: MTLTexture
        if let existing = panelTex, existing.width == w, existing.height == h {
            tex = existing
        } else {
            let d = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: .rgba8Unorm, width: w, height: h, mipmapped: false)
            d.usage = [.shaderRead]
            d.storageMode = .shared
            guard let t = device.makeTexture(descriptor: d) else { panelTex = nil; return }
            tex = t
        }
        // Reuse the upload buffer across frames — the panel is re-uploaded EVERY
        // frame (the geometry animates), so allocating a fresh multi-MB array per
        // tick churns the heap on the main thread (hybrid effects felt sluggish).
        // Resize only on a size change; otherwise zero in place (the premultiplied
        // draw composites over it, so it must start transparent).
        let needed = bpr * h
        if uploadBuffer.count != needed {
            uploadBuffer = [UInt8](repeating: 0, count: needed)
        } else {
            uploadBuffer.withUnsafeMutableBytes { _ = $0.initializeMemory(as: UInt8.self, repeating: 0) }
        }
        let cs = CGColorSpaceCreateDeviceRGB()
        let info = CGImageAlphaInfo.premultipliedLast.rawValue
        let ok: Bool = uploadBuffer.withUnsafeMutableBytes { raw -> Bool in
            guard let base = raw.baseAddress,
                  let ctx = CGContext(data: base, width: w, height: h, bitsPerComponent: 8,
                                      bytesPerRow: bpr, space: cs, bitmapInfo: info) else { return false }
            // Emulate WebGL's `UNPACK_FLIP_Y_WEBGL = true` (the web panel upload): the
            // panel shaders SAMPLE the texture in a y-up vUv (matching the web vertex),
            // so texture row 0 must be the BOTTOM of the drawn panel. Flip the upload
            // context's y before drawing the (top-left-origin) image — otherwise the
            // panel (comic word, heartburst hearts) renders upside down.
            ctx.translateBy(x: 0, y: CGFloat(h)); ctx.scaleBy(x: 1, y: -1)
            ctx.draw(image, in: CGRect(x: 0, y: 0, width: w, height: h))
            tex.replace(region: MTLRegionMake2D(0, 0, w, h), mipmapLevel: 0,
                        withBytes: base, bytesPerRow: bpr)
            return true
        }
        guard ok else { panelTex = nil; return }
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
    /// scale; `anchorPx` the effect origin in points; `targetPx` the targeted
    /// element's size in points (zero ⇒ the centrepiece fills the whole canvas).
    public func tick(now: CFTimeInterval, dpr: Float, anchorPx: SIMD2<Float>,
                     targetPx: SIMD2<Float> = .zero) {
        guard let runner else { return }
        let elapsedMs = (now - startTime) * 1000 * timeScale

        // Re-draw the hybrid panel for this frame's life (the web redraws its
        // Canvas2D every frame, so the panel geometry animates) on the page element.
        let life = Swift.min(Swift.max(elapsedMs, 0) / Swift.max(runner.durationMs, 1), 1)
        let pf = panelFrameInputs(dpr: dpr, anchorPx: anchorPx, targetPx: targetPx)
        redrawPanel(life: life, centerPx: pf.center, targetPx: pf.target)

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
            elapsedMs: elapsedMs, width: w, height: h, anchorPx: anchorPx,
            targetPx: targetPx, dpr: dpr,
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
                                dpr: Float, anchorPx: SIMD2<Float>,
                                targetPx: SIMD2<Float> = .zero) -> CGImage? {
        guard let runner, width > 0, height > 0 else { return nil }
        // Re-draw the hybrid panel for this frame's life so the off-screen capture
        // animates the panel geometry too (mirrors the live `tick` path).
        let life = Swift.min(Swift.max(elapsedMs, 0) / Swift.max(runner.durationMs, 1), 1)
        let pf = panelFrameInputs(dpr: dpr, anchorPx: anchorPx, targetPx: targetPx)
        redrawPanel(life: life, centerPx: pf.center, targetPx: pf.target)
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
                      anchorPx: anchorPx, targetPx: targetPx, dpr: dpr,
                      lightEncoder: enc, shadowEncoder: nil, panel: panelTex)
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
