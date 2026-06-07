// Generic Metal fullscreen-pass runner — the Swift mirror of `framework/pass-runner.ts`.
//
// macOS/iOS ONLY (guarded by `#if canImport(Metal)`): on Linux this whole file
// compiles to nothing, so the portable core still builds with no Apple SDK.
//
// A pure-shader effect (Solarbloom, and the other pure-shader web effects) is a
// full-screen triangle that runs a fragment shader twice — once into the light
// (`screen`-blended) layer and, when present, once into the shadow
// (`multiply`-blended) layer. This runner owns the SAME plumbing the web runner
// owns: build the pipeline, set the standard uniforms (resolution, origin, time,
// life, envelope amp, palette, style, the shadow uniforms), auto-bind the
// resolved scalar `render.params` to the fragment uniform STRUCT by name, run
// the two passes. What stays per-effect: the MSL itself + a tiny `frame()` hook
// computing the genuinely time-varying values.
//
// KEY PORT DIVERGENCE (GLSL→MSL uniforms): WebGL sets uniforms one-by-one by
// name via `gl.uniform*`. Metal has no per-name uniform setters — a fragment
// shader reads ONE `constant Uniforms &u [[buffer(0)]]` struct. So the web's
// `name → u<Name>` auto-binding becomes "resolved param `name` → struct FIELD
// `name`": we fill a `[String: Float]`/palette map here and a generated packing
// step (see `SolarbloomUniforms`) lays it into the struct with the exact memory
// layout the `.metal` expects. This is the single biggest generalization the
// port surfaces (see report (b)): the binding map is data, not code.

#if canImport(Metal)
import Metal
import simd

/// Per-frame timing context handed to a config's `frame` hook (mirror of `FrameInfo`).
public struct FrameInfo {
    /// The "on twos"-snapped animation clock in ms (stepping already applied).
    public var animMs: Double
    /// Normalized life 0..1.
    public var life: Double
    /// The REAL (un-stepped) elapsed ms. Use this for timing that must stay
    /// smooth even when the bloom is stylized "on twos" — e.g. the functional
    /// checkmark confirmation, whose draw should never visibly step.
    public var elapsedMs: Double
    public init(animMs: Double, life: Double, elapsedMs: Double? = nil) {
        self.animMs = animMs
        self.life = life
        self.elapsedMs = elapsedMs ?? animMs
    }
}

/// The standard uniforms every pure-shader pass receives, laid out so a generated
/// per-effect uniform struct can embed it. Field names mirror the GLSL `u*` set.
public struct StandardUniforms {
    public var resolution: SIMD2<Float> = .zero  // device px
    public var origin: SIMD2<Float> = .zero      // gl coords (y up)
    public var life: Float = 0
    public var timeS: Float = 0
    public var style: Float = 0
    public var amp: Float = 0
    public var c0: SIMD3<Float> = .zero
    public var c1: SIMD3<Float> = .zero
    public var c2: SIMD3<Float> = .zero
    public var shadow: Float = 0                 // 0 light pass, 1 shadow pass
    public var shadowOffset: SIMD2<Float> = .zero
    public var shadowSoft: Float = 0
    public var shadowStrength: Float = 0
    public init() {}
}

/// A per-effect config: the genuinely code-shaped bits (the MSL function names,
/// the shadow height, the per-frame hook, and the uniform packer). Everything
/// else (the two-pass loop, standard uniforms, the auto-bind of resolved scalars)
/// is generic, exactly as in the web `PassConfig`.
public protocol PassConfig {
    associatedtype Uniforms
    /// Name of the MSL vertex function (in the bundled metallib).
    var vertexFunction: String { get }
    /// Name of the MSL fragment function.
    var fragmentFunction: String { get }
    /// Whether the shader reads `origin` (anchored radial effects do).
    var usesOrigin: Bool { get }
    /// The shadow occluder "height" as a fraction of min canvas dim.
    func shadowHeightFrac(_ params: [String: DopeValue]) -> Double
    /// Compute the effect-specific time-varying values; MUST return `amp` (fed to
    /// the shadow geometry). Mirrors the web `frame()` hook.
    func frame(_ info: FrameInfo, _ params: [String: DopeValue]) -> (amp: Double, extras: [String: Double])
    /// Pack the standard uniforms + resolved params + frame extras into the
    /// fragment uniform STRUCT the `.metal` reads. This is the GLSL→MSL binding
    /// seam: the auto-bind by NAME the web does via `gl.uniform*` becomes a single
    /// struct fill here. A future generalization could datafy this (report (b)).
    func packUniforms(
        standard: StandardUniforms,
        params: [String: DopeValue],
        extras: [String: Double]
    ) -> Uniforms
}

