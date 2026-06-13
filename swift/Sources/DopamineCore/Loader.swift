// `.dope` effect loader — direct port of `framework/loader.ts`.
//
// Parses a `.dope` JSON document and evaluates its `controls → render.params`
// mapping grammar, the OKLCH golden-angle palette, and the per-mood baseline
// table into the SAME flat render-param bag the engine consumes.
//
// The load-bearing invariant (correctness anchor): the PRNG is consumed in the
// SAME order as the legacy resolve* — `buildPalette` draws the base hue first
// (one rng() inside it), then the per-fire scatter (rng() * 1000). So a pinned
// seed reproduces the web output byte-for-byte; the parity test asserts this
// across a mood × intensity × whimsy × seed grid.
//
// The grammar is tiny + non-Turing-complete (no loops, no user functions), so
// it is safe to evaluate from an untrusted file and trivial to port.

import Foundation

@inline(__always)
private func clamp01_(_ x: Double) -> Double { x < 0 ? 0 : (x > 1 ? 1 : x) }
@inline(__always)
private func lerp_(_ a: Double, _ b: Double, _ t: Double) -> Double { a + (b - a) * clamp01_(t) }

// MARK: - Mapping mini-grammar (§4.1) — an expression tree.

/// A grammar node. Mirrors the TS `ExprNode` union; decoded from arbitrary JSON.
public indirect enum ExprNode {
    case number(Double)
    case const(Double)
    case control(String)
    case baseline(String)
    case lerp(String, Double, Double)
    case mul([ExprNode])
    case add([ExprNode])
    case sub([ExprNode])
    case round(ExprNode)
    case floor(ExprNode)
    // Extensions (§10): mix/max/min, used by typography curves.
    case mix(ExprNode, ExprNode, String)  // a + (b-a)*clamp01(control)
    case max([ExprNode])
    case min([ExprNode])
}

/// Evaluation context for the grammar.
public struct EvalCtx {
    public var controls: [String: Double]
    public var baseline: [String: Double]
    public var consts: [String: Double]
    public init(controls: [String: Double], baseline: [String: Double], consts: [String: Double]) {
        self.controls = controls; self.baseline = baseline; self.consts = consts
    }
}

public enum DopeError: Error, CustomStringConvertible {
    case unknownBaseline(String)
    case unknownNode(String)
    case badMagic(String)
    case unsupportedVersion(String)
    case missingSections
    case externalReference(String)
    case noBaselines
    /// The doc lacks a P2 datafied section a data-driven consumer needs
    /// (`binding.scatterKey` / `tempo.frame` / `render.shadowHeightFrac`).
    case notDatafied(String)
    /// A `tempo.loop` block that breaks the seam invariants (message mirrors
    /// the web parser's).
    case invalidLoop(String)

    public var description: String {
        switch self {
        case let .unknownBaseline(n): return "dope: unknown baseline \"\(n)\""
        case let .unknownNode(n): return "dope: unknown expr node \(n)"
        case let .badMagic(f): return "dope: not a Dopamine effect document (fmt=\"\(f)\")"
        case let .unsupportedVersion(v): return "dope: unsupported format version \"\(v)\""
        case .missingSections: return "dope: document missing render.params / palette.perMood / baselines"
        case let .externalReference(v): return "dope: external asset reference is not allowed: \"\(v)\""
        case .noBaselines: return "dope: document has no baselines to resolve a mood against"
        case let .notDatafied(m): return "dope: \(m)"
        case let .invalidLoop(m): return "dope: \(m)"
        }
    }
}

