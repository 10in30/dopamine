// `.dope` effect loader — direct port of `framework/loader.ts` (matching swift).
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

package ai.dopamine.core

import kotlin.math.floor

private fun lerp(a: Double, b: Double, t: Double): Double = a + (b - a) * clamp01(t)

// MARK: - Mapping mini-grammar (§4.1) — an expression tree.

/** A grammar node. Mirrors the TS `ExprNode` union; decoded from arbitrary JSON. */
sealed class ExprNode {
    data class Num(val value: Double) : ExprNode()
    data class Const(val value: Double) : ExprNode()
    data class Control(val name: String) : ExprNode()
    data class Baseline(val name: String) : ExprNode()
    data class Lerp(val control: String, val a: Double, val b: Double) : ExprNode()
    data class Mul(val nodes: List<ExprNode>) : ExprNode()
    data class Add(val nodes: List<ExprNode>) : ExprNode()
    data class Sub(val nodes: List<ExprNode>) : ExprNode()
    data class Round(val node: ExprNode) : ExprNode()
    data class Floor(val node: ExprNode) : ExprNode()
    // Extensions (§10): mix/max/min, used by typography curves.
    data class Mix(val a: ExprNode, val b: ExprNode, val control: String) : ExprNode()
    data class Max(val nodes: List<ExprNode>) : ExprNode()
    data class Min(val nodes: List<ExprNode>) : ExprNode()
}

/** Evaluation context for the grammar. */
data class EvalCtx(
    val controls: Map<String, Double>,
    val baseline: Map<String, Double>,
    val consts: Map<String, Double>,
)

class DopeException(message: String) : Exception(message)

/**
 * JS `Math.round` semantics: half rounds toward +Infinity (so round(-0.5) == 0,
 * round(0.5) == 1, round(2.5) == 3). Kotlin's `Math.round` rounds half up for
 * positives but `.roundToInt()` rounds half away from zero — differ for negatives.
 * `floor(x + 0.5)` matches JS exactly for parity.
 */
internal fun jsRound(x: Double): Double = floor(x + 0.5)

/** Evaluate a grammar node to a number. Pure; matches the TS `evalExpr` arithmetic. */
fun evalExpr(node: ExprNode, ctx: EvalCtx): Double = when (node) {
    is ExprNode.Num -> node.value
    is ExprNode.Const -> node.value
    is ExprNode.Control -> clamp01(ctx.controls[node.name] ?: 0.0)
    is ExprNode.Baseline ->
        ctx.baseline[node.name] ?: throw DopeException("dope: unknown baseline \"${node.name}\"")
    is ExprNode.Lerp -> lerp(node.a, node.b, ctx.controls[node.control] ?: 0.0)
    is ExprNode.Mul -> node.nodes.fold(1.0) { p, n -> p * evalExpr(n, ctx) }
    is ExprNode.Add -> node.nodes.fold(0.0) { p, n -> p + evalExpr(n, ctx) }
    is ExprNode.Sub -> {
        val parts = node.nodes.map { evalExpr(it, ctx) }
        if (parts.isEmpty()) 0.0 else parts.drop(1).fold(parts[0]) { p, n -> p - n }
    }
    is ExprNode.Round -> jsRound(evalExpr(node.node, ctx))
    is ExprNode.Floor -> floor(evalExpr(node.node, ctx))
    is ExprNode.Mix -> {
        val va = evalExpr(node.a, ctx)
        val vb = evalExpr(node.b, ctx)
        va + (vb - va) * clamp01(ctx.controls[node.control] ?: 0.0)
    }
    is ExprNode.Max -> node.nodes.map { evalExpr(it, ctx) }.maxOrNull() ?: Double.NEGATIVE_INFINITY
    is ExprNode.Min -> node.nodes.map { evalExpr(it, ctx) }.minOrNull() ?: Double.POSITIVE_INFINITY
}

// MARK: - Document model.

data class DopeParamSpec(
    val type: String?, // "float" | "int"
    val from: ExprNode,
    val clamp01: Boolean,
    val clampMax: String?,
    val clampMin: String?,
)

data class PaletteRegister(
    val hueCenter: Double,
    val hueRange: Double,
    val lightness: Double,
    val chroma: Double,
)

data class DopePalette(
    val hueSpread: Double,
    val chromaFrom: ExprNode,
    val perMood: Map<String, PaletteRegister>,
)

/**
 * The continuous-loop contract (`tempo.loop`), mirror of the web `DopeLoopSpec`:
 * the effect repeats seamlessly with period `periodMs`. `parseDope` validates
 * the seam invariants (the period tiles the "animate on twos" grid unless
 * `snapAligned` is false, and every baseline `durationMs` is a whole number of
 * periods); the runner derives the standard periodic clock uniforms
 * (`uLoopS`/`uPhase`) and the `loopS`/`phase` frame-expr inputs from it, and
 * the conductor re-arms at `durationMs` instead of tearing down.
 */
data class DopeLoop(
    val periodMs: Double,
    val snapAligned: Boolean = true,
)

/**
 * A `.dope` document (the parts the loader consumes — others are ignored). The
 * raw ordered JSON is retained so effect code can read free-form `content` /
 * `geometry` sections (the data spine carries more than the loader needs).
 */
data class DopeDoc(
    val fmt: String,
    val v: String,
    val id: String,
    val palette: DopePalette,
    val durationMs: DopeParamSpec?,
    val renderParams: List<Pair<String, DopeParamSpec>>, // authored order preserved
    val baselines: Map<String, Map<String, Double>>,
    /** Mood keys in their authored order (so the default-mood fallback is stable). */
    val baselineOrder: List<String>,
    /** Declared default mood from `controls.mood.default`, if any. */
    val controlsMoodDefault: String?,
    /** Continuous-loop contract (`tempo.loop`), validated at parse time. */
    val loop: DopeLoop? = null,
    /** The raw ordered JSON (for `content` / `geometry` consumers). */
    val raw: JsonValue,
)

