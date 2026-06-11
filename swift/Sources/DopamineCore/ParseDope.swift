// `.dope` parse + validation — port of `parseDope` + the ExprNode decode the web
// gets "for free" from the TS union. Decodes the ordered JSON (so authored mood
// order survives), builds the typed `DopeDoc`, and rejects a wrong magic / major
// version / external asset reference, matching `framework/loader.ts`.

import Foundation

// MARK: - ExprNode decode (the mapping grammar from JSON).

func decodeExpr(_ json: JSONValue) throws -> ExprNode {
    // Bare number literal.
    if case let .number(n) = json { return .number(n) }
    guard let members = json.asObject, let (key, _) = members.first else {
        throw DopeError.unknownNode("\(json)")
    }
    func child(_ k: String) throws -> ExprNode { try decodeExpr(json[k]!) }
    func childList(_ k: String) throws -> [ExprNode] {
        guard let arr = json[k]?.asArray else { throw DopeError.unknownNode(k) }
        return try arr.map(decodeExpr)
    }
    switch key {
    case "const":
        return .const(json["const"]!.asNumber ?? 0)
    case "control":
        return .control(json["control"]!.asString ?? "")
    case "baseline":
        return .baseline(json["baseline"]!.asString ?? "")
    case "lerp":
        let a = json["lerp"]!.asArray!
        return .lerp(a[0].asString!, a[1].asNumber!, a[2].asNumber!)
    case "mul": return .mul(try childList("mul"))
    case "add": return .add(try childList("add"))
    case "sub": return .sub(try childList("sub"))
    case "round": return .round(try child("round"))
    case "floor": return .floor(try child("floor"))
    case "mix":
        let a = json["mix"]!.asArray!
        return .mix(try decodeExpr(a[0]), try decodeExpr(a[1]), a[2].asString!)
    case "max": return .max(try childList("max"))
    case "min": return .min(try childList("min"))
    default:
        throw DopeError.unknownNode(key)
    }
}

func decodeParamSpec(_ json: JSONValue) throws -> DopeParamSpec {
    DopeParamSpec(
        type: json["type"]?.asString,
        from: try decodeExpr(json["from"]!),
        clamp01: json["clamp01"]?.asBool ?? false,
        clampMax: json["clampMax"]?.asString,
        clampMin: json["clampMin"]?.asString
    )
}

// MARK: - assertStandalone (a `.dope` must be self-contained).

private let remoteRefRE = try! NSRegularExpression(pattern: "^(?:[a-z][a-z0-9+.-]*:)?//", options: [.caseInsensitive])
private let absPathRE = try! NSRegularExpression(pattern: "^(?:/|[A-Za-z]:[\\\\/])")

private func matches(_ re: NSRegularExpression, _ s: String) -> Bool {
    re.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
}

func assertStandalone(_ node: JSONValue) throws {
    switch node {
    case let .string(s):
        // Note: `data:` URIs (the baked SDF) are inline, not remote/absolute, so
        // they pass — matching the web's regexes exactly.
        if matches(remoteRefRE, s) || matches(absPathRE, s) {
            throw DopeError.externalReference(s)
        }
    case let .array(items):
        for v in items { try assertStandalone(v) }
    case let .object(members):
        for (_, v) in members { try assertStandalone(v) }
    default:
        break
    }
}

// MARK: - parseDope.