/// Evaluate a grammar node to a number. Pure; matches `evalExpr` arithmetic.
public func evalExpr(_ node: ExprNode, _ ctx: EvalCtx) throws -> Double {
    switch node {
    case let .number(n): return n
    case let .const(n): return n
    case let .control(name): return clamp01_(ctx.controls[name] ?? 0)
    case let .baseline(name):
        guard let v = ctx.baseline[name] else { throw DopeError.unknownBaseline(name) }
        return v
    case let .lerp(c, a, b):
        return lerp_(a, b, ctx.controls[c] ?? 0)
    case let .mul(ns):
        return try ns.reduce(1.0) { try $0 * evalExpr($1, ctx) }
    case let .add(ns):
        return try ns.reduce(0.0) { try $0 + evalExpr($1, ctx) }
    case let .sub(ns):
        let parts = try ns.map { try evalExpr($0, ctx) }
        guard let first = parts.first else { return 0 }
        return parts.dropFirst().reduce(first, -)
    case let .round(n):
        // JS Math.round: round half toward +Infinity (NOT Swift's .toNearestOrAwayFromZero).
        return jsRound(try evalExpr(n, ctx))
    case let .floor(n):
        return (try evalExpr(n, ctx)).rounded(.down)
    case let .mix(a, b, c):
        let va = try evalExpr(a, ctx)
        let vb = try evalExpr(b, ctx)
        return va + (vb - va) * clamp01_(ctx.controls[c] ?? 0)
    case let .max(ns):
        return try ns.map { try evalExpr($0, ctx) }.max() ?? -Double.infinity
    case let .min(ns):
        return try ns.map { try evalExpr($0, ctx) }.min() ?? Double.infinity
    }
}

/// JS `Math.round` semantics: half rounds toward +Infinity (so round(-0.5) == 0,
/// round(0.5) == 1, round(2.5) == 3). Swift's `.rounded()` rounds half away from
/// zero, which differs for negatives — match JS exactly for parity.
@inline(__always)
func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

// MARK: - Document model.

public struct DopeParamSpec {
    public var type: String?      // "float" | "int"
    public var from: ExprNode
    public var clamp01: Bool
    public var clampMax: String?
    public var clampMin: String?
}

public struct PaletteRegister {
    public var hueCenter: Double
    public var hueRange: Double
    public var lightness: Double
    public var chroma: Double
}

public struct DopePalette {
    public var hueSpread: Double
    public var chromaFrom: ExprNode
    public var perMood: [String: PaletteRegister]
}

/// The per-frame logic spec (`tempo.frame`): the datafied form of an effect's
/// hand-written `frame()` hook (mirror of the web `DopeFrameSpec`). `amp` feeds
/// the shadow geometry; `extras` are keyed by the CANONICAL extra name
/// (matching `binding.extras[].name` — the same names the generated Metal
/// packers read), in authored order. Both are RAW expression trees evaluated by
/// `evalFrameExpr` — no decode step, matching the web posture.
public struct DopeFrameSpec {
    public var amp: JSONValue
    public var extras: [(String, JSONValue)]
}

/// The reduced-motion peak/hold (`tempo.reducedMotion`) the factories used to
/// hardcode: ramp to a calm peak over `peakMs`, hold a static frame `holdMs`.
public struct DopeReducedMotion: Equatable {
    public var peakMs: Double
    public var holdMs: Double
}

/// The continuous-loop contract (`tempo.loop`), mirror of the web
/// `DopeLoopSpec`: the effect repeats seamlessly with period `periodMs`.
/// `parseDope` validates the seam invariants (the period tiles the
/// "animate on twos" grid unless `snapAligned` is false, and every baseline
/// `durationMs` is a whole number of periods); the runner derives the standard
/// periodic clocks (`loopS`/`phase` → the packed `loopS`/`phase` uniforms)
/// from it each frame.
public struct DopeLoopSpec: Equatable {
    public var periodMs: Double
    public var snapAligned: Bool
    public init(periodMs: Double, snapAligned: Bool = true) {
        self.periodMs = periodMs
        self.snapAligned = snapAligned
    }
}

/// One per-frame/host-filled extra in the binding contract (`binding.extras[]`),
/// by canonical name; `web` is the web uniform it binds to (the Metal struct
/// field is generated from the same entry at build time).
public struct DopeBindingExtra: Equatable {
    public var name: String
    public var type: String?
    public var web: String?
}

/// One texture sampler in the binding contract (`binding.samplers[]`), mirror
/// of the web `DopeSampler`. Beyond the binding names, a sampler may declare a
/// DECLARATIVE SDF source: `outline` names a `geometry.outlines` entry whose
/// baked SDF backs it (bound as an aux texture on web; the native runtimes
/// keep their analytic fallback) and `on` names the `binding.extras` flag the
/// binder flips to 1 when the texture is bound (0 = the analytic path).
public struct DopeBindingSampler: Equatable {
    /// The web sampler uniform name (e.g. `uSdfTex`).
    public var web: String
    /// The canonical/MSL argument name (e.g. `sdfTex`).
    public var name: String?
    /// The texture unit it binds at (texture(0) is the panel slot).
    public var texture: Int?
    /// A `geometry.outlines` key whose baked SDF backs this sampler.
    public var outline: String?
    /// The canonical `binding.extras` name of the sampler's "on" flag.
    public var on: String?
}

