// Per-FRAME expression evaluator — direct port of `framework/frame-expr.ts`.
//
// The resolve-time grammar (`Loader.swift` `evalExpr`) maps a feeling into the
// resolved param bag ONCE per fire. This module is its per-frame sibling: it
// evaluates the `.dope` `tempo.frame` / `render.shadowHeightFrac` expression
// trees EVERY frame against the live clocks (`animMs` / `life` / `elapsedMs`)
// and the resolved params — so the per-frame logic, like the resolve mapping,
// is authored once in the `.dope` and interpreted identically on every
// platform.
//
// Like the web evaluator, nodes are evaluated RAW (no decode step — straight
// off the ordered `JSONValue` the parser keeps) and anything outside the
// grammar THROWS. The tempo primitives (`envelope`, `easeOutBack`,
// `easeOutCubic`, `tempoClamp01`) are the SAME `Tempo.swift` functions the
// hand-written hooks called, so a datafied effect's output is bit-identical to
// the code it replaced. Reduce ORDER is significant for float parity:
// `add`/`mul` fold left-to-right from 0/1 and `sub`/`div` left-fold from the
// first element, exactly as the web `reduce` calls do.
//
// PORTABLE: no Metal/UIKit — this must build on Linux (the parity tests run
// there with no Apple SDK).

import Foundation

/// Evaluation context for a per-frame expression (mirror of `FrameExprCtx`).
public struct FrameExprCtx {
    /// The "on twos"-snapped animation clock in ms (stepping already applied).
    public var animMs: Double
    /// Normalized life 0..1 (animMs / durationMs, clamped).
    public var life: Double
    /// The REAL un-stepped wall clock in ms (same on every platform).
    public var elapsedMs: Double
    /// Seconds within the current loop (`(animMs % tempo.loop.periodMs) / 1000`);
    /// 0 for an effect with no `tempo.loop` — the caller (the dope-pass frame
    /// derivation) fills these from the doc's loop contract.
    public var loopS: Double
    /// Normalized loop phase in [0, 1) (`animMs % periodMs / periodMs`); 0 without a loop.
    public var phase: Double
    /// The resolved render-param bag (numeric entries are addressable).
    public var params: [String: DopeValue]
    /// Pass-geometry inputs (`render.pass` only); see `PassExprInputs`.
    public var pass: PassExprInputs?
    public init(
        animMs: Double, life: Double, elapsedMs: Double,
        loopS: Double = 0, phase: Double = 0,
        params: [String: DopeValue],
        pass: PassExprInputs? = nil
    ) {
        self.animMs = animMs
        self.life = life
        self.elapsedMs = elapsedMs
        self.loopS = loopS
        self.phase = phase
        self.params = params
        self.pass = pass
    }
}

/// The pass-geometry inputs a `render.pass` expression may read (evaluated
/// ONCE per pass by the runners, never per resolve or per frame) — mirror of
/// the web `PassExprInputs`.
public struct PassExprInputs {
    /// Min dimension of the TARGETED element box in device px, falling back to
    /// the full canvas when untargeted (the same box the standard `target`
    /// uniform carries).
    public var targetMinDimPx: Double
    /// The declared `range` of the SDF behind the first `binding.samplers`
    /// entry with an `outline` source; 0 when no sampler declares one.
    public var sdfRange: Double
    /// That SDF's `viewBox[2]` (author-units width); 0 when absent.
    public var sdfViewBoxW: Double
    public init(targetMinDimPx: Double, sdfRange: Double = 0, sdfViewBoxW: Double = 0) {
        self.targetMinDimPx = targetMinDimPx
        self.sdfRange = sdfRange
        self.sdfViewBoxW = sdfViewBoxW
    }
}

/// Which inputs an expression may read: the three evaluation entry points.
private enum ExprMode { case frame, params, pass }

private let frameInputs: Set<String> = ["animMs", "life", "elapsedMs", "loopS", "phase"]
private let passInputs: Set<String> = ["targetMinDimPx", "sdfRange", "sdfViewBoxW"]

/// Errors the per-frame grammar can raise. Messages mirror the web evaluator's.
public enum FrameExprError: Error, CustomStringConvertible {
    case missingParam(String)
    case inputNotAllowed(String)
    case frameInputInPass(String)
    case passInputOutsidePass(String)
    case unknownInput(String)
    case unknownNode(String)

    public var description: String {
        switch self {
        case let .missingParam(n):
            return "dope: frame expr references missing/non-numeric param \"\(n)\""
        case let .inputNotAllowed(n):
            return "dope: {input} is not allowed in a params-only expression (got \"\(n)\")"
        case let .frameInputInPass(n):
            return "dope: frame input \"\(n)\" is not allowed in a render.pass expression (pass expressions are not frame-clocked)"
        case let .passInputOutsidePass(n):
            return "dope: pass input \"\(n)\" is only allowed in a render.pass expression"
        case let .unknownInput(n):
            return "dope: unknown frame input \"\(n)\""
        case let .unknownNode(n):
            return "dope: unknown frame expr node \(n)"
        }
    }
}

/// Resolve an `{input}` name under the given mode — the same gating (and the
/// same error wording) as the web `evalInput`.
private func evalInput(_ name: String, _ ctx: FrameExprCtx, _ mode: ExprMode) throws -> Double {
    if mode == .pass {
        if frameInputs.contains(name) { throw FrameExprError.frameInputInPass(name) }
        switch name {
        case "targetMinDimPx": return ctx.pass?.targetMinDimPx ?? 0
        case "sdfRange": return ctx.pass?.sdfRange ?? 0
        case "sdfViewBoxW": return ctx.pass?.sdfViewBoxW ?? 0
        default: throw FrameExprError.unknownInput(name)
        }
    }
    if passInputs.contains(name) { throw FrameExprError.passInputOutsidePass(name) }
    if mode == .params { throw FrameExprError.inputNotAllowed(name) }
    switch name {
    case "animMs": return ctx.animMs
    case "life": return ctx.life
    case "elapsedMs": return ctx.elapsedMs
    case "loopS": return ctx.loopS
    case "phase": return ctx.phase
    default: throw FrameExprError.unknownInput(name)
    }
}

