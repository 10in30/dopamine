// Generic DATA-DRIVEN pass config — the Swift mirror of the web
// `framework/dope-pass.ts` `dopePassConfig`.
//
// For a datafied effect the `.dope` carries everything the hand-written
// per-effect `PassConfig` used to: the per-frame logic (`tempo.frame`), the
// shadow height (`render.shadowHeightFrac`), the per-pass uniforms
// (`render.pass`, evaluated against the live target geometry in
// `packUniforms`) and the runner config (`render.config.usesOrigin`). This
// type derives a whole `PassConfig` from that data + the two MSL function
// names + the GENERATED uniform packer — so a fully declarative effect ships
// NO hand-written Swift at all (the factory shell is toolchain-generated).
//
// Per-frame extras are evaluated under their CANONICAL names ("sweep", "draw",
// "stamp", "shake", …) — exactly the keys the generated `pack<Name>Uniforms`
// packers read from the `extras` map (the web instead maps them to `u<Name>`
// uniform names; the Metal binding seam is the packed struct).
//
// The honest boundary stays honest: anything genuinely code-shaped (a
// host/canvas-dependent extras top-up) can still ride the `packExtras` hook,
// the same seam `packUniforms` always was — it runs AFTER the declarative
// `render.pass` values, so a hook may override them.
//
// macOS/iOS ONLY (`#if canImport(Metal)`): `PassConfig` is the Metal runner's
// protocol. The portable evaluator it calls (FrameExpr.swift) builds — and is
// parity-tested — on Linux.

#if canImport(Metal)

/// A `PassConfig` derived entirely from a datafied `.dope` document.
public struct DopePassConfig<U>: PassConfig {
    public typealias Uniforms = U
    /// The generated `pack<Name>Uniforms(standard:params:extras:)` packer.
    public typealias Packer = (StandardUniforms, [String: DopeValue], [String: Double]) -> U
    /// Optional code-shaped hook: top up the frame extras with host/canvas
    /// -dependent values before packing (runs after the declarative
    /// `render.pass` evaluation, so it may override).
    public typealias ExtrasHook = (StandardUniforms, [String: DopeValue], inout [String: Double]) -> Void
    /// Optional code-shaped hook: CPU-precompute the per-frame ARRAYS the
    /// shader reads as fragment BUFFERS (the `binding.arrays` contract — e.g.
    /// lightning's bolt polyline from the generated `<Name>Renderer`). Same
    /// posture as `packExtras`: the genuinely code-shaped seam `PassConfig`
    /// always had, threaded through the data-driven config.
    public typealias FrameArraysHook = (FrameInfo, [String: DopeValue], Float, Float, SIMD2<Float>) -> [PassFrameArray]

    public let vertexFunction: String
    public let fragmentFunction: String
    public let usesOrigin: Bool
    /// The continuous-loop period (`tempo.loop.periodMs`), nil for one-shots.
    /// The runner derives the standard `loopS`/`phase` clock uniforms from it.
    public let loopPeriodMs: Double?
    /// `render.config.stepping: "none"` ⇒ no "animate on twos" snap (the web
    /// panel-runner semantics, declared in the data).
    public let snapsOnTwos: Bool

    private let ampExpr: JSONValue
    private let extraExprs: [(String, JSONValue)]
    private let shadowSpec: JSONValue
    private let passSpec: DopePassSpec?
    private let pack: Packer
    private let extrasHook: ExtrasHook?
    private let frameArraysHook: FrameArraysHook?

    /// Derive the config from a datafied doc. Throws if the doc lacks
    /// `tempo.frame` or `render.shadowHeightFrac` (not a datafied effect) —
    /// the same posture as the web `dopePassConfig`.
    public init(
        doc: DopeDoc,
        vertexFunction: String,
        fragmentFunction: String,
        packUniforms: @escaping Packer,
        packExtras: ExtrasHook? = nil,
        frameArrays: FrameArraysHook? = nil
    ) throws {
        guard let frame = doc.frame else {
            throw DopeError.notDatafied("\(doc.id) has no tempo.frame (not a datafied effect)")
        }
        guard let shadow = doc.shadowHeightFrac else {
            throw DopeError.notDatafied("\(doc.id) has no render.shadowHeightFrac (not a datafied effect)")
        }
        self.vertexFunction = vertexFunction
        self.fragmentFunction = fragmentFunction
        self.usesOrigin = doc.usesOrigin ?? false
        self.loopPeriodMs = doc.loop?.periodMs
        self.snapsOnTwos = doc.stepping != "none"
        self.ampExpr = frame.amp
        self.extraExprs = frame.extras
        self.shadowSpec = shadow
        self.passSpec = doc.renderPass
        self.pack = packUniforms
        self.extrasHook = packExtras
        self.frameArraysHook = frameArrays
    }

    /// The per-frame ARRAYS (fragment buffers): the code-shaped hook when the
    /// effect has one, else the protocol default (none).
    public func frameArrays(
        _ info: FrameInfo, _ params: [String: DopeValue],
        width: Float, height: Float, origin: SIMD2<Float>
    ) -> [PassFrameArray] {
        frameArraysHook?(info, params, width, height, origin) ?? []
    }

    /// `render.shadowHeightFrac` — a bare number passes through; an expression
    /// is params-only. The doc was validated at init, so an eval failure here
    /// (a missing/non-numeric param) is a data bug the parity grid gates;
    /// degrade to 0 rather than crash the render loop.
    public func shadowHeightFrac(_ params: [String: DopeValue]) -> Double {
        (try? evalParamExpr(shadowSpec, params)) ?? 0
    }