/// A baked-SDF aux texture the native PASS runner uploads + binds, derived from
/// a `binding.samplers[]` entry that declares an `outline` source. The cross-
/// platform analog of the web pass-runner's `kind:"sdf"` aux texture: the runner
/// `decodeDopeSdf(dataURI)`s the inline blob, uploads it as an R8 texture, binds
/// it at `unit`, and flips the sampler's `on` extra to 1. This is the GENERAL
/// SDF-aux seam (any effect with a baked outline gets it), driven by the data.
public struct DopeSdfAuxSpec: Equatable {
    /// The texture unit it binds at (the sampler's declared `texture`).
    public let unit: Int
    /// The raw inline SDF `data:` URI (decoded at runner build time).
    public let dataURI: String
    /// The canonical/MSL sampler argument name (e.g. `sdfTex`).
    public let sampler: String
    /// The sampler's `on`-flag uniform name on WEB (e.g. `uSdfOn`) — for the
    /// toolchain factory generator's reference; the runner uses `onExtra`.
    public let onUniformWeb: String?
    /// The CANONICAL `binding.extras` name of the sampler's "on" flag (e.g.
    /// `sdfOn`) — the key the runner sets to 1 in the extras map so the generated
    /// packer flips the struct field on.
    public let onExtra: String?
    public init(unit: Int, dataURI: String, sampler: String,
                onUniformWeb: String?, onExtra: String?) {
        self.unit = unit
        self.dataURI = dataURI
        self.sampler = sampler
        self.onUniformWeb = onUniformWeb
        self.onExtra = onExtra
    }
}

/// The cross-platform uniform-binding contract (mirror of the web
/// `DopeBinding`). SHIPS in the portable doc: the runtime derives which
/// resolved params bind to which shader uniforms from it (the Metal struct
/// codegen consumes it too, at build time).
public struct DopeBinding {
    /// `render.params` (or resolved-bag) names that are NOT shader uniforms.
    public var excludeParams: [String]
    /// The per-fire seed-keyed scatter field (auroraSeed / inkSeed / …).
    public var scatterKey: String?
    /// The web uniform the scatter binds to (absent = not a shader uniform).
    public var scatterWeb: String?
    /// Per-frame/host extras (filled by `tempo.frame.extras` or host hooks).
    public var extras: [DopeBindingExtra]
    /// Texture samplers the shader reads (see {@link DopeBindingSampler}).
    public var samplers: [DopeBindingSampler] = []
}

/// The PER-PASS uniform spec (`render.pass`), mirror of the web derivation:
/// expressions keyed by CANONICAL extra name (matching `binding.extras[].name`
/// — the same names the generated Metal packers read), evaluated ONCE per pass
/// by `evalPassExpr` over the resolved params + the pass-geometry inputs.
/// `sdfRange`/`sdfViewBoxW` carry the declared metadata of the first sampler
/// with an `outline` source (0 when none) — readable portably from the doc,
/// whether or not the platform binds the SDF bitmap.
public struct DopePassSpec {
    /// (canonical extra name, raw expression), authored order.
    public var entries: [(String, JSONValue)]
    /// The backing SDF's declared `range` (0 when no sampler declares one).
    public var sdfRange: Double
    /// The backing SDF's `viewBox[2]` author-units width (0 when absent).
    public var sdfViewBoxW: Double

    /// Evaluate every entry for one pass. The doc was validated at parse, so
    /// an eval failure here is a data bug the dope-config tests gate; degrade
    /// to 0 rather than crash the render loop (same posture as `frame`).
    /// `dpr` is the layer's content scale (the web `devicePixelRatio`).
    public func evaluate(
        targetMinDimPx: Double, dpr: Double = 1, params: [String: DopeValue]
    ) -> [(String, Double)] {
        let pass = PassExprInputs(
            targetMinDimPx: targetMinDimPx, sdfRange: sdfRange, sdfViewBoxW: sdfViewBoxW, dpr: dpr)
        return entries.map { ($0.0, (try? evalPassExpr($0.1, params, pass)) ?? 0) }
    }
}

