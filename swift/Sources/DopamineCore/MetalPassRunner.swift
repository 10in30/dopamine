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
    public var target: SIMD2<Float> = .zero      // targeted element size, device px
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
    /// OPTIONAL per-frame ARRAY uniforms, bound as fragment BUFFERS — the Metal
    /// analog of the web/android `frameArrays` seam. An effect that CPU-precomputes
    /// geometry each frame (lightning's bolt polyline → `uVerts`/`uBoltMeta`)
    /// returns flat `[Float]` arrays + the fragment buffer index each binds at; the
    /// shader declares `constant float2 *uVerts [[buffer(1)]]` etc. Default: none
    /// (pure-shader effects don't implement this). `origin` is the strike/anchor
    /// point in gl_FragCoord space (device px, y-UP) — the same the shader reads.
    func frameArrays(
        _ info: FrameInfo,
        _ params: [String: DopeValue],
        width: Float, height: Float, origin: SIMD2<Float>
    ) -> [PassFrameArray]
}

/// A per-frame array uniform bound as a fragment buffer: flat float `data`
/// (reinterpreted as the shader's `vecN*`) at fragment `bufferIndex` (≥ 1; 0 is
/// the uniform struct). Mirrors the web/android `UniformArray` (name+size+data),
/// but Metal binds by INDEX, so the effect names the buffer slot.
public struct PassFrameArray {
    public let bufferIndex: Int
    public let data: [Float]
    public init(bufferIndex: Int, data: [Float]) {
        self.bufferIndex = bufferIndex
        self.data = data
    }
}

public extension PassConfig {
    /// Default: pure-shader effects bind no extra arrays.
    func frameArrays(
        _ info: FrameInfo,
        _ params: [String: DopeValue],
        width: Float, height: Float, origin: SIMD2<Float>
    ) -> [PassFrameArray] { [] }
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
    // Params/duration are per-FIRE, but the pipelines depend only on the config's
    // functions + pixel format — NOT on params. So a re-fire can swap params in
    // place (`updateParams`) and reuse the (expensive-to-build) pipelines instead
    // of rebuilding the whole runner. See `MetalOverlayHost.prepare`.
    private var params: [String: DopeValue]
    public private(set) var durationMs: Double

    // Texture plumbing for HYBRID effects. Pure-shader effects (Solarbloom et al.)
    // draw everything analytically and bind nothing; but comic/heartburst draw
    // their word / hearts into an offscreen "panel" (the web's Canvas2D layer) and
    // the shader SAMPLES it. The host hands that panel in via `render(panel:)`; we
    // bind it at fragment texture(0). A 1×1 clear placeholder is bound at the
    // texture slots a shader may declare so an effect that declares a `texture2d`
    // arg is always well-defined even when no panel is supplied (the empty case),
    // and a single linear/clamp sampler is bound for both slots.
    private let sampler: MTLSamplerState
    private let placeholderTex: MTLTexture

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

        // Shared sampler (linear, clamp) for any panel/SDF/glyph texture.
        let sd = MTLSamplerDescriptor()
        sd.minFilter = .linear; sd.magFilter = .linear
        sd.sAddressMode = .clampToEdge; sd.tAddressMode = .clampToEdge
        guard let smp = device.makeSamplerState(descriptor: sd) else {
            throw MetalPassError.pipelineFailed("sampler")
        }
        sampler = smp

