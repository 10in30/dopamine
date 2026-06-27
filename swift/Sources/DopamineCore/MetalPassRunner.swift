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
    public var loopS: Float = 0                  // seconds within the current tempo.loop period
    public var phase: Float = 0                  // normalized loop phase [0, 1); 0 without a loop
    public var style: Float = 0
    public var amp: Float = 0
    public var c0: SIMD3<Float> = .zero
    public var c1: SIMD3<Float> = .zero
    public var c2: SIMD3<Float> = .zero
    public var shadow: Float = 0                 // 0 light pass, 1 shadow pass
    public var shadowOffset: SIMD2<Float> = .zero
    public var shadowSoft: Float = 0
    public var shadowStrength: Float = 0
    public var backdropLum: Float = 0            // backdrop luminance 0 dark .. 1 white (light-out boost)
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
    /// The seamless loop period in ms (`tempo.loop.periodMs`) for a CONTINUOUS
    /// effect; nil (the default) for one-shots. When set, the runner computes
    /// the standard periodic clock uniforms (`loopS`/`phase`) each frame and
    /// wraps the effect clock at `durationMs`, so a perpetually-ticking host
    /// loops seamlessly with no per-effect period plumbing.
    var loopPeriodMs: Double? { get }
    /// Whether the runner applies the style-driven "animate on twos" clock snap.
    /// Default true; a PANEL effect (`render.config.stepping: "none"`) returns
    /// false — the web panel runner never snaps (hand-drawn panel geometry
    /// would stutter), so the port converges on that.
    var snapsOnTwos: Bool { get }
    /// The fragment texture unit a supplied sprite PANEL binds at. Default 0 (the
    /// cross-platform panel slot); a PASS hybrid that ALSO carries a baked-SDF aux
    /// returns the sprite panel's declared `render.panel.texture` (e.g. 3) so the
    /// SDF keeps its own slot — the general sprite-panel-at-arbitrary-unit seam.
    var panelTextureUnit: Int { get }
    /// The baked-SDF aux textures the runner uploads (R8) + binds at their
    /// declared units, flipping each one's `on` extra to 1 (mirror of the web
    /// pass-runner's `kind:"sdf"` aux). Default: none (pure-shader effects bind
    /// nothing). Composes WITH `panelTextureUnit` so a PASS hybrid hosts both.
    func sdfAuxTextures() -> [DopeSdfAuxSpec]
    /// The shadow occluder "height" as a fraction of min canvas dim.
    func shadowHeightFrac(_ params: [String: DopeValue]) -> Double
    /// Compute the effect-specific time-varying values; MUST return `amp` (fed to
    /// the shadow geometry). Mirrors the web `frame()` hook.
    func frame(_ info: FrameInfo, _ params: [String: DopeValue]) -> (amp: Double, extras: [String: Double])
    /// PER-PASS extras (the web `passUniforms` seam): values computed once per
    /// frame from the live pass geometry (`targetMinDimPx` with the full-canvas
    /// fallback applied, the layer's `dpr`) and merged into the frame extras
    /// BEFORE `packUniforms` — the once-per-pass home of `render.pass`.
    /// Default: none.
    func passExtras(
        targetMinDimPx: Double, dpr: Double, params: [String: DopeValue]
    ) -> [String: Double]
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
    /// Default: a one-shot effect (no `tempo.loop`).
    var loopPeriodMs: Double? { nil }
    /// Default: the style-driven "animate on twos" snap applies.
    var snapsOnTwos: Bool { true }
    /// Default: pure-shader effects bind no extra arrays.
    func frameArrays(
        _ info: FrameInfo,
        _ params: [String: DopeValue],
        width: Float, height: Float, origin: SIMD2<Float>
    ) -> [PassFrameArray] { [] }
    /// Default: no per-pass extras.
    func passExtras(
        targetMinDimPx: Double, dpr: Double, params: [String: DopeValue]
    ) -> [String: Double] { [:] }
    /// Default: the sprite panel (if any) binds at the cross-platform slot 0.
    var panelTextureUnit: Int { 0 }
    /// Default: no baked-SDF aux textures.
    func sdfAuxTextures() -> [DopeSdfAuxSpec] { [] }
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
    /// Backdrop relative luminance (0 dark .. 1 white) the overlay composites
    /// against. Drives the light-out saturation/presence boost (`backdropLum`
    /// uniform); 0 ⇒ no boost ⇒ the dark look is unchanged. Set by the host.
    public var backdropLuminance: Double = 0

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
    // Baked-SDF aux textures (the `binding.samplers[].outline` sources), decoded
    // + uploaded once at build and bound at their declared units every pass. The
    // sprite panel binds at `config.panelTextureUnit`, so a PASS hybrid hosts the
    // panel AND these SDFs together. Pure-shader effects leave this empty.
    private let sdfAuxTextures: [(spec: DopeSdfAuxSpec, tex: MTLTexture)]
    /// The canonical `on`-extra names of every bound SDF aux (set to 1 in the
    /// extras map each frame so the generated packer flips the struct flag).
    private let sdfOnExtras: [String]

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

        // Baked-SDF aux textures (the `binding.samplers[].outline` sources): decode
        // the inline blob ONCE and upload it as an R8 single-channel texture, sized
        // size×size. Mirror of the web pass-runner's `kind:"sdf"` aux (uploaded
        // R8, edge-clamp linear via the shared sampler). A spec whose blob fails to
        // decode is skipped (the shader keeps its analytic fallback) rather than
        // aborting the whole runner build. The matching `on`-extra canonical names
        // are collected so `render` can flip each flag to 1 every frame.
        var decoded: [(spec: DopeSdfAuxSpec, tex: MTLTexture)] = []
        var onExtras: [String] = []
        for spec in config.sdfAuxTextures() {
            guard let sdf = decodeDopeSdf(spec.dataURI), sdf.size > 0 else { continue }
            let sd = MTLTextureDescriptor.texture2DDescriptor(
                pixelFormat: .r8Unorm, width: sdf.size, height: sdf.size, mipmapped: false)
            sd.usage = [.shaderRead]
            sd.storageMode = .shared
            guard let tex = device.makeTexture(descriptor: sd) else { continue }
            // 8 bits per pixel ⇒ bytesPerRow == size, no row padding needed.
            // Match the web pass-runner's `UNPACK_FLIP_Y_WEBGL = true` SDF upload
            // (pass-runner.ts): the single-source GLSL→MSL shader samples the SDF in
            // the SAME y-up vUv on every platform, so the baked field's row 0 must be
            // its BOTTOM row. Reverse the R8 rows here — otherwise the baked-SDF icon
            // (solarbloom's bloom mark, etc.) renders upside down relative to the rest
            // of the frame on BOTH iOS and macOS (the procedural look + panels are
            // unaffected). This is independent of the host view's geometry flip.
            let n = sdf.size
            var flipped = [UInt8](repeating: 0, count: n * n)
            sdf.bytes.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                let src = raw.bindMemory(to: UInt8.self)
                flipped.withUnsafeMutableBytes { (dstRaw: UnsafeMutableRawBufferPointer) in
                    let dst = dstRaw.bindMemory(to: UInt8.self)
                    for row in 0..<n {
                        let s = (n - 1 - row) * n, d = row * n
                        for col in 0..<n { dst[d + col] = src[s + col] }
                    }
                }
            }
            flipped.withUnsafeBytes { raw in
                tex.replace(region: MTLRegionMake2D(0, 0, n, n),
                            mipmapLevel: 0, withBytes: raw.baseAddress!, bytesPerRow: n)
            }
            decoded.append((spec, tex))
            if let on = spec.onExtra { onExtras.append(on) }
        }
        sdfAuxTextures = decoded
        sdfOnExtras = onExtras
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
        if let p = config.loopPeriodMs, p > 0 {
            // Standard periodic clocks for a looping effect, off the SAME snapped
            // clock as timeS (so the on-twos seam guarantee carries over).
            let loopMs = info.animMs.truncatingRemainder(dividingBy: p)
            s.loopS = Float(loopMs / 1000)
            s.phase = Float(loopMs / p)
        }
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
        s.backdropLum = Float(backdropLuminance)
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
        // Bind the placeholder at the two cross-platform slots a shader might
        // declare (texture(0) the panel slot, texture(1) an SDF aux) so every
        // declared `texture2d` arg is defined; over-binding is harmless for shaders
        // that declare fewer. The real bindings below then overwrite the slots that
        // actually carry data this frame.
        encoder.setFragmentTexture(placeholderTex, index: 0)
        encoder.setFragmentTexture(placeholderTex, index: 1)
        encoder.setFragmentSamplerState(sampler, index: 0)
        encoder.setFragmentSamplerState(sampler, index: 1)
        // Sprite panel at its DECLARED unit (`config.panelTextureUnit`, default 0):
        // a PASS hybrid that also carries a baked-SDF aux moves the panel off slot 0
        // so the SDF keeps its own unit — the general sprite-panel-at-arbitrary-unit
        // seam. When no panel is supplied the placeholder above stays at that slot.
        if let panel {
            encoder.setFragmentTexture(panel, index: config.panelTextureUnit)
            encoder.setFragmentSamplerState(sampler, index: config.panelTextureUnit)
        }
        // Baked-SDF aux textures at their declared units (the shared linear/clamp
        // sampler, matching the web's LINEAR/edge-clamp). Composes WITH the panel
        // above so a PASS hybrid hosts both in the SAME pass.
        for (spec, tex) in sdfAuxTextures {
            encoder.setFragmentTexture(tex, index: spec.unit)
            encoder.setFragmentSamplerState(sampler, index: spec.unit)
        }
        // Single full-screen triangle from vertex_id — no vertex buffers needed.
        encoder.drawPrimitives(type: .triangle, vertexStart: 0, vertexCount: 3)
    }

    /// Render the light pass (when `lightEncoder` is provided) and/or the shadow
    /// pass (when `shadowEncoder` is provided) for `elapsedMs`. Either may be nil so
    /// a host can drive them as separate render passes — e.g. shadow into an
    /// off-screen target, then light into the drawable — sequentially on one command
    /// buffer (Metal allows only one active encoder per command buffer at a time).
    public func render(
        elapsedMs: Double,
        width: Float, height: Float, anchorPx: SIMD2<Float>,
        targetPx: SIMD2<Float> = .zero, dpr: Float,
        lightEncoder: MTLRenderCommandEncoder?,
        shadowEncoder: MTLRenderCommandEncoder?,
        panel: MTLTexture? = nil
    ) {
        // CONTINUOUS effects: wrap the clock at durationMs — the runner-level
        // re-arm. The tempo.loop contract guarantees t == durationMs renders as
        // t == 0, so a host that keeps ticking loops seamlessly forever (and the
        // clock stays small, preserving float precision in the shader).
        var elapsedMs = elapsedMs
        if config.loopPeriodMs != nil, durationMs > 0, elapsedMs > 0 {
            elapsedMs = elapsedMs.truncatingRemainder(dividingBy: durationMs)
        }
        // "Animate on twos": snap the clock toward a coarse grid as style rises.
        // Panel effects (`render.config.stepping: "none"`) never snap — the web
        // panel runner doesn't, and hand-drawn panel geometry would stutter.
        let style = Double(standardStyle())
        let stepped = (elapsedMs / NPR_TIME_STEP_MS).rounded(.down) * NPR_TIME_STEP_MS
        let animMs = config.snapsOnTwos ? elapsedMs + (stepped - elapsedMs) * style : elapsedMs
        let life = Swift.min(max(animMs, 0) / max(durationMs, 1), 1)
        let info = FrameInfo(animMs: animMs, life: life, elapsedMs: elapsedMs)
        let (amp, frameExtras) = config.frame(info, params)
        var extras = frameExtras

        // Flip every bound SDF aux's `on` flag to 1 (keyed by its CANONICAL extra
        // name — the same key the generated packer reads). A decoded+bound SDF means
        // the shader should sample the texture instead of taking its analytic
        // fallback; the web sets the same `on` uniform to 1 on bind.
        for on in sdfOnExtras { extras[on] = 1 }

        // PER-PASS extras (`render.pass` / the web `passUniforms` seam): computed
        // once from the live pass geometry and merged in BEFORE packUniforms (a
        // config's own extras hook may still override them downstream).
        let targetW = targetPx.x > 0 ? targetPx.x * dpr : width
        let targetH = targetPx.y > 0 ? targetPx.y * dpr : height
        for (k, v) in config.passExtras(
            targetMinDimPx: Double(Swift.min(targetW, targetH)), dpr: Double(dpr), params: params
        ) {
            extras[k] = v
        }

        // Per-frame array uniforms (CPU-precomputed geometry). Computed ONCE and
        // bound to both passes. `origin` is gl_FragCoord space (y-UP), matching the
        // `standard()` origin flip below, so the precompute lands where the shader reads.
        let originGl = SIMD2<Float>(anchorPx.x * dpr, height - anchorPx.y * dpr)
        let arrays = config.frameArrays(info, params, width: width, height: height, origin: originGl)

        if let se = shadowEncoder, let sp = shadowPipeline {
            let s = standard(info, amp: amp, width: width, height: height, anchorPx: anchorPx, targetPx: targetPx, dpr: dpr, isShadow: true)
            encodePass(se, pipeline: sp, uniforms: config.packUniforms(standard: s, params: params, extras: extras), panel: panel, arrays: arrays)
        }
        if let le = lightEncoder {
            let s = standard(info, amp: amp, width: width, height: height, anchorPx: anchorPx, targetPx: targetPx, dpr: dpr, isShadow: false)
            encodePass(le, pipeline: lightPipeline, uniforms: config.packUniforms(standard: s, params: params, extras: extras), panel: panel, arrays: arrays)
        }
    }

    private func standardStyle() -> Float {
        if case let .number(v)? = params["style"] { return Float(v) }
        return 0
    }
}
#endif
