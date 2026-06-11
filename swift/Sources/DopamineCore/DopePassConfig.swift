// Generic DATA-DRIVEN pass config — the Swift mirror of the web
// `framework/dope-pass.ts` `dopePassConfig`.
//
// For a datafied effect the `.dope` carries everything the hand-written
// per-effect `PassConfig` used to: the per-frame logic (`tempo.frame`), the
// shadow height (`render.shadowHeightFrac`) and the runner config
// (`render.config.usesOrigin`). This type derives a whole `PassConfig` from
// that data + the two MSL function names + the GENERATED uniform packer — so
// the only hand-written Swift left for such an effect is its factory shell
// (and, for fail, the canvas-dependent `packExtras` hook).
//
// Per-frame extras are evaluated under their CANONICAL names ("sweep", "draw",
// "stamp", "shake", …) — exactly the keys the generated `pack<Name>Uniforms`
// packers read from the `extras` map (the web instead maps them to `u<Name>`
// uniform names; the Metal binding seam is the packed struct).
//
// The honest boundary stays honest: anything genuinely code-shaped (fail's
// canvas-size-dependent boxPx/sdfStrokePx defaults) is passed through the
// `packExtras` hook, the same seam `packUniforms` always was.
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
    /// -dependent values before packing (fail's boxPx / sdfStrokePx defaults).
    public typealias ExtrasHook = (StandardUniforms, [String: DopeValue], inout [String: Double]) -> Void

    public let vertexFunction: String
    public let fragmentFunction: String
    public let usesOrigin: Bool
    /// The continuous-loop period (`tempo.loop.periodMs`), nil for one-shots.
    /// The runner derives the standard `loopS`/`phase` clock uniforms from it.
    public let loopPeriodMs: Double?

    private let ampExpr: JSONValue
    private let extraExprs: [(String, JSONValue)]
    private let shadowSpec: JSONValue
    private let pack: Packer
    private let extrasHook: ExtrasHook?

    /// Derive the config from a datafied doc. Throws if the doc lacks
    /// `tempo.frame` or `render.shadowHeightFrac` (not a datafied effect) —
    /// the same posture as the web `dopePassConfig`.
    public init(
        doc: DopeDoc,
        vertexFunction: String,
        fragmentFunction: String,
        packUniforms: @escaping Packer,
        packExtras: ExtrasHook? = nil
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
        self.ampExpr = frame.amp
        self.extraExprs = frame.extras
        self.shadowSpec = shadow
        self.pack = packUniforms
        self.extrasHook = packExtras
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

    /// The generated packer, after the optional code-shaped extras top-up.
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