    /// `tempo.frame` — amp + every extras entry, evaluated against the live
    /// clocks + resolved params (extras keyed by canonical name). The loop
    /// clocks (0 without `tempo.loop`) use the SAME formula the runner uses
    /// for the `loopS`/`phase` uniforms, so a `{input:"phase"}` amp matches
    /// the shader.
    public func frame(_ info: FrameInfo, _ params: [String: DopeValue]) -> (amp: Double, extras: [String: Double]) {
        let loopMs = loopPeriodMs.map { info.animMs.truncatingRemainder(dividingBy: $0) } ?? 0
        let ctx = FrameExprCtx(
            animMs: info.animMs, life: info.life, elapsedMs: info.elapsedMs,
            loopS: loopMs / 1000, phase: loopPeriodMs.map { loopMs / $0 } ?? 0,
            params: params)
        let amp = (try? evalFrameExpr(ampExpr, ctx)) ?? 0
        var extras: [String: Double] = [:]
        for (name, expr) in extraExprs {
            extras[name] = (try? evalFrameExpr(expr, ctx)) ?? 0
        }
        return (amp, extras)
    }

    /// Per-PASS uniforms (`render.pass`), evaluated on the runner's
    /// once-per-pass seam — the runner supplies the live target geometry
    /// (full-canvas fallback applied) + the layer's `dpr`, and merges the
    /// result into the frame extras before `packUniforms`.
    public func passExtras(
        targetMinDimPx: Double, dpr: Double, params: [String: DopeValue]
    ) -> [String: Double] {
        guard let pass = passSpec else { return [:] }
        var out: [String: Double] = [:]
        for (name, value) in pass.evaluate(targetMinDimPx: targetMinDimPx, dpr: dpr, params: params) {
            out[name] = value
        }
        return out
    }

    /// The generated packer, after the optional code-shaped extras hook (which
    /// runs LAST, so it may override the declarative `render.pass` values the
    /// runner already merged into `extras`).
    public func packUniforms(
        standard: StandardUniforms,
        params: [String: DopeValue],
        extras: [String: Double]
    ) -> U {
        var ex = extras
        extrasHook?(standard, params, &ex)
        return pack(standard, params, ex)
    }
}
#endif

// A DATA-DRIVEN config for a PASS hybrid that hosts BOTH a dynamic sprite panel
// AND one or more baked-SDF aux textures — the general seam solarbloom needs
// (its motes ride a sprite panel; its checkmark is a baked SDF). It is the PASS
// analog of `DopePanelPassConfig`: it wraps a `DopePassConfig`, conforms to
// `PanelDrawing` (so `MetalOverlayHost` draws + uploads the sprite panel every
// tick) AND surfaces the data-declared `panelTextureUnit` + `sdfAux` to the
// runner — so the panel binds at its ARBITRARY declared unit while each SDF keeps
// its own. The panel UNIT and the SDF aux come from the `doc` (the data drives
// them); only the per-frame Core Graphics panel draw is the code-shaped seam.
//
// Guarded like `DopePanelPassConfig` (it needs CGContext): macOS/iOS only.
#if canImport(Metal) && canImport(QuartzCore)
import CoreGraphics

public struct DopeSpritePanelPassConfig<U>: PassConfig, PanelDrawing {
    public typealias Uniforms = U
    /// The hand-written per-effect panel draw (CGContext is top-left/y-down,
    /// matching the web Canvas2D space the host pre-flips to).
    public typealias DrawPanel = (CGContext, CGSize, [String: DopeValue], PanelFrame) -> Void

    private let base: DopePassConfig<U>
    private let draw: DrawPanel
    /// The sprite panel's declared texture unit (`render.panel.texture`); default
    /// 0 when the doc leaves it unset.
    public let panelTextureUnit: Int
    /// The baked-SDF aux textures (`binding.samplers[].outline`) the runner uploads.
    private let sdfAux: [DopeSdfAuxSpec]

    public init(
        doc: DopeDoc,
        vertexFunction: String,
        fragmentFunction: String,
        packUniforms: @escaping DopePassConfig<U>.Packer,
        drawPanel: @escaping DrawPanel
    ) throws {
        self.base = try DopePassConfig(
            doc: doc,
            vertexFunction: vertexFunction,
            fragmentFunction: fragmentFunction,
            packUniforms: packUniforms
        )
        self.draw = drawPanel
        self.panelTextureUnit = doc.panelTextureUnit ?? 0
        self.sdfAux = doc.sdfAux
    }

    // PassConfig — forwarded to the data-driven base, plus the panel-unit + SDF-aux
    // seams the runner reads.
    public var vertexFunction: String { base.vertexFunction }
    public var fragmentFunction: String { base.fragmentFunction }
    public var usesOrigin: Bool { base.usesOrigin }
    public var loopPeriodMs: Double? { base.loopPeriodMs }
    public var snapsOnTwos: Bool { base.snapsOnTwos }
    public func sdfAuxTextures() -> [DopeSdfAuxSpec] { sdfAux }
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
    public func frameArrays(
        _ info: FrameInfo, _ params: [String: DopeValue],
        width: Float, height: Float, origin: SIMD2<Float>
    ) -> [PassFrameArray] {
        base.frameArrays(info, params, width: width, height: height, origin: origin)
    }

    // PanelDrawing — the code-shaped seam. `panelSizePx` keeps the protocol
    // default (the full canvas — the mote panel covers the whole screen).
    public func drawPanel(_ ctx: CGContext, sizePx: CGSize, params: [String: DopeValue], frame: PanelFrame) {
        draw(ctx, sizePx, params, frame)
    }
}
#endif