// MARK: - Default-mood resolution (mirrors `defaultMoodKey` / `resolveMoodKey`).

fun defaultMoodKey(doc: DopeDoc): String {
    val declared = doc.controlsMoodDefault
    if (declared != null && doc.baselines[declared] != null) return declared
    // Pick the FIRST authored baseline mood (matches `Object.keys(...)[0]`).
    return doc.baselineOrder.firstOrNull()
        ?: throw DopeException("dope: document has no baselines to resolve a mood against")
}

private fun resolveMoodKey(doc: DopeDoc, mood: String): String =
    if (doc.baselines[mood] != null) mood else defaultMoodKey(doc)

// MARK: - Resolve.

data class DopeResolveInput(
    val mood: String,
    val intensity: Double,
    val whimsy: Double,
    val seed: UInt,
)

/**
 * A resolved value in the flat bag: a scalar, the palette (3 RGB stops), or a
 * string (e.g. the per-mood typography face / font stack). The `Str` case is
 * ADDITIVE — every existing consumer matches `Number` / `Palette` explicitly (no
 * exhaustive `when`), so a string value is simply ignored by the uniform auto-bind
 * (PassCommon skips non-`Number`s) and the parity grid.
 */
sealed class DopeValue {
    data class Number(val value: Double) : DopeValue()
    data class Palette(val stops: List<RGB>) : DopeValue()
    data class Str(val value: String) : DopeValue()
}

/** Convenience: read a scalar from a resolved bag (0.0 if absent / a palette). */
fun Map<String, DopeValue>.number(key: String, default: Double = 0.0): Double =
    (this[key] as? DopeValue.Number)?.value ?: default

/** Convenience: read a string from a resolved bag (`default` if absent / numeric). */
fun Map<String, DopeValue>.string(key: String, default: String = ""): String =
    (this[key] as? DopeValue.Str)?.value ?: default

private fun applyFlags(v0: Double, spec: DopeParamSpec, consts: Map<String, Double>): Double {
    var v = v0
    if (spec.clamp01) v = clamp01(v)
    spec.clampMax?.let { v = minOf(v, consts[it] ?: Double.POSITIVE_INFINITY) }
    spec.clampMin?.let { v = maxOf(v, consts[it] ?: Double.NEGATIVE_INFINITY) }
    return v
}

/**
 * Resolve a `.dope` doc + a feeling into the flat render-param bag (palette,
 * style, durationMs, seed, scatter offset, and every `render.params` entry).
 * `scatterKey` is the legacy name for the per-fire scatter offset (`moteSeed`).
 *
 * RNG order (the parity anchor): baseHue via buildPalette FIRST, then the
 * scatter `rng() * 1000` — identical to the web `resolveDopeParams`.
 */
fun resolveDopeParams(
    doc: DopeDoc,
    input: DopeResolveInput,
    consts: Map<String, Double> = emptyMap(),
    scatterKey: String,
    paletteOverride: List<OKLCH>? = null,
): Map<String, DopeValue> {
    val i = clamp01(input.intensity)
    val w = clamp01(input.whimsy)
    val moodKey = resolveMoodKey(doc, input.mood)
    val baseline = doc.baselines[moodKey] ?: throw DopeException("dope: unknown baseline \"$moodKey\"")
    val rng = mulberry32(input.seed)

    val ctx = EvalCtx(controls = mapOf("intensity" to i, "whimsy" to w), baseline = baseline, consts = consts)

    val out = LinkedHashMap<String, DopeValue>()
    out["seed"] = DopeValue.Number(input.seed.toDouble())
    out["style"] = DopeValue.Number(w)

    // durationMs (tempo)
    doc.durationMs?.let { dms ->
        out["durationMs"] = DopeValue.Number(applyFlags(evalExpr(dms.from, ctx), dms, consts))
    }

    // render.params (authored order; `style` is the raw whimsy, set above)
    for ((name, spec) in doc.renderParams) {
        if (name == "style") continue
        out[name] = DopeValue.Number(applyFlags(evalExpr(spec.from, ctx), spec, consts))
    }

    // Palette FIRST (consumes one rng() for the base hue inside buildPalette).
    val reg = doc.palette.perMood[moodKey] ?: doc.palette.perMood[defaultMoodKey(doc)]!!
    // chroma.from is evaluated with the palette register AS the baseline (matches
    // the web: `{ ...ctx, baseline: reg }`).
    val regBaseline = mapOf(
        "hueCenter" to reg.hueCenter, "hueRange" to reg.hueRange,
        "lightness" to reg.lightness, "chroma" to reg.chroma,
    )
    val chroma = evalExpr(doc.palette.chromaFrom, EvalCtx(ctx.controls, regBaseline, consts))
    val generated = buildPalette(
        rng,
        PaletteParams(
            lightness = reg.lightness, chroma = chroma,
            hueCenter = reg.hueCenter, hueRange = reg.hueRange,
            hueSpread = doc.palette.hueSpread,
        ),
    )
    out["palette"] = DopeValue.Palette(paletteOverride?.map { oklchToLinearSrgb(it) } ?: generated)

    // THEN the per-fire scatter offset (same rng() * 1000 as the engine).
    out[scatterKey] = DopeValue.Number(rng() * 1000.0)

    return out
}