/// Parse + validate a `.dope` document from JSON text. Rejects a wrong/absent
/// magic or major version, and any external (remote / absolute-path) asset
/// reference — a `.dope` must be self-contained.
public func parseDope(_ src: String) throws -> DopeDoc {
    let json = try parseOrderedJSON(src)

    let fmt = json["fmt"]?.asString ?? ""
    if fmt != "dopamine-effect" { throw DopeError.badMagic(fmt) }
    let v = json["v"]?.asString ?? ""
    let major = Int(v.split(separator: ".").first.map(String.init) ?? "")
    guard let m = major, m <= 1 else { throw DopeError.unsupportedVersion(v) }

    guard
        let renderObj = json["render"],
        let paramsObj = renderObj["params"]?.asObject,
        let paletteObj = json["palette"],
        let perMoodObj = paletteObj["perMood"]?.asObject,
        let baselinesObj = json["baselines"]?.asObject
    else { throw DopeError.missingSections }

    try assertStandalone(json)

    // render.params, authored order.
    var renderParams: [(String, DopeParamSpec)] = []
    for (name, spec) in paramsObj {
        renderParams.append((name, try decodeParamSpec(spec)))
    }

    // baselines, authored order.
    var baselines: [String: [String: Double]] = [:]
    var baselineOrder: [String] = []
    for (mood, table) in baselinesObj {
        baselineOrder.append(mood)
        var row: [String: Double] = [:]
        if let members = table.asObject {
            for (k, val) in members { if let n = val.asNumber { row[k] = n } }
        }
        baselines[mood] = row
    }

    // palette.
    var perMood: [String: PaletteRegister] = [:]
    for (mood, reg) in perMoodObj {
        perMood[mood] = PaletteRegister(
            hueCenter: reg["hueCenter"]?.asNumber ?? 0,
            hueRange: reg["hueRange"]?.asNumber ?? 0,
            lightness: reg["lightness"]?.asNumber ?? 0,
            chroma: reg["chroma"]?.asNumber ?? 0
        )
    }
    let palette = DopePalette(
        hueSpread: paletteObj["hueSpread"]?.asNumber ?? 0,
        chromaFrom: try decodeExpr(paletteObj["chroma"]!["from"]!),
        perMood: perMood
    )

    // tempo.durationMs (optional).
    var durationMs: DopeParamSpec?
    if let dms = json["tempo"]?["durationMs"] {
        durationMs = try decodeParamSpec(dms)
    }

    let controlsMoodDefault = json["controls"]?["mood"]?["default"]?.asString

    // ── P2 — the datafied per-frame logic + the shipped binding contract. All
    //         OPTIONAL (tolerated absent), so older / not-yet-datafied docs still
    //         parse. The frame/shadow expressions stay RAW JSONValue trees — the
    //         per-frame evaluator (FrameExpr.swift) interprets them with no
    //         decode step, matching the web. ──

    // tempo.frame — { amp: <expr>, extras: { <canonical name>: <expr> } }.
    var frame: DopeFrameSpec?
    if let f = json["tempo"]?["frame"], let amp = f["amp"] {
        frame = DopeFrameSpec(amp: amp, extras: f["extras"]?.asObject ?? [])
    }

    // tempo.loop — the continuous-loop contract { periodMs, snapAligned }.
    // Validated here (mirroring the web parseDope): the seam invariants move
    // from per-effect convention into the parser on every platform.
    var loop: DopeLoopSpec?
    if let l = json["tempo"]?["loop"] {
        loop = try decodeLoop(l, baselines: baselines)
    }

    // tempo.reducedMotion — { peakMs, holdMs }.
    var reducedMotion: DopeReducedMotion?
    if let rm = json["tempo"]?["reducedMotion"] {
        reducedMotion = DopeReducedMotion(
            peakMs: rm["peakMs"]?.asNumber ?? 0,
            holdMs: rm["holdMs"]?.asNumber ?? 0)
    }

    // render.shadowHeightFrac — a bare number or a params-only expression (raw).
    let shadowHeightFrac = renderObj["shadowHeightFrac"]

    // render.consts — the loop-cap consts the clampMax/clampMin flags reference.
    var consts: [String: Double] = [:]
    for (name, value) in renderObj["consts"]?.asObject ?? [] {
        if let n = value.asNumber { consts[name] = n }
    }

    // render.config — runner config (today: usesOrigin).
    let usesOrigin = renderObj["config"]?["usesOrigin"]?.asBool

    // binding — the uniform-binding contract (now SHIPS in the portable doc).
    var binding: DopeBinding?
    if let b = json["binding"] {
        var excludeParams: [String] = []
        for v in b["excludeParams"]?.asArray ?? [] {
            if let s = v.asString { excludeParams.append(s) }
        }
        var extras: [DopeBindingExtra] = []
        for e in b["extras"]?.asArray ?? [] {
            guard let name = e["name"]?.asString else { continue }
            extras.append(DopeBindingExtra(
                name: name, type: e["type"]?.asString, web: e["web"]?.asString))
        }
        binding = DopeBinding(
            excludeParams: excludeParams,
            scatterKey: b["scatterKey"]?.asString,
            scatterWeb: b["scatterWeb"]?.asString,
            extras: extras)
    }

    return DopeDoc(
        fmt: fmt, v: v, id: json["id"]?.asString ?? "",
        palette: palette, durationMs: durationMs,
        renderParams: renderParams, baselines: baselines,
        baselineOrder: baselineOrder, controlsMoodDefault: controlsMoodDefault,
        frame: frame, loop: loop, reducedMotion: reducedMotion,
        shadowHeightFrac: shadowHeightFrac, consts: consts,
        usesOrigin: usesOrigin, binding: binding,
        raw: json
    )
}

// MARK: - tempo.loop decode + validation (mirrors the web `assertValidLoop`).

/// Tolerance for the loop whole-multiple checks (the step 1000/12 is not
/// exactly representable, so an exact remainder check would be float-fragile).
private let loopEps = 1e-6
private func isWhole(_ x: Double) -> Bool { abs(x - x.rounded()) < loopEps }

func decodeLoop(_ json: JSONValue, baselines: [String: [String: Double]]) throws -> DopeLoopSpec {
    let p = json["periodMs"]?.asNumber ?? 0
    guard p.isFinite, p > 0 else {
        throw DopeError.invalidLoop("tempo.loop.periodMs must be a positive number (got \(json["periodMs"].map { "\($0)" } ?? "nil"))")
    }
    let snapAligned = json["snapAligned"]?.asBool ?? true
    if snapAligned, !isWhole(p / NPR_TIME_STEP_MS) {
        throw DopeError.invalidLoop(
            "tempo.loop.periodMs (\(p)) is not a whole number of animate-on-twos steps (1000/12 ms)")
    }
    for (mood, row) in baselines {
        if let d = row["durationMs"], !isWhole(d / p) {
            throw DopeError.invalidLoop(
                "baselines.\(mood).durationMs (\(d)) is not a whole number of tempo.loop periods (\(p) ms)")
        }
    }
    return DopeLoopSpec(periodMs: p, snapAligned: snapAligned)
}