        // 1×1 transparent placeholder so texture-declaring shaders are defined
        // even with no panel bound.
        let td = MTLTextureDescriptor.texture2DDescriptor(
            pixelFormat: .rgba8Unorm, width: 1, height: 1, mipmapped: false)
        td.usage = [.shaderRead]
        guard let ph = device.makeTexture(descriptor: td) else {
            throw MetalPassError.pipelineFailed("placeholder texture")
        }
        var clear: [UInt8] = [0, 0, 0, 0]
        ph.replace(region: MTLRegionMake2D(0, 0, 1, 1), mipmapLevel: 0, withBytes: &clear, bytesPerRow: 4)
        placeholderTex = ph
    }

    /// Swap in fresh per-fire params (and re-derive duration) WITHOUT rebuilding
    /// the pipelines. The pipelines are pure functions of the config + pixel
    /// format, so this is the cheap path a re-fire takes.
    public func updateParams(_ params: [String: DopeValue]) {
        self.params = params
        if case let .number(d)? = params["durationMs"] { durationMs = d } else { durationMs = 0 }
    }

    /// Build the StandardUniforms for one pass.
    private func standard(_ info: FrameInfo, amp: Double, width: Float, height: Float, anchorPx: SIMD2<Float>, targetPx: SIMD2<Float>, dpr: Float, isShadow: Bool) -> StandardUniforms {
        var s = StandardUniforms()
        s.resolution = SIMD2(width, height)
        if config.usesOrigin {
            // gl_FragCoord origin is bottom-left, so flip the anchor's y.
            s.origin = SIMD2(anchorPx.x * dpr, height - anchorPx.y * dpr)
        }
        // Element box (device px) the centrepiece is sized to. A non-positive
        // size means "no element" → fall back to the full canvas, so untargeted
        // fires render exactly as before.
        let tw = targetPx.x > 0 ? targetPx.x * dpr : width
        let th = targetPx.y > 0 ? targetPx.y * dpr : height
        s.target = SIMD2(tw, th)
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
    private func encodePass(_ encoder: MTLRenderCommandEncoder, pipeline: MTLRenderPipelineState, uniforms: Config.Uniforms, panel: MTLTexture?, arrays: [PassFrameArray]) {
        encoder.setRenderPipelineState(pipeline)
        var u = uniforms
        encoder.setFragmentBytes(&u, length: MemoryLayout<Config.Uniforms>.stride, index: 0)
        // Per-frame ARRAY uniforms (lightning's precomputed bolt polyline), bound as
        // fragment buffers at their declared indices. `setFragmentBytes` is fine here
        // (each array is well under the 4 KB inline limit). No-op for pure-shader
        // effects (the default `frameArrays` returns []).
        for a in arrays where !a.data.isEmpty {
            a.data.withUnsafeBytes { raw in
                encoder.setFragmentBytes(raw.baseAddress!, length: raw.count, index: a.bufferIndex)
            }
        }
        // Panel at texture(0); placeholder at the other slot a shader might declare
        // (e.g. an SDF at texture(1)). Over-binding is harmless for shaders that
        // declare fewer textures.
        encoder.setFragmentTexture(panel ?? placeholderTex, index: 0)
        encoder.setFragmentTexture(placeholderTex, index: 1)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.setFragmentSamplerState(sampler, index: 1)
        // Single full-screen triangle from vertex_id — no vertex buffers needed.
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }

    /// Render light (and shadow, if its encoder is provided) for `elapsedMs`.
    public func render(
        elapsedMs: Double,
        width: Float, height: Float, anchorPx: SIMD2<Float>,
        targetPx: SIMD2<Float> = .zero, dpr: Float,
        lightEncoder: MTLRenderCommandEncoder,
        shadowEncoder: MTLRenderCommandEncoder?,
        panel: MTLTexture? = nil
    ) {
        // "Animate on twos": snap the clock toward a coarse grid as style rises.
        let style = Double(standardStyle())
        let stepped = (elapsedMs / NPR_TIME_STEP_MS).rounded(.down) * NPR_TIME_STEP_MS
        let animMs = elapsedMs + (stepped - elapsedMs) * style
        let life = Swift.min(max(animMs, 0) / max(durationMs, 1), 1)
        let info = FrameInfo(animMs: animMs, life: life, elapsedMs: elapsedMs)
        let (amp, extras) = config.frame(info, params)

        // Per-frame array uniforms (CPU-precomputed geometry). Computed ONCE and
        // bound to both passes. `origin` is gl_FragCoord space (y-UP), matching the
        // `standard()` origin flip below, so the precompute lands where the shader reads.
        let originGl = SIMD2<Float>(anchorPx.x * dpr, height - anchorPx.y * dpr)
        let arrays = config.frameArrays(info, params, width: width, height: height, origin: originGl)

        if let se = shadowEncoder, let sp = shadowPipeline {
            let s = standard(info, amp: amp, width: width, height: height, anchorPx: anchorPx, targetPx: targetPx, dpr: dpr, isShadow: true)
            encodePass(se, pipeline: sp, uniforms: config.packUniforms(standard: s, params: params, extras: extras), panel: panel, arrays: arrays)
        }
        let s = standard(info, amp: amp, width: width, height: height, anchorPx: anchorPx, targetPx: targetPx, dpr: dpr, isShadow: false)
        encodePass(lightEncoder, pipeline: lightPipeline, uniforms: config.packUniforms(standard: s, params: params, extras: extras), panel: panel, arrays: arrays)
    }

    private func standardStyle() -> Float {
        if case let .number(v)? = params["style"] { return Float(v) }
        return 0
    }
}
#endif
