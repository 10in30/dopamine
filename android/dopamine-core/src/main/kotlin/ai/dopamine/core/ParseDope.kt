// `.dope` parse + validation — port of `parseDope` + the ExprNode decode the web
// gets "for free" from the TS union (matching swift's `ParseDope.swift`). Decodes
// the ordered JSON (so authored mood order survives), builds the typed `DopeDoc`,
// and rejects a wrong magic / major version / external asset reference, matching
// `framework/loader.ts`.

package ai.dopamine.core

// MARK: - ExprNode decode (the mapping grammar from JSON).

internal fun decodeExpr(json: JsonValue): ExprNode {
    // Bare number literal.
    if (json is JsonValue.Num) return ExprNode.Num(json.value)
    val members = json.asObject ?: throw DopeException("dope: unknown expr node $json")
    val key = members.firstOrNull()?.first ?: throw DopeException("dope: unknown expr node $json")

    fun child(k: String): ExprNode = decodeExpr(json[k]!!)
    fun childList(k: String): List<ExprNode> =
        (json[k]?.asArray ?: throw DopeException("dope: unknown expr node $k")).map { decodeExpr(it) }

    return when (key) {
        "const" -> ExprNode.Const(json["const"]!!.asNumber ?: 0.0)
        "control" -> ExprNode.Control(json["control"]!!.asString ?: "")
        "baseline" -> ExprNode.Baseline(json["baseline"]!!.asString ?: "")
        "lerp" -> {
            val a = json["lerp"]!!.asArray!!
            ExprNode.Lerp(a[0].asString!!, a[1].asNumber!!, a[2].asNumber!!)
        }
        "mul" -> ExprNode.Mul(childList("mul"))
        "add" -> ExprNode.Add(childList("add"))
        "sub" -> ExprNode.Sub(childList("sub"))
        "round" -> ExprNode.Round(child("round"))
        "floor" -> ExprNode.Floor(child("floor"))
        "mix" -> {
            val a = json["mix"]!!.asArray!!
            ExprNode.Mix(decodeExpr(a[0]), decodeExpr(a[1]), a[2].asString!!)
        }
        "max" -> ExprNode.Max(childList("max"))
        "min" -> ExprNode.Min(childList("min"))
        else -> throw DopeException("dope: unknown expr node $key")
    }
}

private fun decodeParamSpec(json: JsonValue): DopeParamSpec = DopeParamSpec(
    type = json["type"]?.asString,
    from = decodeExpr(json["from"]!!),
    clamp01 = json["clamp01"]?.asBool ?: false,
    clampMax = json["clampMax"]?.asString,
    clampMin = json["clampMin"]?.asString,
)

// MARK: - assertStandalone (a `.dope` must be self-contained).

// http(s)://, ftp://, //host  — and  /etc/..., C:\...
private val remoteRefRe = Regex("^(?:[a-z][a-z0-9+.-]*:)?//", RegexOption.IGNORE_CASE)
private val absPathRe = Regex("^(?:/|[A-Za-z]:[\\\\/])")

private fun assertStandalone(node: JsonValue) {
    when (node) {
        is JsonValue.Str -> {
            // `data:` URIs (the baked SDF) are inline, not remote/absolute, so they
            // pass — matching the web's regexes exactly.
            if (remoteRefRe.containsMatchIn(node.value) || absPathRe.containsMatchIn(node.value)) {
                throw DopeException("dope: external asset reference is not allowed: \"${node.value}\"")
            }
        }
        is JsonValue.Arr -> node.items.forEach { assertStandalone(it) }
        is JsonValue.Obj -> node.members.forEach { assertStandalone(it.second) }
        else -> {}
    }
}

// MARK: - parseDope.

/**
 * Parse + validate a `.dope` document from JSON text. Rejects a wrong/absent
 * magic or major version, and any external (remote / absolute-path) asset
 * reference — a `.dope` must be self-contained.
 */
fun parseDope(src: String): DopeDoc {
    val json = parseOrderedJson(src)

    val fmt = json["fmt"]?.asString ?: ""
    if (fmt != "dopamine-effect") throw DopeException("dope: not a Dopamine effect document (fmt=\"$fmt\")")
    val v = json["v"]?.asString ?: ""
    val major = v.split(".").firstOrNull()?.toIntOrNull()
    if (major == null || major > 1) throw DopeException("dope: unsupported format version \"$v\"")

    val renderObj = json["render"]
    val paramsObj = renderObj?.get("params")?.asObject
    val paletteObj = json["palette"]
    val perMoodObj = paletteObj?.get("perMood")?.asObject
    val baselinesObj = json["baselines"]?.asObject
    if (paramsObj == null || perMoodObj == null || baselinesObj == null) {
        throw DopeException("dope: document missing render.params / palette.perMood / baselines")
    }

    assertStandalone(json)

    // render.params, authored order.
    val renderParams = paramsObj.map { (name, spec) -> name to decodeParamSpec(spec) }

    // baselines, authored order.
    val baselines = LinkedHashMap<String, Map<String, Double>>()
    val baselineOrder = ArrayList<String>()
    for ((mood, table) in baselinesObj) {
        baselineOrder.add(mood)
        val row = LinkedHashMap<String, Double>()
        table.asObject?.forEach { (k, value) -> value.asNumber?.let { row[k] = it } }
        baselines[mood] = row
    }

    // palette.
    val perMood = LinkedHashMap<String, PaletteRegister>()
    for ((mood, reg) in perMoodObj) {
        perMood[mood] = PaletteRegister(
            hueCenter = reg["hueCenter"]?.asNumber ?: 0.0,
            hueRange = reg["hueRange"]?.asNumber ?: 0.0,
            lightness = reg["lightness"]?.asNumber ?: 0.0,
            chroma = reg["chroma"]?.asNumber ?: 0.0,
        )
    }
    val palette = DopePalette(
        hueSpread = paletteObj["hueSpread"]?.asNumber ?: 0.0,
        chromaFrom = decodeExpr(paletteObj["chroma"]!!["from"]!!),
        perMood = perMood,
    )

    // tempo.durationMs (optional).
    val durationMs = json["tempo"]?.get("durationMs")?.let { decodeParamSpec(it) }

    val controlsMoodDefault = json["controls"]?.get("mood")?.get("default")?.asString

    return DopeDoc(
        fmt = fmt, v = v, id = json["id"]?.asString ?: "",
        palette = palette, durationMs = durationMs,
        renderParams = renderParams, baselines = baselines,
        baselineOrder = baselineOrder, controlsMoodDefault = controlsMoodDefault,
        raw = json,
    )
}