/// Errors the runner can raise during pipeline build.
public enum MetalPassError: Error { case noFunction(String), pipelineFailed(String) }

/// Builds and holds the two render pipelines (light = screen, shadow = multiply)
/// and renders a frame for a pure-shader effect. The host (a `CAMetalLayer`
/// overlay) drives `render(frame:)` each tick. See `MetalOverlayHost`.
public final class MetalPassRunner<Config: PassConfig> {
    private let config: Config
    private let device: MTLDevice
    private let lightPipeline: MTLRenderPipelineState
    private let shadowPipeline: MTLRenderPipelineState?
    private let params: [String: DopeValue]
    public let durationMs: Double

    /// Build pipelines from a metallib `library`. `pixelFormat` is the layer's.
    public init(
        config: Config,
        params: [String: DopeValue],
        device: MTLDevice,
        library: MTLLibrary,
        pixelFormat: MTLPixelFormat,
        wantsShadow: Bool
    ) throws {
        self.config = config
        self.device = device
        self.params = params
        if case let .number(d)? = params["durationMs"] { durationMs = d } else { durationMs = 0 }

        func fn(_ name: String) throws -> MTLFunction {
            guard let f = library.makeFunction(name: name) else { throw MetalPassError.noFunction(name) }
            return f
        }
        let vfn = try fn(config.vertexFunction)
        let ffn = try fn(config.fragmentFunction)

        // LIGHT pass — additive-toward-screen. Core Animation has no `screen`
        // blend mode at the LAYER level (see report (c)); we approximate the web
        // canvas `mix-blend-mode: screen` with the per-pass blend
        //   result = src + dst - src*dst,
        // which is exactly `screen`, expressed via Metal blend factors:
        //   src*ONE + dst*(ONE_MINUS_SRC_COLOR).
        let lightDesc = MTLRenderPipelineDescriptor()
        lightDesc.vertexFunction = vfn
        lightDesc.fragmentFunction = ffn
        let la = lightDesc.colorAttachments[0]!
        la.pixelFormat = pixelFormat
        la.isBlendingEnabled = true
        la.rgbBlendOperation = .add
        la.alphaBlendOperation = .add
        la.sourceRGBBlendFactor = .one
        la.destinationRGBBlendFactor = .oneMinusSourceColor   // screen
        la.sourceAlphaBlendFactor = .one
        la.destinationAlphaBlendFactor = .oneMinusSourceAlpha
        lightPipeline = try device.makeRenderPipelineState(descriptor: lightDesc)

        if wantsShadow {
            // SHADOW pass — multiply: result = src*dst. Web uses a separate
            // `multiply` canvas; here a second pipeline into a second layer.
            let shadowDesc = MTLRenderPipelineDescriptor()
            shadowDesc.vertexFunction = vfn
            shadowDesc.fragmentFunction = ffn
            let sa = shadowDesc.colorAttachments[0]!
            sa.pixelFormat = pixelFormat
            sa.isBlendingEnabled = true
            sa.rgbBlendOperation = .add
            sa.sourceRGBBlendFactor = .destinationColor          // multiply
            sa.destinationRGBBlendFactor = .zero
            sa.sourceAlphaBlendFactor = .one
            sa.destinationAlphaBlendFactor = .zero
            shadowPipeline = try device.makeRenderPipelineState(descriptor: shadowDesc)
        } else {
            shadowPipeline = nil
        }
    }

