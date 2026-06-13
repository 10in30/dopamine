// Per-FRAME expression evaluator — port of the web `framework/frame-expr.ts`
// (the datafied form of an effect's `frame()` / `shadowHeightFrac` logic hooks).
//
// The resolve-time grammar (`Loader.kt` `evalExpr`) maps a feeling into the
// resolved param bag ONCE per fire. This module is its per-frame sibling: it
// evaluates the `.dope` `tempo.frame` / `render.shadowHeightFrac` expression
// trees EVERY frame against the live clocks (`animMs` / `life` / `elapsedMs`)
// and the resolved params — so the per-frame logic, like the resolve mapping,
// is authored once in the `.dope` and interpreted identically on every
// platform.
//
// The tempo primitives (`envelope`, `easeOutBack`, `easeOutCubic`,
// `tempoClamp01`) are the SAME `Tempo.kt` functions the hand-written hooks
// called, so a datafied effect's output is bit-identical to the code it
// replaced. Reduce order is significant for float parity: `add`/`mul` fold
// left-to-right from the identity, `sub`/`div` left-fold from the FIRST
// element — exactly the web's `reduce` semantics. Anything outside the grammar
// THROWS (same posture as the §4.1 mapping grammar).

package ai.dopamine.core

import kotlin.math.exp
import kotlin.math.pow
import kotlin.math.cos
import kotlin.math.sin

/** The per-frame expression grammar — an expression tree over the frame ctx. */
sealed class FrameExprNode {
    data class Num(val value: Double) : FrameExprNode()
    data class Const(val value: Double) : FrameExprNode()
    data class Param(val name: String) : FrameExprNode()
    data class Input(val name: String) : FrameExprNode()
    data class Add(val nodes: List<FrameExprNode>) : FrameExprNode()
    data class Sub(val nodes: List<FrameExprNode>) : FrameExprNode()
    data class Mul(val nodes: List<FrameExprNode>) : FrameExprNode()
    data class Div(val nodes: List<FrameExprNode>) : FrameExprNode()
    data class Min(val nodes: List<FrameExprNode>) : FrameExprNode()
    data class Max(val nodes: List<FrameExprNode>) : FrameExprNode()
    data class Pow(val a: FrameExprNode, val b: FrameExprNode) : FrameExprNode()
    data class Sin(val node: FrameExprNode) : FrameExprNode()
    data class Cos(val node: FrameExprNode) : FrameExprNode()
    data class Exp(val node: FrameExprNode) : FrameExprNode()
    data class Clamp01(val node: FrameExprNode) : FrameExprNode()

    /** `lt: [a, b, then, else]` — branches evaluate LAZILY (only the taken one). */
    data class Lt(
        val a: FrameExprNode,
        val b: FrameExprNode,
        val then: FrameExprNode,
        val otherwise: FrameExprNode,
    ) : FrameExprNode()

    data class Envelope(val t: FrameExprNode, val overshoot: FrameExprNode) : FrameExprNode()
    data class EaseOutCubic(val node: FrameExprNode) : FrameExprNode()
    data class EaseOutBack(val x: FrameExprNode, val overshoot: FrameExprNode) : FrameExprNode()
}

/**
 * Decode a per-frame grammar node from JSON (the web evaluates the raw JSON
 * directly; Kotlin decodes into the typed tree once — same as `decodeExpr` in
 * `ParseDope.kt`). Throws on anything outside the grammar.
 */
fun decodeFrameExpr(json: JsonValue): FrameExprNode {
    // Bare number literal.
    if (json is JsonValue.Num) return FrameExprNode.Num(json.value)
    val members = json.asObject ?: throw DopeException("dope: unknown frame expr node $json")
    val key = members.firstOrNull()?.first ?: throw DopeException("dope: unknown frame expr node $json")

    fun child(k: String): FrameExprNode = decodeFrameExpr(json[k]!!)
    fun childList(k: String): List<FrameExprNode> =
        (json[k]?.asArray ?: throw DopeException("dope: unknown frame expr node $k")).map { decodeFrameExpr(it) }

    return when (key) {
        "const" -> FrameExprNode.Const(json["const"]!!.asNumber ?: 0.0)
        "param" -> FrameExprNode.Param(json["param"]!!.asString ?: "")
        "input" -> FrameExprNode.Input(json["input"]!!.asString ?: "")
        "add" -> FrameExprNode.Add(childList("add"))
        "sub" -> FrameExprNode.Sub(childList("sub"))
        "mul" -> FrameExprNode.Mul(childList("mul"))
        "div" -> FrameExprNode.Div(childList("div"))
        "min" -> FrameExprNode.Min(childList("min"))
        "max" -> FrameExprNode.Max(childList("max"))
        "pow" -> {
            val a = childList("pow")
            FrameExprNode.Pow(a[0], a[1])
        }
        "sin" -> FrameExprNode.Sin(child("sin"))
        "cos" -> FrameExprNode.Cos(child("cos"))
        "exp" -> FrameExprNode.Exp(child("exp"))
        "clamp01" -> FrameExprNode.Clamp01(child("clamp01"))
        "lt" -> {
            val a = childList("lt")
            FrameExprNode.Lt(a[0], a[1], a[2], a[3])
        }
        "envelope" -> {
            val a = childList("envelope")
            FrameExprNode.Envelope(a[0], a[1])
        }
        "easeOutCubic" -> FrameExprNode.EaseOutCubic(child("easeOutCubic"))
        "easeOutBack" -> {
            val a = childList("easeOutBack")
            FrameExprNode.EaseOutBack(a[0], a[1])
        }
        else -> throw DopeException("dope: unknown frame expr node $key")
    }
}