/// A `.dope` document (the parts the loader consumes — others are ignored). The
/// raw ordered JSON is retained so effect code can read free-form `content` /
/// `geometry` sections (the data spine carries more than the loader needs).
public struct DopeDoc {
    public var fmt: String
    public var v: String
    public var id: String
    public var palette: DopePalette
    public var durationMs: DopeParamSpec?
    public var renderParams: [(String, DopeParamSpec)]  // authored order preserved
    public var baselines: [String: [String: Double]]
    /// Mood keys in their authored order (so the default-mood fallback is stable).
    public var baselineOrder: [String]
    /// Declared default mood from `controls.mood.default`, if any.
    public var controlsMoodDefault: String?
    // ── P2 — the datafied per-frame logic + binding contract. All OPTIONAL: a
    //         doc without them (a not-yet-datafied effect) still parses. ──
    /// Per-frame logic (`tempo.frame`): amp + extras as raw frame-expression trees.
    public var frame: DopeFrameSpec?
    /// Continuous-loop contract (`tempo.loop`), validated at parse time.
    public var loop: DopeLoopSpec?
    /// Reduced-motion peak/hold (`tempo.reducedMotion`).
    public var reducedMotion: DopeReducedMotion?
    /// Shadow occluder height (`render.shadowHeightFrac`): a bare number or a
    /// PARAMS-ONLY frame expression (evaluate via `evalParamExpr`).
    public var shadowHeightFrac: JSONValue?
    /// Per-PASS uniforms (`render.pass`), evaluated once per pass.
    public var renderPass: DopePassSpec? = nil
    /// Loop-cap consts (`render.consts`) the mapping's clampMax/clampMin reference.
    public var consts: [String: Double]
    /// Runner config (`render.config.usesOrigin`): whether the shader reads `uOrigin`.
    public var usesOrigin: Bool?
    /// Runner config (`render.config.stepping`): `"none"` ⇒ the clock NEVER
    /// snaps "on twos" (the Canvas2D-panel runner semantics, web-canonical for
    /// panel effects); nil ⇒ the default style-driven snap.
    public var stepping: String? = nil
    /// The uniform-binding contract (`binding`), when the doc ships one.
    public var binding: DopeBinding?
    /// The sprite-panel sampler name (`render.panel.sampler`), when the doc
    /// declares a dynamic sprite panel; nil for non-panel / pure-shader effects.
    public var panelSampler: String? = nil
    /// The texture unit the sprite panel binds at (`render.panel.texture`);
    /// nil ⇒ the default panel slot (texture(0)).
    public var panelTextureUnit: Int? = nil
    /// The baked-SDF aux textures the native PASS runner uploads + binds (one per
    /// `binding.samplers[]` entry with an `outline` source). Empty when none.
    public var sdfAux: [DopeSdfAuxSpec] = []
    /// The raw ordered JSON (for `content` / `geometry` consumers).
    public var raw: JSONValue
}

// MARK: - Default-mood resolution (mirrors `defaultMoodKey` / `resolveMoodKey`).

public func defaultMoodKey(_ doc: DopeDoc) throws -> String {
    if let declared = doc.controlsMoodDefault, doc.baselines[declared] != nil {
        return declared
    }
    // Pick the FIRST authored baseline mood (matches `Object.keys(...)[0]`).
    guard let first = doc.baselineOrder.first else { throw DopeError.noBaselines }
    return first
}

func resolveMoodKey(_ doc: DopeDoc, _ mood: String) throws -> String {
    doc.baselines[mood] != nil ? mood : try defaultMoodKey(doc)
}

// MARK: - Resolve.

public struct DopeResolveInput {
    public var mood: String
    public var intensity: Double
    public var whimsy: Double
    public var seed: UInt32
    public init(mood: String, intensity: Double, whimsy: Double, seed: UInt32) {
        self.mood = mood; self.intensity = intensity; self.whimsy = whimsy; self.seed = seed
    }
}

/// A resolved value in the flat bag: a scalar, the palette (3 RGB stops), or a
/// string (e.g. the per-mood typography face / font stack). The string case is
/// ADDITIVE — every existing consumer matches `.number` / `.palette` explicitly
/// (no exhaustive switch), so a string value is simply ignored by the uniform
/// auto-bind and the parity grid.
public enum DopeValue: Equatable {
    case number(Double)
    case palette([RGB])
    case string(String)
}

