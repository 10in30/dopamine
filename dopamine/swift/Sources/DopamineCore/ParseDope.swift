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

    return DopeDoc(
        fmt: fmt, v: v, id: json["id"]?.asString ?? "",
        palette: palette, durationMs: durationMs,
        renderParams: renderParams, baselines: baselines,
        baselineOrder: baselineOrder, controlsMoodDefault: controlsMoodDefault,
        raw: json
    )
}
