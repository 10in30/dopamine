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
)

private fun evalNode(node: FrameExprNode, ctx: FrameExprCtx, allowInputs: Boolean): Double = when (node) {
    is FrameExprNode.Num -> node.value
    is FrameExprNode.Const -> node.value
    is FrameExprNode.Param ->
        (ctx.params[node.name] as? DopeValue.Number)?.value
            ?: throw DopeException("dope: frame expr references missing/non-numeric param \"${node.name}\"")
    is FrameExprNode.Input -> {
        if (!allowInputs) {
            throw DopeException("dope: {input} is not allowed in a params-only expression (got \"${node.name}\")")
        }
        when (node.name) {
            "animMs" -> ctx.animMs
            "life" -> ctx.life
            "elapsedMs" -> ctx.elapsedMs
            else -> throw DopeException("dope: unknown frame input \"${node.name}\"")
        }
    }
    is FrameExprNode.Add -> node.nodes.fold(0.0) { p, n -> p + evalNode(n, ctx, allowInputs) }
    is FrameExprNode.Sub -> {
        val parts = node.nodes.map { evalNode(it, ctx, allowInputs) }
        if (parts.isEmpty()) 0.0 else parts.drop(1).fold(parts[0]) { p, n -> p - n }
    }
    is FrameExprNode.Mul -> node.nodes.fold(1.0) { p, n -> p * evalNode(n, ctx, allowInputs) }
    is FrameExprNode.Div -> {
        val parts = node.nodes.map { evalNode(it, ctx, allowInputs) }
        if (parts.isEmpty()) 0.0 else parts.drop(1).fold(parts[0]) { p, n -> p / n }
    }
    is FrameExprNode.Min ->
        node.nodes.map { evalNode(it, ctx, allowInputs) }.minOrNull() ?: Double.POSITIVE_INFINITY
    is FrameExprNode.Max ->
        node.nodes.map { evalNode(it, ctx, allowInputs) }.maxOrNull() ?: Double.NEGATIVE_INFINITY
    is FrameExprNode.Pow -> evalNode(node.a, ctx, allowInputs).pow(evalNode(node.b, ctx, allowInputs))
    is FrameExprNode.Sin -> sin(evalNode(node.node, ctx, allowInputs))
    is FrameExprNode.Exp -> exp(evalNode(node.node, ctx, allowInputs))
    is FrameExprNode.Clamp01 -> tempoClamp01(evalNode(node.node, ctx, allowInputs))
    is FrameExprNode.Lt ->
        // Branches are evaluated LAZILY (only the taken branch), so a guard like
        // `0 < elapsedMs ? f(elapsedMs) : 0` never evaluates f outside its domain.
        if (evalNode(node.a, ctx, allowInputs) < evalNode(node.b, ctx, allowInputs)) {
            evalNode(node.then, ctx, allowInputs)
        } else {
            evalNode(node.otherwise, ctx, allowInputs)
        }
    is FrameExprNode.Envelope ->
        envelope(evalNode(node.t, ctx, allowInputs), evalNode(node.overshoot, ctx, allowInputs))
    is FrameExprNode.EaseOutCubic -> easeOutCubic(evalNode(node.node, ctx, allowInputs))
    is FrameExprNode.EaseOutBack ->
        easeOutBack(evalNode(node.x, ctx, allowInputs), evalNode(node.overshoot, ctx, allowInputs))
}

/** Evaluate a per-frame grammar node to a number. Pure; throws outside the grammar. */
fun evalFrameExpr(node: FrameExprNode, ctx: FrameExprCtx): Double = evalNode(node, ctx, true)

/**
 * Evaluate a PARAMS-ONLY expression (e.g. `render.shadowHeightFrac`): the same
 * grammar, but `{input}` nodes THROW — a shadow-geometry expression must be a
 * pure function of the resolved params, never of the frame clock.
 */
fun evalParamExpr(node: FrameExprNode, params: Map<String, DopeValue>): Double =
    evalNode(node, FrameExprCtx(animMs = 0.0, life = 0.0, elapsedMs = 0.0, params = params), false)