func applyFlags(_ v0: Double, _ spec: DopeParamSpec, _ consts: [String: Double]) -> Double {
    var v = v0
    if spec.clamp01 { v = clamp01_(v) }
    if let cm = spec.clampMax { v = Swift.min(v, consts[cm] ?? .infinity) }
    if let cm = spec.clampMin { v = Swift.max(v, consts[cm] ?? -.infinity) }
    return v
}

/// Resolve a `.dope` doc + a feeling into the flat render-param bag (palette,
/// style, durationMs, seed, scatter offset, and every `render.params` entry).
/// `scatterKey` is the legacy name for the per-fire scatter offset (`moteSeed`).
///
/// RNG order (the parity anchor): baseHue via buildPalette FIRST, then the
/// scatter `rng() * 1000` — identical to the web `resolveDopeParams`.
public func resolveDopeParams(
    _ doc: DopeDoc,
    _ input: DopeResolveInput,
    consts: [String: Double],
    scatterKey: String,
    paletteOverride: [OKLCH]? = nil
) throws -> [String: DopeValue] {
    let i = clamp01_(input.intensity)
    let w = clamp01_(input.whimsy)
    let moodKey = try resolveMoodKey(doc, input.mood)
    guard let baseline = doc.baselines[moodKey] else { throw DopeError.unknownBaseline(moodKey) }
    let rng = mulberry32(input.seed)

    let ctx = EvalCtx(controls: ["intensity": i, "whimsy": w], baseline: baseline, consts: consts)

    var out: [String: DopeValue] = [
        "seed": .number(Double(input.seed)),
        "style": .number(w),
    ]

    // durationMs (tempo)
    if let dms = doc.durationMs {
        out["durationMs"] = .number(applyFlags(try evalExpr(dms.from, ctx), dms, consts))
    }

    // render.params (insertion order; `style` is the raw whimsy, set above)
    for (name, spec) in doc.renderParams {
        if name == "style" { continue }
        out[name] = .number(applyFlags(try evalExpr(spec.from, ctx), spec, consts))
    }

    // Palette FIRST (consumes one rng() for the base hue inside buildPalette).
    let reg = try doc.palette.perMood[moodKey] ?? doc.palette.perMood[defaultMoodKey(doc)]!
    // chroma.from is evaluated with the palette register AS the baseline (matches
    // the web: `{ ...ctx, baseline: reg }`).
    let regBaseline: [String: Double] = [
        "hueCenter": reg.hueCenter, "hueRange": reg.hueRange,
        "lightness": reg.lightness, "chroma": reg.chroma,
    ]
    let chroma = try evalExpr(doc.palette.chromaFrom, EvalCtx(controls: ctx.controls, baseline: regBaseline, consts: consts))
    let generated = buildPalette(rng, PaletteParams(
        lightness: reg.lightness, chroma: chroma,
        hueCenter: reg.hueCenter, hueRange: reg.hueRange,
        hueSpread: doc.palette.hueSpread
    ))
    out["palette"] = .palette(paletteOverride.map { $0.map(oklchToLinearSrgb) } ?? generated)

    // THEN the per-fire scatter offset (same rng() * 1000 as the engine).
    out[scatterKey] = .number(rng() * 1000)

    return out
}

/// Resolve a DATAFIED `.dope` doc + a feeling: the consts come from the doc's
/// own `render.consts` and the scatter key from `binding.scatterKey` — the
/// mirror of the web `registerDopeEffect` resolve, so a datafied effect's
/// factory needs no hand-written consts/scatterKey literals. Throws if the doc
/// ships no `binding.scatterKey` (not a datafied effect).
public func resolveDopeParams(
    _ doc: DopeDoc,
    _ input: DopeResolveInput,
    paletteOverride: [OKLCH]? = nil
) throws -> [String: DopeValue] {
    guard let scatterKey = doc.binding?.scatterKey else {
        throw DopeError.notDatafied("\(doc.id) has no binding.scatterKey")
    }
    var bag = try resolveDopeParams(
        doc, input, consts: doc.consts, scatterKey: scatterKey, paletteOverride: paletteOverride)
    // Fold in the `.dope` TYPOGRAPHY table (letter effects like comic) so a
    // generated factory shell needs no bespoke compose step — additive, and a
    // no-op for an effect that declares no `typography` (numeric/palette path
    // untouched). The web composes the same fields on top of the loader bag.
    for (k, v) in resolveTypography(doc, mood: input.mood, intensity: input.intensity, whimsy: input.whimsy) {
        bag[k] = v
    }
    return bag
}
