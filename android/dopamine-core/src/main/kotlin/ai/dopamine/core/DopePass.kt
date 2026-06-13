// Generic DATA-DRIVEN pass derivation — the portable half of the web
// `framework/dope-pass.ts` (`dopePassConfig`), as PURE JVM data so the
// derivation is testable on the parity grid with no Android SDK.
//
// For a datafied effect the `.dope` carries everything the hand-written
// per-effect `PassConfig` used to: the per-frame logic (`tempo.frame`), the
// shadow height (`render.shadowHeightFrac`), the per-pass uniforms
// (`render.pass`, evaluated against the live target geometry), the loop-cap
// consts (`render.consts`), the runner config (`render.config.usesOrigin`),
// the reduced-motion peak/hold (`tempo.reducedMotion`) and the uniform-binding
// contract (`binding`, including the samplers' declarative SDF sources). This
// module derives all of that from the parsed doc — uniform names by the same
// `name → u<Name>` convention `computeScalarBinds` applies, exceptions from
// the binding contract — so the only hand-written Android source left for such
// an effect is its GLSL (toolchain-generated) and any genuinely code-shaped
// hook.
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
 * The datafied pass description derived from a `.dope`. The derived contract
 * is pinned by the per-effect dope-config JVM tests:
 *
 *   - `uniforms`: every `render.params` key not in `binding.excludeParams` and
 *     not the scatter key → `u<Name>`; the scatter key contributes
 *     `binding.scatterWeb` when present (else it is not a shader uniform); every
 *     `binding.extras[].web`; every `binding.samplers[].web`; every
 *     `binding.arrays[].web` (the `frameArrays` uniform arrays); plus
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
    /** The continuous-loop period (`tempo.loop.periodMs`); null for one-shots. */
    val loopPeriodMs: Double?,
    private val shadowSpec: FrameExprNode,
    private val ampExpr: FrameExprNode,
    /** Per-frame extras as `(web uniform name, expression)`, authored order. */
    private val extraExprs: List<Pair<String, FrameExprNode>>,
    /** `render.pass` as `(web uniform name, expression)`, authored order. */
    private val passExprs: List<Pair<String, FrameExprNode>> = emptyList(),
    /** Declared SDF metadata for the pass inputs (0 when no sampler `outline`). */
    private val passSdfRange: Double = 0.0,
    private val passSdfViewBoxW: Double = 0.0,
    /**
     * Web names of sampler `on` flag uniforms (`binding.samplers[].on` →
     * `binding.extras[].web`, e.g. `uSdfOn`). The GL backbone has no
     * aux-texture support, so the GL config pins these OFF each pass.
     */
    val samplerOnUniforms: List<String> = emptyList(),
    /**
     * `render.panel.sampler` — the dynamic-panel sampler (web uniform name)
     * the host redraws + uploads every frame; null when the doc declares no
     * panel. The DRAW stays code (the per-effect panel-draw seam).
     */
    val panelSampler: String? = null,
    /** `render.panel.texture` — the panel's texture unit (default 0, the panel slot). */
    val panelTexture: Int = 0,
) {
    /** Shadow occluder height (fraction of min canvas dim) — params-only. */
    fun shadowHeightFrac(params: Map<String, DopeValue>): Double = evalParamExpr(shadowSpec, params)

    /** Whether the doc declares any `render.pass` uniforms. */
    val hasPassUniforms: Boolean get() = passExprs.isNotEmpty()

    /**
     * The PER-PASS uniform values (`render.pass`), keyed by web uniform name —
     * evaluated over the resolved params + the pass-geometry inputs.
     * `targetMinDimPx` is the min dimension of the targeted element box in
     * device px (full-canvas fallback already applied by the caller — the same
     * box `uTarget` binds); `dpr` the surface density (web `devicePixelRatio`).
     */
    fun passUniforms(
        targetMinDimPx: Double,
        params: Map<String, DopeValue>,
        dpr: Double = 1.0,
    ): LinkedHashMap<String, Double> {
        val pass = PassExprInputs(
            targetMinDimPx = targetMinDimPx,
            sdfRange = passSdfRange,
            sdfViewBoxW = passSdfViewBoxW,
            dpr = dpr,
        )
        val out = LinkedHashMap<String, Double>()
        for ((web, expr) in passExprs) out[web] = evalPassExpr(expr, params, pass)
        return out
    }

    /**
     * The per-frame uniform values: the well-known `amp` first, then each extra
     * under its web uniform name — the exact map the old hand-written `frame()`
     * hooks returned (`bindFrameUniforms` maps `amp` → `uAmp`, others by name).
     * The loop clocks (0 without `tempo.loop`) use the SAME formula the runner
     * uses for `uLoopS`/`uPhase`, so a `{input:"phase"}` amp matches the shader.
     */
    fun frame(
        animMs: Double,
        life: Double,
        elapsedMs: Double,
        params: Map<String, DopeValue>,
    ): LinkedHashMap<String, Double> {
        val loopMs = loopPeriodMs?.let { animMs % it } ?: 0.0
        val ctx = FrameExprCtx(
            animMs = animMs, life = life, elapsedMs = elapsedMs, params = params,
            loopS = loopMs / 1000.0, phase = loopPeriodMs?.let { loopMs / it } ?: 0.0,
        )
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
    // samplers: plain strings (web name only) or the object form, possibly with
    // a declarative SDF source (`outline` + `on` — the canonical extra name of
    // the "on" flag).
    data class Sampler(val web: String, val outline: String?, val on: String?)
    val samplers: List<Sampler> = binding?.get("samplers")?.asArray?.mapNotNull { s ->
        val web = s.asString ?: s["web"]?.asString ?: return@mapNotNull null
        Sampler(web = web, outline = s["outline"]?.asString, on = s["on"]?.asString)
    } ?: emptyList()
    // arrays: the per-frame ARRAY uniforms (CPU-precomputed frame geometry —
    // lightning's uVerts/uBoltMeta). GL binds them by NAME (the `frameArrays`
    // seam fills them); only their uniform names matter to the plan.
    val arrayWebs: List<String> = binding?.get("arrays")?.asArray?.mapNotNull { it["web"]?.asString }
        ?: emptyList()

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
    for (s in samplers) uniforms.add(s.web)
    for (w in arrayWebs) uniforms.add(w)
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

    // --- per-PASS uniforms (`render.pass`): canonical name → web uniform name --
    // (a "note" key is documentation, not an expression — same convention as
    // `binding.note`.)
    val passExprs = ArrayList<Pair<String, FrameExprNode>>()
    raw["render"]?.get("pass")?.asObject?.forEach { (name, exprJson) ->
        if (name == "note") return@forEach
        val web = extraDefs.firstOrNull { it.first == name }?.second
            ?: throw DopeException("dope: ${doc.id} render.pass.\"$name\" has no binding.extras web name")
        passExprs.add(web to decodeFrameExpr(exprJson))
    }

    // The pass-expr SDF inputs: the declared metadata of the first sampler with
    // an `outline` source, read straight off the raw geometry JSON (no bitmap
    // decode — portable, whether or not the platform binds the SDF).
    var passSdfRange = 0.0
    var passSdfViewBoxW = 0.0
    samplers.firstOrNull { it.outline != null }?.outline?.let { outlineName ->
        val sdf = raw["geometry"]?.get("outlines")?.get(outlineName)?.get("sdf")
        passSdfRange = sdf?.get("range")?.asNumber ?: 0.0
        passSdfViewBoxW = sdf?.get("viewBox")?.asArray?.getOrNull(2)?.asNumber ?: 0.0
    }

    // The sampler "on" flags by web uniform name (`on` is a canonical extras name).
    val samplerOnUniforms = samplers.mapNotNull { s ->
        s.on?.let { on -> extraDefs.firstOrNull { it.first == on }?.second }
    }

    // --- the resolve-call data + reduced motion the factories hardcoded -------
    val consts = LinkedHashMap<String, Double>()
    raw["render"]?.get("consts")?.asObject?.forEach { (k, v) -> v.asNumber?.let { consts[k] = it } }
    val reducedMotion = raw["tempo"]?.get("reducedMotion")

    // --- `render.panel` — the dynamic-panel wiring (the draw stays code) ------
    val panelJson = raw["render"]?.get("panel")
    val panelSampler = panelJson?.get("sampler")?.asString
    val panelTexture = panelJson?.get("texture")?.asNumber?.toInt() ?: 0

    return DopePassPlan(
        uniforms = uniforms.toList(),
        bindings = bindings,
        usesOrigin = raw["render"]?.get("config")?.get("usesOrigin")?.asBool ?: false,
        scatterKey = scatterKey,
        consts = consts,
        reducedMotionPeakMs = reducedMotion?.get("peakMs")?.asNumber,
        reducedMotionHoldMs = reducedMotion?.get("holdMs")?.asNumber,
        loopPeriodMs = doc.loop?.periodMs,
        shadowSpec = shadowSpec,
        ampExpr = ampExpr,
        extraExprs = extraExprs,
        passExprs = passExprs,
        passSdfRange = passSdfRange,
        passSdfViewBoxW = passSdfViewBoxW,
        samplerOnUniforms = samplerOnUniforms,
        panelSampler = panelSampler,
        panelTexture = panelTexture,
    )
}