private func evalNode(_ node: JSONValue, _ ctx: FrameExprCtx, _ mode: ExprMode) throws -> Double {
    // Bare number literal.
    if case let .number(n) = node { return n }
    guard case .object = node else { throw FrameExprError.unknownNode("\(node)") }

    /// The node's child list (`{op: [...]}`) — anything else is outside the grammar.
    func list(_ key: String) throws -> [JSONValue] {
        guard let arr = node[key]?.asArray else { throw FrameExprError.unknownNode(key) }
        return arr
    }
    func eval(_ n: JSONValue) throws -> Double { try evalNode(n, ctx, mode) }

    // Checked in the SAME key order as the web evaluator's `in`-chain.
    if let c = node["const"] { return c.asNumber ?? 0 }
    if let p = node["param"] {
        let name = p.asString ?? ""
        guard case let .number(v)? = ctx.params[name] else {
            throw FrameExprError.missingParam(name)
        }
        return v
    }
    if let i = node["input"] {
        return try evalInput(i.asString ?? "", ctx, mode)
    }
    if node["add"] != nil {
        // Fold left-to-right from 0 — `reduce((p, n) => p + eval(n), 0)`.
        return try list("add").reduce(0.0) { try $0 + eval($1) }
    }
    if node["sub"] != nil {
        // Eager: every element evaluates, then left-fold from the first.
        let parts = try list("sub").map(eval)
        guard let first = parts.first else { return 0 }
        return parts.dropFirst().reduce(first, -)
    }
    if node["mul"] != nil {
        // Fold left-to-right from 1 — `reduce((p, n) => p * eval(n), 1)`.
        return try list("mul").reduce(1.0) { try $0 * eval($1) }
    }
    if node["div"] != nil {
        // Eager left-fold from the first element; plain IEEE division.
        let parts = try list("div").map(eval)
        guard let first = parts.first else { return 0 }
        return parts.dropFirst().reduce(first, /)
    }
    if node["min"] != nil {
        // `Math.min()` of an empty list is +Infinity.
        return try list("min").map(eval).min() ?? .infinity
    }
    if node["max"] != nil {
        // `Math.max()` of an empty list is -Infinity.
        return try list("max").map(eval).max() ?? -.infinity
    }
    if node["pow"] != nil {
        let a = try list("pow")
        guard a.count == 2 else { throw FrameExprError.unknownNode("pow") }
        return pow(try eval(a[0]), try eval(a[1]))
    }
    if let s = node["sin"] { return sin(try eval(s)) }
    if let e = node["exp"] { return exp(try eval(e)) }
    if let c = node["clamp01"] { return tempoClamp01(try eval(c)) }
    if node["lt"] != nil {
        // Branches are evaluated LAZILY (only the taken branch), so a guard like
        // `0 < elapsedMs ? f(elapsedMs) : 0` never evaluates f outside its domain.
        let a = try list("lt")
        guard a.count == 4 else { throw FrameExprError.unknownNode("lt") }
        let lhs = try eval(a[0])
        let rhs = try eval(a[1])
        return lhs < rhs ? try eval(a[2]) : try eval(a[3])
    }
    if node["envelope"] != nil {
        let a = try list("envelope")
        guard a.count == 2 else { throw FrameExprError.unknownNode("envelope") }
        return envelope(try eval(a[0]), overshoot: try eval(a[1]))
    }
    if let e = node["easeOutCubic"] { return easeOutCubic(try eval(e)) }
    if node["easeOutBack"] != nil {
        let a = try list("easeOutBack")
        guard a.count == 2 else { throw FrameExprError.unknownNode("easeOutBack") }
        return easeOutBack(try eval(a[0]), overshoot: try eval(a[1]))
    }
    throw FrameExprError.unknownNode("\(node)")
}

/// Evaluate a per-frame grammar node to a number. Pure; throws outside the grammar.
public func evalFrameExpr(_ node: JSONValue, _ ctx: FrameExprCtx) throws -> Double {
    try evalNode(node, ctx, .frame)
}

/// Evaluate a PARAMS-ONLY expression (e.g. `render.shadowHeightFrac`): the same
/// grammar, but `{input}` nodes THROW — a shadow-geometry expression must be a
/// pure function of the resolved params, never of the frame clock.
public func evalParamExpr(_ node: JSONValue, _ params: [String: DopeValue]) throws -> Double {
    try evalNode(node, FrameExprCtx(animMs: 0, life: 0, elapsedMs: 0, params: params), .params)
}

/// Evaluate a PER-PASS expression (`render.pass`): the same grammar over the
/// resolved params plus the pass-geometry inputs (`targetMinDimPx` /
/// `sdfRange` / `sdfViewBoxW`). Frame clocks THROW — a pass expression is
/// evaluated once per pass, not per frame. Mirror of the web `evalPassExpr`.
public func evalPassExpr(
    _ node: JSONValue, _ params: [String: DopeValue], _ pass: PassExprInputs
) throws -> Double {
    try evalNode(node, FrameExprCtx(animMs: 0, life: 0, elapsedMs: 0, params: params, pass: pass), .pass)
}
