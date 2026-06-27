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
#if canImport(AppKit)
import AppKit
#elseif canImport(UIKit)
import UIKit
#endif

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
    /// The un-stepped wall-clock time for this frame, in MILLISECONDS (the web's
    /// `info.animMs`). A panel draw that needs per-element animation timing (e.g.
    /// solarbloom's per-mote twinkle, which takes `timeS = animMs / 1000`) reads
    /// this; one-shot panels (heartburst/comic/confetti) drive off `life` and
    /// ignore it.
    public var elapsedMs: Double
    public init(life: Double, centerPx: CGPoint, targetPx: CGSize, elapsedMs: Double = 0) {
        self.life = life; self.centerPx = centerPx; self.targetPx = targetPx
        self.elapsedMs = elapsedMs
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

/// A DATA-DRIVEN config for a PANEL effect (`render.panel`): the generic
/// `DopePassConfig` plus the ONE genuinely code-shaped piece — the per-frame
/// Core Graphics panel draw (the panel-draw seam; the generated factory shells
/// wire `draw<Name>Panel` here). Everything else — `tempo.frame`,
/// `render.shadowHeightFrac`, `render.pass`, `render.config.stepping: "none"`
/// (panels never snap on twos), the binding contract — is the same `.dope`
/// data the base config interprets; this wrapper just forwards to it and
/// conforms to `PanelDrawing` so the overlay host redraws + uploads the panel
/// (bound at fragment texture(0), the cross-platform panel slot) every tick.
public struct DopePanelPassConfig<U>: PassConfig, PanelDrawing {
    public typealias Uniforms = U
    /// The hand-written per-effect panel draw (CGContext is top-left/y-down,
    /// matching the web Canvas2D space the host pre-flips to).
    public typealias DrawPanel = (CGContext, CGSize, [String: DopeValue], PanelFrame) -> Void

    private let base: DopePassConfig<U>
    private let draw: DrawPanel

    public init(
        doc: DopeDoc,
        vertexFunction: String,
        fragmentFunction: String,
        packUniforms: @escaping DopePassConfig<U>.Packer,
        drawPanel: @escaping DrawPanel,
        packExtras: DopePassConfig<U>.ExtrasHook? = nil
    ) throws {
        self.base = try DopePassConfig(
            doc: doc,
            vertexFunction: vertexFunction,
            fragmentFunction: fragmentFunction,
            packUniforms: packUniforms,
            packExtras: packExtras
        )
        self.draw = drawPanel
    }

    // PassConfig — forwarded to the data-driven base.
    public var vertexFunction: String { base.vertexFunction }
    public var fragmentFunction: String { base.fragmentFunction }
    public var usesOrigin: Bool { base.usesOrigin }
    public var loopPeriodMs: Double? { base.loopPeriodMs }
    public var snapsOnTwos: Bool { base.snapsOnTwos }
    public func shadowHeightFrac(_ params: [String: DopeValue]) -> Double {
        base.shadowHeightFrac(params)
    }
    public func frame(_ info: FrameInfo, _ params: [String: DopeValue]) -> (amp: Double, extras: [String: Double]) {
        base.frame(info, params)
    }
    public func passExtras(
        targetMinDimPx: Double, dpr: Double, params: [String: DopeValue]
    ) -> [String: Double] {
        base.passExtras(targetMinDimPx: targetMinDimPx, dpr: dpr, params: params)
    }
    public func packUniforms(
        standard: StandardUniforms,
        params: [String: DopeValue],
        extras: [String: Double]
    ) -> U {
        base.packUniforms(standard: standard, params: params, extras: extras)
    }

    // PanelDrawing — the code-shaped seam.
    public func drawPanel(_ ctx: CGContext, sizePx: CGSize, params: [String: DopeValue], frame: PanelFrame) {
        draw(ctx, sizePx, params, frame)
    }
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
    /// Wall-clock time the effect was paused, or nil while running. While paused
    /// `tick` is a no-op (the last frame holds on screen) — so a perpetual
    /// `tempo.loop` effect in a backgrounded view costs no GPU/battery. `resume`
    /// shifts `startTime` forward by the paused span, so the clock (and a loop's
    /// seam) continues exactly where it froze: drift-free.
    private var pausedAt: CFTimeInterval?
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

    /// Off-screen target the SHADOW pass renders into (cleared to WHITE, so the
    /// multiply-blended shadow pipeline copies its `mul` output verbatim). A host
    /// conversion pass then turns that into premultiplied black-with-alpha and
    /// destination-over-composites it BEHIND the glow in the light layer — so the
    /// whole overlay is ONE source-over layer that darkens the live backdrop on BOTH
    /// iOS and macOS (no `CALayer.compositingFilter`, which is macOS-only). Sized to
    /// the drawable; reallocated on resize. nil ⇒ shadows off (wantsShadow == false).
    private var shadowRawTex: MTLTexture?
    /// The host-owned "multiply colour → premultiplied black-alpha" conversion: a
    /// fullscreen pass compiled at runtime (so it needs no bundled `.metal`), with a
    /// destination-over blend. nil ⇒ build failed ⇒ skip the shadow (glow still draws).
    private var shadowConvert: (pipeline: MTLRenderPipelineState, sampler: MTLSamplerState)?

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
        if wantsShadow {
            shadowConvert = Self.makeShadowConvert(device: device, pixelFormat: lightLayer.pixelFormat)
        }
    }

    /// Build the host-owned shadow conversion pass (multiply colour → premultiplied
    /// black-with-alpha, destination-over). Compiled from a source string so the
    /// library needs no bundled `.metal`. Returns nil on any failure (shadows just
    /// don't render; the glow is unaffected).
    private static func makeShadowConvert(device: MTLDevice, pixelFormat: MTLPixelFormat)
        -> (pipeline: MTLRenderPipelineState, sampler: MTLSamplerState)? {
        let src = """
        #include <metal_stdlib>
        using namespace metal;
        struct DopShadowVOut { float4 pos [[position]]; float2 uv; };
        vertex DopShadowVOut dop_shadowConvertV(uint vid [[vertex_id]]) {
          float2 p[3] = { float2(-1.0, -1.0), float2(3.0, -1.0), float2(-1.0, 3.0) };
          DopShadowVOut o;
          o.pos = float4(p[vid], 0.0, 1.0);
          float2 uv = p[vid] * 0.5 + 0.5;
          o.uv = float2(uv.x, 1.0 - uv.y);   // match the runner's top-left drawable
          return o;
        }
        fragment float4 dop_shadowConvertF(DopShadowVOut in [[stage_in]],
            texture2d<float> raw [[texture(0)]], sampler smp [[sampler(0)]]) {
          float3 c = raw.sample(smp, in.uv).rgb;   // shadow MULTIPLY colour: 1 = no shadow
          float dark = clamp(1.0 - dot(c, float3(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
          return float4(0.0, 0.0, 0.0, dark);      // premultiplied black (source-over darkening)
        }
        """
        guard let lib = try? device.makeLibrary(source: src, options: nil),
              let vfn = lib.makeFunction(name: "dop_shadowConvertV"),
              let ffn = lib.makeFunction(name: "dop_shadowConvertF") else { return nil }
        let d = MTLRenderPipelineDescriptor()
        d.vertexFunction = vfn
        d.fragmentFunction = ffn
        let a = d.colorAttachments[0]!
        a.pixelFormat = pixelFormat
        a.isBlendingEnabled = true
        a.rgbBlendOperation = .add
        a.alphaBlendOperation = .add
        // Destination-over: result = src·(1 − dst.a) + dst — the shadow fills only
        // where the glow hasn't already, i.e. BEHIND it, in the same layer.
        a.sourceRGBBlendFactor = .oneMinusDestinationAlpha
        a.destinationRGBBlendFactor = .one
        a.sourceAlphaBlendFactor = .oneMinusDestinationAlpha
        a.destinationAlphaBlendFactor = .one
        let sd = MTLSamplerDescriptor()
        sd.minFilter = .linear; sd.magFilter = .linear
        sd.sAddressMode = .clampToEdge; sd.tAddressMode = .clampToEdge
        guard let pipeline = try? device.makeRenderPipelineState(descriptor: d),
              let sampler = device.makeSamplerState(descriptor: sd) else { return nil }
        return (pipeline, sampler)
    }

    /// Do ALL the expensive per-fire work AHEAD of `play()`: compile the pass
    /// pipelines (build the runner) and, for a hybrid effect, draw + upload the
    /// offscreen panel texture. After this returns, `play()` is just "start the
    /// clock", so a prepared effect begins instantly (the demo prepares the next
    /// effect during the current one's dwell). The layer's `drawableSize` must be
    /// set before calling this (the panel is sized from it).
    /// Backdrop luminance (0 dark .. 1 white) the overlay composites against; it
    /// drives the light-out saturation/presence boost so effects stay vivid on a
    /// light surface. 0 (the default) ⇒ no boost ⇒ the dark look is unchanged.
    /// The Swift mirror of the web `backdrop` option — set it (compute it from
    /// your surface colour) before `prepare`/`play`. Applied to the runner on the
    /// next `prepare`.
    public var backdropLuminance: Double = 0 {
        didSet { runner?.backdropLuminance = backdropLuminance }
    }

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
        runner?.backdropLuminance = backdropLuminance
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
                        targetPx: panelSizePx, elapsedMs: 0)
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
    private func redrawPanel(life: Double, centerPx: CGPoint, targetPx: CGSize, elapsedMs: Double) {
        guard let pd = config as? PanelDrawing,
              panelSizePx.width >= 1, panelSizePx.height >= 1 else { return }
        let sz = panelSizePx
        let frame = PanelFrame(life: life, centerPx: centerPx, targetPx: targetPx, elapsedMs: elapsedMs)
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
        pausedAt = nil
    }

    /// Whether the effect's clock is currently frozen.
    public var isPaused: Bool { pausedAt != nil }

    /// Freeze the animation clock at `now` (default: the current media time). A
    /// paused effect's `tick` does nothing — the host KEEPS the last frame on the
    /// layer and spends no GPU — the analog of the web conductor parking its RAF
    /// for a paused/hidden loop. Idempotent. The host that owns the display link
    /// should stop pumping `tick` (or just let the no-op ticks pass).
    public func pause(now: CFTimeInterval = CACurrentMediaTime()) {
        if pausedAt == nil { pausedAt = now }
    }

    /// Resume a paused clock: shift `startTime` forward by the paused span so the
    /// effect continues exactly where it froze — drift-free, the loop seam intact.
    /// No-op if not paused.
    public func resume(now: CFTimeInterval = CACurrentMediaTime()) {
        guard let p = pausedAt else { return }
        startTime += now - p
        pausedAt = nil
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

    /// Drive one on-screen frame (call from a CADisplayLink). `dpr` is the content
    /// scale; `anchorPx` the effect origin in points; `targetPx` the targeted
    /// element's size in points (zero ⇒ the centrepiece fills the whole canvas).
    public func tick(now: CFTimeInterval, dpr: Float, anchorPx: SIMD2<Float>,
                     targetPx: SIMD2<Float> = .zero) {
        guard let runner else { return }
        // Paused: hold the last frame, advance nothing, draw nothing (no battery).
        if pausedAt != nil { return }
        let elapsedMs = (now - startTime) * 1000 * timeScale

        // Re-draw the hybrid panel for this frame's life (the web redraws its
        // Canvas2D every frame, so the panel geometry animates) on the page element.
        let life = Swift.min(Swift.max(elapsedMs, 0) / Swift.max(runner.durationMs, 1), 1)
        let pf = panelFrameInputs(dpr: dpr, anchorPx: anchorPx, targetPx: targetPx)
        redrawPanel(life: life, centerPx: pf.center, targetPx: pf.target, elapsedMs: elapsedMs)

        let w = Float(lightLayer.drawableSize.width)
        let h = Float(lightLayer.drawableSize.height)
        // No drawable available this frame ⇒ skip the tick rather than crash.
        guard w >= 1, h >= 1,
              let drawable = lightLayer.nextDrawable(),
              let cb = queue.makeCommandBuffer() else { return }

        // ONE command buffer, sequential render passes (Metal allows only ONE active
        // encoder per command buffer at a time, and a single queue executes a buffer's
        // passes in order — so the conversion safely reads what the shadow pass wrote):
        //   1. SHADOW pass → off-screen `shadowRawTex`, cleared WHITE so the multiply
        //      pipeline copies its `mul` output (1 = no shadow) verbatim.
        //   2. LIGHT (glow) pass → the on-screen drawable, cleared transparent.
        //   3. CONVERSION → sample the raw shadow, emit premultiplied black with
        //      alpha = 1 − luma(mul), destination-over so it fills BEHIND the glow.
        // Net: ONE source-over layer that darkens the live backdrop on iOS AND macOS
        // (no `CALayer.compositingFilter`, which is macOS-only).
        let useShadow = wantsShadow && shadowConvert != nil
        if useShadow {
            ensureShadowRawTex(width: Int(w), height: Int(h))
            if let raw = shadowRawTex {
                let srpd = MTLRenderPassDescriptor()
                srpd.colorAttachments[0].texture = raw
                srpd.colorAttachments[0].loadAction = .clear
                srpd.colorAttachments[0].clearColor = MTLClearColor(red: 1, green: 1, blue: 1, alpha: 1)
                srpd.colorAttachments[0].storeAction = .store
                if let se = cb.makeRenderCommandEncoder(descriptor: srpd) {
                    runner.render(elapsedMs: elapsedMs, width: w, height: h, anchorPx: anchorPx,
                                  targetPx: targetPx, dpr: dpr,
                                  lightEncoder: nil, shadowEncoder: se, panel: panelTex)
                    se.endEncoding()
                }
            }
        }

        let lrpd = MTLRenderPassDescriptor()
        lrpd.colorAttachments[0].texture = drawable.texture
        lrpd.colorAttachments[0].loadAction = .clear
        lrpd.colorAttachments[0].clearColor = MTLClearColor(red: 0, green: 0, blue: 0, alpha: 0)
        lrpd.colorAttachments[0].storeAction = .store
        guard let le = cb.makeRenderCommandEncoder(descriptor: lrpd) else { return }
        runner.render(elapsedMs: elapsedMs, width: w, height: h, anchorPx: anchorPx,
                      targetPx: targetPx, dpr: dpr,
                      lightEncoder: le, shadowEncoder: nil, panel: panelTex)
        le.endEncoding()

        if useShadow, let raw = shadowRawTex, let sc = shadowConvert {
            let crpd = MTLRenderPassDescriptor()
            crpd.colorAttachments[0].texture = drawable.texture
            crpd.colorAttachments[0].loadAction = .load
            crpd.colorAttachments[0].storeAction = .store
            if let conv = cb.makeRenderCommandEncoder(descriptor: crpd) {
                conv.setRenderPipelineState(sc.pipeline)
                conv.setFragmentTexture(raw, index: 0)
                conv.setFragmentSamplerState(sc.sampler, index: 0)
                conv.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
                conv.endEncoding()
            }
        }

        cb.present(drawable)
        cb.commit()
    }

    /// (Re)allocate the off-screen shadow target to match the drawable size.
    private func ensureShadowRawTex(width: Int, height: Int) {
        guard width > 0, height > 0 else { return }
        if let t = shadowRawTex, t.width == width, t.height == height { return }
        let d = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: lightLayer.pixelFormat, width: width, height: height, mipmapped: false)
        d.usage = [.renderTarget, .shaderRead]
        d.storageMode = .private
        shadowRawTex = device.makeTexture(descriptor: d)
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
        redrawPanel(life: life, centerPx: pf.center, targetPx: pf.target, elapsedMs: elapsedMs)
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

// MARK: - Hosting the overlay layer in a view
//
// AGENT NOTE — orientation when hosting `lightLayer` yourself:
// Metal renders into a TOP-LEFT-origin drawable. Core Animation composites a layer
// per its layer-tree geometry, so the orientation depends on the VIEW you attach to:
//   • iOS `UIView`         → never flipped; the layer composites upright as-is.
//   • macOS `NSView`       → default origin is BOTTOM-LEFT (upright as-is); but a
//     view with `isFlipped == true` (top-left origin — common to match UIKit/SwiftUI
//     anchor coordinates) composites the drawable's contents UPSIDE DOWN unless you
//     set `layer.isGeometryFlipped = true` to cancel it.
// Most effects are ~vertically symmetric so the flip is easy to miss — it only reads
// wrong on an asymmetric GLYPH / icon / word. ALWAYS attach via `attach(to:)` below
// (it reads `view.isFlipped` and orients the layer correctly) instead of calling
// `view.layer.addSublayer(host.lightLayer)` directly. Do NOT hardcode
// `isGeometryFlipped` — `attach(to:)` is the single correct path on both platforms.
extension MetalOverlayHost {
    #if canImport(AppKit)
    /// Attach the overlay's `lightLayer` as a sublayer of `view`, oriented for the
    /// view's coordinate system. On a FLIPPED `NSView` (`isFlipped == true`) this sets
    /// `isGeometryFlipped` so the Metal drawable presents upright; on a normal NSView
    /// it leaves it alone. Makes `view` layer-backed if it isn't already.
    public func attach(to view: NSView) {
        view.wantsLayer = true
        lightLayer.isGeometryFlipped = view.isFlipped
        view.layer?.addSublayer(lightLayer)
    }
    #elseif canImport(UIKit)
    /// Attach the overlay's `lightLayer` as a sublayer of `view`. UIKit's coordinate
    /// space never needs the geometry flip, so this is a plain `addSublayer`.
    public func attach(to view: UIView) {
        view.layer.addSublayer(lightLayer)
    }
    #endif
}
#endif