/** Evaluation context for a per-frame expression. */
data class FrameExprCtx(
    /** The "on twos"-snapped animation clock in ms (stepping already applied). */
    val animMs: Double,
    /** Normalized life 0..1 (animMs / durationMs, clamped). */
    val life: Double,
    /** The REAL un-stepped wall clock in ms (the raw `renderAt` argument). */
    val elapsedMs: Double,
    /** The resolved render-param bag (numeric entries are addressable). */
    val params: Map<String, DopeValue>,
    /**
     * Seconds within the current loop (`(animMs % tempo.loop.periodMs) / 1000`);
     * 0 for an effect with no `tempo.loop` — the caller (the dope-pass frame
     * derivation) fills these from the doc's loop contract.
     */
    val loopS: Double = 0.0,
    /** Normalized loop phase in [0, 1) (`animMs % periodMs / periodMs`); 0 without a loop. */
    val phase: Double = 0.0,
    /** Pass-geometry inputs (`render.pass` only); see [PassExprInputs]. */
    val pass: PassExprInputs? = null,
)

/**
 * The pass-geometry inputs a `render.pass` expression may read (evaluated ONCE
 * per pass by the runners, never per resolve or per frame) — mirror of the web
 * `PassExprInputs`.
 */
data class PassExprInputs(
    /**
     * Min dimension of the TARGETED element box in device px, falling back to
     * the full canvas when untargeted (the same box the standard `uTarget`
     * uniform carries).
     */
    val targetMinDimPx: Double,
    /**
     * The declared `range` of the SDF behind the first `binding.samplers`
     * entry with an `outline` source; 0 when no sampler declares one.
     */
    val sdfRange: Double = 0.0,
    /** That SDF's `viewBox[2]` (author-units width); 0 when absent. */
    val sdfViewBoxW: Double = 0.0,
    /**
     * The device-pixel ratio (the surface density) — so a pass value authored
     * in CSS-ish units can scale to device px (web parity).
     */
    val dpr: Double = 1.0,
)

/** Which inputs an expression may read: the three evaluation entry points. */
private enum class ExprMode { FRAME, PARAMS, PASS }

private val FRAME_INPUTS = setOf("animMs", "life", "elapsedMs", "loopS", "phase")
private val PASS_INPUTS = setOf("targetMinDimPx", "sdfRange", "sdfViewBoxW", "dpr")

/**
 * Resolve an `{input}` name under the given mode — the same gating (and the
 * same error wording) as the web `evalInput`.
 */
private fun evalInput(name: String, ctx: FrameExprCtx, mode: ExprMode): Double {
    if (mode == ExprMode.PASS) {
        if (name in FRAME_INPUTS) {
            throw DopeException(
                "dope: frame input \"$name\" is not allowed in a render.pass expression " +
                    "(pass expressions are not frame-clocked)",
            )
        }
        return when (name) {
            "targetMinDimPx" -> ctx.pass?.targetMinDimPx ?: 0.0
            "sdfRange" -> ctx.pass?.sdfRange ?: 0.0
            "sdfViewBoxW" -> ctx.pass?.sdfViewBoxW ?: 0.0
            "dpr" -> ctx.pass?.dpr ?: 0.0
            else -> throw DopeException("dope: unknown frame input \"$name\"")
        }
    }
    if (name in PASS_INPUTS) {
        throw DopeException("dope: pass input \"$name\" is only allowed in a render.pass expression")
    }
    if (mode == ExprMode.PARAMS) {
        throw DopeException("dope: {input} is not allowed in a params-only expression (got \"$name\")")
    }
    return when (name) {
        "animMs" -> ctx.animMs
        "life" -> ctx.life
        "elapsedMs" -> ctx.elapsedMs
        "loopS" -> ctx.loopS
        "phase" -> ctx.phase
        else -> throw DopeException("dope: unknown frame input \"$name\"")
    }
}