    /// Build the StandardUniforms for one pass.
    private func standard(_ info: FrameInfo, amp: Double, width: Float, height: Float, anchorPx: SIMD2<Float>, dpr: Float, isShadow: Bool) -> StandardUniforms {
        var s = StandardUniforms()
        s.resolution = SIMD2(width, height)
        if config.usesOrigin {
            // gl_FragCoord origin is bottom-left, so flip the anchor's y.
            s.origin = SIMD2(anchorPx.x * dpr, height - anchorPx.y * dpr)
        }
        s.life = Float(info.life)
        s.timeS = Float(info.animMs / 1000)
        s.style = (params["style"].flatMap { if case let .number(v) = $0 { return Float(v) } else { return nil } }) ?? 0
        s.amp = Float(amp)
        if case let .palette(pal)? = params["palette"], pal.count >= 3 {
            s.c0 = SIMD3(Float(pal[0].r), Float(pal[0].g), Float(pal[0].b))
            s.c1 = SIMD3(Float(pal[1].r), Float(pal[1].g), Float(pal[1].b))
            s.c2 = SIMD3(Float(pal[2].r), Float(pal[2].g), Float(pal[2].b))
        }
        s.shadow = isShadow ? 1 : 0
        if isShadow {
            let sg = shadowGeometry(ShadowInput(
                minDim: Double(min(width, height)),
                heightFrac: config.shadowHeightFrac(params),
                amp: amp, style: Double(s.style)
            ))
            s.shadowOffset = SIMD2(Float(sg.offsetX), Float(sg.offsetY))
            s.shadowSoft = Float(sg.soft)
            s.shadowStrength = Float(sg.strength)
        }
        return s
    }

    /// Encode one full-screen-triangle pass into `encoder`.
    private func encodePass(_ encoder: MTLRenderCommandEncoder, pipeline: MTLRenderPipelineState, uniforms: Config.Uniforms) {
        encoder.setRenderPipelineState(pipeline)
        var u = uniforms
        encoder.setFragmentBytes(&u, length: MemoryLayout<Config.Uniforms>.stride, index: 0)
        // Single full-screen triangle from vertex_id — no vertex buffers needed.
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }

    /// Render light (and shadow, if its encoder is provided) for `elapsedMs`.
    public func render(
        elapsedMs: Double,
        width: Float, height: Float, anchorPx: SIMD2<Float>, dpr: Float,
        lightEncoder: MTLRenderCommandEncoder,
        shadowEncoder: MTLRenderCommandEncoder?
    ) {
        // "Animate on twos": snap the clock toward a coarse grid as style rises.
        let style = Double(standardStyle())
        let stepped = (elapsedMs / NPR_TIME_STEP_MS).rounded(.down) * NPR_TIME_STEP_MS
        let animMs = elapsedMs + (stepped - elapsedMs) * style
        let life = Swift.min(max(animMs, 0) / max(durationMs, 1), 1)
        let info = FrameInfo(animMs: animMs, life: life, elapsedMs: elapsedMs)
        let (amp, extras) = config.frame(info, params)

        if let se = shadowEncoder, let sp = shadowPipeline {
            let s = standard(info, amp: amp, width: width, height: height, anchorPx: anchorPx, dpr: dpr, isShadow: true)
            encodePass(se, pipeline: sp, uniforms: config.packUniforms(standard: s, params: params, extras: extras))
        }
        let s = standard(info, amp: amp, width: width, height: height, anchorPx: anchorPx, dpr: dpr, isShadow: false)
        encodePass(lightEncoder, pipeline: lightPipeline, uniforms: config.packUniforms(standard: s, params: params, extras: extras))
    }

    private func standardStyle() -> Float {
        if case let .number(v)? = params["style"] { return Float(v) }
        return 0
    }
}
#endif
