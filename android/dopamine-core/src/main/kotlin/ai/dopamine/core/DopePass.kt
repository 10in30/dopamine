// Generic DATA-DRIVEN pass derivation — the portable half of the web
// `framework/dope-pass.ts` (`dopePassConfig`), as PURE JVM data so the
// derivation is testable on the parity grid with no Android SDK.
//
// For a datafied effect the `.dope` carries everything the hand-written
// per-effect `PassConfig` used to: the per-frame logic (`tempo.frame`), the
// shadow height (`render.shadowHeightFrac`), the loop-cap consts
// (`render.consts`), the runner config (`render.config.usesOrigin`), the
// reduced-motion peak/hold (`tempo.reducedMotion`) and the uniform-binding
// contract (`binding`). This module derives all of that from the parsed doc —
// uniform names by the same `name → u<Name>` convention `computeScalarBinds`
// applies, exceptions from the binding contract — so the only hand-written
// Android source left for such an effect is its GLSL (toolchain-generated) and
// any genuinely code-shaped hook (fail's canvas-dependent `passUniforms`).
//
// The GL half (`ai.dopamine.gl.dopePassConfig`) wraps a `DopePassPlan` into the
// runner's `PassConfig`; the split keeps `dopamine-core` free of `android.*`.

package ai.dopamine.core

/**
 * `bloomRadius` → `uBloomRadius` — the auto-binding name convention (the web
 * `pass-common.ts` `cap`; `dopamine-gl`'s `computeScalarBinds` uses it too).
 */
fun cap(s: String): String = "u" + s.replaceFirstChar { it.uppercase() }

/**
 * The datafied pass description derived from a `.dope`. Equivalent, for the
 * migrated effects, to the hand-written config literals it replaced (gated by
 * the per-effect frame-parity JVM tests):
 *
 *   - `uniforms`: every `render.params` key not in `binding.excludeParams` and
 *     not the scatter key → `u<Name>`; the scatter key contributes
 *     `binding.scatterWeb` when present (else it is not a shader uniform); every
 *     `binding.extras[].web`; every `binding.samplers[].web`; plus
 *     `extraUniforms`.
 *   - `bindings`: the scatter key → `scatterWeb` (or `null`), plus `null` for
 *     each excluded param that would otherwise auto-bind. (`style` and
 *     `durationMs` need no entry: `durationMs` is skipped by
 *     `computeScalarBinds`, and `style`'s conventional `uStyle` auto-bind is the
 *     same value the runner already sets as a standard uniform.)
 *   - `frame(...)`: `tempo.frame.amp` + `tempo.frame.extras` evaluated per frame
 *     (extras keyed by canonical name in the doc, emitted under their `binding`
 *     web name — the keys `bindFrameUniforms` consumes, `amp` → `uAmp`).
 *   - `shadowHeightFrac(...)`: `render.shadowHeightFrac` (a bare number decodes
 *     to a literal node; an expression is params-only — `{input}` throws).
 *   - `usesOrigin`: `render.config.usesOrigin`.
 *   - `scatterKey` / `consts`: the `resolveDopeParams` arguments the factories
 *     used to hardcode.
 *   - `reducedMotionPeakMs` / `HoldMs`: `tempo.reducedMotion`.
 */
class DopePassPlan internal constructor(
    val uniforms: List<String>,
    val bindings: Map<String, String?>,
    val usesOrigin: Boolean,
    /** The per-fire scatter key `resolveDopeParams` needs (null only for a non-datafied doc). */
    val scatterKey: String?,
    /** The loop-cap consts the §4.1 `clampMax`/`clampMin` flags reference. */
    val consts: Map<String, Double>,
    val reducedMotionPeakMs: Double?,
    val reducedMotionHoldMs: Double?,
    private val shadowSpec: FrameExprNode,
    private val ampExpr: FrameExprNode,
    /** Per-frame extras as `(web uniform name, expression)`, authored order. */
    private val extraExprs: List<Pair<String, FrameExprNode>>,
) {
    /** Shadow occluder height (fraction of min canvas dim) — params-only. */
    fun shadowHeightFrac(params: Map<String, DopeValue>): Double = evalParamExpr(shadowSpec, params)

    /**
     * The per-frame uniform values: the well-known `amp` first, then each extra
     * under its web uniform name — the exact map the old hand-written `frame()`
     * hooks returned (`bindFrameUniforms` maps `amp` → `uAmp`, others by name).
     */
    fun frame(
        animMs: Double,
        life: Double,
        elapsedMs: Double,
        params: Map<String, DopeValue>,
    ): LinkedHashMap<String, Double> {
        val ctx = FrameExprCtx(animMs = animMs, life = life, elapsedMs = elapsedMs, params = params)
        val out = LinkedHashMap<String, Double>()
        out["amp"] = evalFrameExpr(ampExpr, ctx)
        for ((web, expr) in extraExprs) out[web] = evalFrameExpr(expr, ctx)
        return out
    }
}