private fun evalNode(node: FrameExprNode, ctx: FrameExprCtx, mode: ExprMode): Double = when (node) {
    is FrameExprNode.Num -> node.value
    is FrameExprNode.Const -> node.value
    is FrameExprNode.Param ->
        (ctx.params[node.name] as? DopeValue.Number)?.value
            ?: throw DopeException("dope: frame expr references missing/non-numeric param \"${node.name}\"")
    is FrameExprNode.Input -> evalInput(node.name, ctx, mode)
    is FrameExprNode.Add -> node.nodes.fold(0.0) { p, n -> p + evalNode(n, ctx, mode) }
    is FrameExprNode.Sub -> {
        val parts = node.nodes.map { evalNode(it, ctx, mode) }
        if (parts.isEmpty()) 0.0 else parts.drop(1).fold(parts[0]) { p, n -> p - n }
    }
    is FrameExprNode.Mul -> node.nodes.fold(1.0) { p, n -> p * evalNode(n, ctx, mode) }
    is FrameExprNode.Div -> {
        val parts = node.nodes.map { evalNode(it, ctx, mode) }
        if (parts.isEmpty()) 0.0 else parts.drop(1).fold(parts[0]) { p, n -> p / n }
    }
    is FrameExprNode.Min ->
        node.nodes.map { evalNode(it, ctx, mode) }.minOrNull() ?: Double.POSITIVE_INFINITY
    is FrameExprNode.Max ->
        node.nodes.map { evalNode(it, ctx, mode) }.maxOrNull() ?: Double.NEGATIVE_INFINITY
    is FrameExprNode.Pow -> evalNode(node.a, ctx, mode).pow(evalNode(node.b, ctx, mode))
    is FrameExprNode.Sin -> sin(evalNode(node.node, ctx, mode))
    is FrameExprNode.Cos -> cos(evalNode(node.node, ctx, mode))
    is FrameExprNode.Exp -> exp(evalNode(node.node, ctx, mode))
    is FrameExprNode.Clamp01 -> tempoClamp01(evalNode(node.node, ctx, mode))
    is FrameExprNode.Lt ->
        // Branches are evaluated LAZILY (only the taken branch), so a guard like
        // `0 < elapsedMs ? f(elapsedMs) : 0` never evaluates f outside its domain.
        if (evalNode(node.a, ctx, mode) < evalNode(node.b, ctx, mode)) {
            evalNode(node.then, ctx, mode)
        } else {
            evalNode(node.otherwise, ctx, mode)
        }
    is FrameExprNode.Envelope ->
        envelope(evalNode(node.t, ctx, mode), evalNode(node.overshoot, ctx, mode))
    is FrameExprNode.EaseOutCubic -> easeOutCubic(evalNode(node.node, ctx, mode))
    is FrameExprNode.EaseOutBack ->
        easeOutBack(evalNode(node.x, ctx, mode), evalNode(node.overshoot, ctx, mode))
}

/** Evaluate a per-frame grammar node to a number. Pure; throws outside the grammar. */
fun evalFrameExpr(node: FrameExprNode, ctx: FrameExprCtx): Double = evalNode(node, ctx, ExprMode.FRAME)

/**
 * Evaluate a PARAMS-ONLY expression (e.g. `render.shadowHeightFrac`): the same
 * grammar, but `{input}` nodes THROW — a shadow-geometry expression must be a
 * pure function of the resolved params, never of the frame clock.
 */
fun evalParamExpr(node: FrameExprNode, params: Map<String, DopeValue>): Double =
    evalNode(node, FrameExprCtx(animMs = 0.0, life = 0.0, elapsedMs = 0.0, params = params), ExprMode.PARAMS)

/**
 * Evaluate a PER-PASS expression (`render.pass`): the same grammar over the
 * resolved params plus the pass-geometry inputs (`targetMinDimPx` / `sdfRange`
 * / `sdfViewBoxW`). Frame clocks THROW — a pass expression is evaluated once
 * per pass, not per frame. Mirror of the web `evalPassExpr`.
 */
fun evalPassExpr(node: FrameExprNode, params: Map<String, DopeValue>, pass: PassExprInputs): Double =
    evalNode(
        node,
        FrameExprCtx(animMs = 0.0, life = 0.0, elapsedMs = 0.0, params = params, pass = pass),
        ExprMode.PASS,
    )