/**
 * Derive a {@link DopePassPlan} from a datafied `.dope`. Mirrors the web
 * `dopePassConfig` derivation rules exactly; throws (like the web) when the doc
 * lacks `tempo.frame` / `render.shadowHeightFrac` (i.e. is not datafied).
 * `extraUniforms` is the code hook for shader-read uniforms beyond the derived
 * set (the web `hooks.extraUniforms`).
 */
fun dopePassPlan(doc: DopeDoc, extraUniforms: List<String> = emptyList()): DopePassPlan {
    val raw = doc.raw
    val binding = raw["binding"]
    val exclude = binding?.get("excludeParams")?.asArray?.mapNotNull { it.asString } ?: emptyList()
    val scatterKey = binding?.get("scatterKey")?.asString
    val scatterWeb = binding?.get("scatterWeb")?.asString
    // extras: canonical name → web uniform name (entries may be host/code-filled
    // — no tempo.frame expression — but still contribute their uniform name).
    val extraDefs: List<Pair<String, String?>> = binding?.get("extras")?.asArray?.map { e ->
        (e["name"]?.asString ?: "") to e["web"]?.asString
    } ?: emptyList()
    val samplers: List<String> = binding?.get("samplers")?.asArray?.mapNotNull { s ->
        s.asString ?: s["web"]?.asString
    } ?: emptyList()

    val frameJson = raw["tempo"]?.get("frame")
        ?: throw DopeException("dope: ${doc.id} has no tempo.frame (not a datafied effect)")
    val ampExpr = decodeFrameExpr(
        frameJson["amp"] ?: throw DopeException("dope: ${doc.id} tempo.frame has no amp"),
    )
    val shadowJson = raw["render"]?.get("shadowHeightFrac")
        ?: throw DopeException("dope: ${doc.id} has no render.shadowHeightFrac (not a datafied effect)")
    // A bare number decodes to a literal node — the web's passthrough, same value.
    val shadowSpec = decodeFrameExpr(shadowJson)

    // --- uniforms (authored order; a LinkedHashSet dedupes like the web Set) ---
    val uniforms = LinkedHashSet<String>()
    for ((name, _) in doc.renderParams) {
        if (name in exclude || name == scatterKey) continue
        uniforms.add(cap(name))
    }
    if (scatterKey != null && scatterWeb != null) uniforms.add(scatterWeb)
    for ((_, web) in extraDefs) if (web != null) uniforms.add(web)
    for (s in samplers) uniforms.add(s)
    for (u in extraUniforms) uniforms.add(u)

    // --- bindings (exceptions to the `name → u<Name>` auto-bind) --------------
    val bindings = LinkedHashMap<String, String?>()
    if (scatterKey != null) bindings[scatterKey] = scatterWeb
    for (name in exclude) {
        if (name == "style" || name == "durationMs") continue // see class doc
        bindings[name] = null
    }

    // --- per-frame extras: canonical name → web uniform name ------------------
    val extraExprs = ArrayList<Pair<String, FrameExprNode>>()
    frameJson["extras"]?.asObject?.forEach { (name, exprJson) ->
        val web = extraDefs.firstOrNull { it.first == name }?.second
            ?: throw DopeException("dope: ${doc.id} tempo.frame.extras.\"$name\" has no binding.extras web name")
        extraExprs.add(web to decodeFrameExpr(exprJson))
    }

    // --- the resolve-call data + reduced motion the factories hardcoded -------
    val consts = LinkedHashMap<String, Double>()
    raw["render"]?.get("consts")?.asObject?.forEach { (k, v) -> v.asNumber?.let { consts[k] = it } }
    val reducedMotion = raw["tempo"]?.get("reducedMotion")

    return DopePassPlan(
        uniforms = uniforms.toList(),
        bindings = bindings,
        usesOrigin = raw["render"]?.get("config")?.get("usesOrigin")?.asBool ?: false,
        scatterKey = scatterKey,
        consts = consts,
        reducedMotionPeakMs = reducedMotion?.get("peakMs")?.asNumber,
        reducedMotionHoldMs = reducedMotion?.get("holdMs")?.asNumber,
        shadowSpec = shadowSpec,
        ampExpr = ampExpr,
        extraExprs = extraExprs,
    )
}
