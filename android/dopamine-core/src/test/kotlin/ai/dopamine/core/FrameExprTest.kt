// Per-frame expression evaluator unit tests — mirror of the web
// `packages/core/test/frame-expr.test.ts`. The Kotlin port decodes JSON into a
// typed tree first (same as `decodeExpr`), so these tests go through
// `parseOrderedJson` + `decodeFrameExpr` — exercising the decoder AND the
// evaluator on the same cases the web pins.

package ai.dopamine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import kotlin.math.exp
import kotlin.math.sin

class FrameExprTest {

    private fun expr(json: String): FrameExprNode = decodeFrameExpr(parseOrderedJson(json))

    private fun ctx(
        params: Map<String, DopeValue> = mapOf(
            "overshoot" to DopeValue.Number(0.7),
            "scale" to DopeValue.Number(0.5),
        ),
    ): FrameExprCtx = FrameExprCtx(animMs = 250.0, life = 0.25, elapsedMs = 300.0, params = params)

    @Test
    fun evaluatesLiteralsConstsParamsAndInputs() {
        assertEquals(3.5, evalFrameExpr(expr("3.5"), ctx()), 0.0)
        assertEquals(-2.0, evalFrameExpr(expr("""{"const":-2}"""), ctx()), 0.0)
        assertEquals(0.7, evalFrameExpr(expr("""{"param":"overshoot"}"""), ctx()), 0.0)
        assertEquals(250.0, evalFrameExpr(expr("""{"input":"animMs"}"""), ctx()), 0.0)
        assertEquals(0.25, evalFrameExpr(expr("""{"input":"life"}"""), ctx()), 0.0)
        assertEquals(300.0, evalFrameExpr(expr("""{"input":"elapsedMs"}"""), ctx()), 0.0)
    }

    @Test
    fun evaluatesLoopClockInputs() {
        // Supplied by the caller (the dope-pass frame derivation) for effects
        // with tempo.loop; the calm default is 0, never a throw.
        val looping = FrameExprCtx(
            animMs = 375.0, life = 0.0625, elapsedMs = 375.0,
            params = emptyMap(), loopS = 0.375, phase = 0.25,
        )
        assertEquals(0.375, evalFrameExpr(expr("""{"input":"loopS"}"""), looping), 0.0)
        assertEquals(0.25, evalFrameExpr(expr("""{"input":"phase"}"""), looping), 0.0)
        assertEquals(0.0, evalFrameExpr(expr("""{"input":"loopS"}"""), ctx()), 0.0)
        assertEquals(0.0, evalFrameExpr(expr("""{"input":"phase"}"""), ctx()), 0.0)
        // halo's periodic breathe amp peaks at a quarter period.
        val amp = evalFrameExpr(
            expr("""{"add":[0.85,{"mul":[0.15,{"sin":{"mul":[6.283185307179586,{"input":"phase"}]}}]}]}"""),
            looping,
        )
        assertEquals(1.0, amp, 1e-9)
    }

    @Test
    fun throwsOnMissingParamUnknownInputAndUnknownNode() {
        assertThrows(DopeException::class.java) { evalFrameExpr(expr("""{"param":"nope"}"""), ctx()) }
        // A non-numeric param (e.g. the palette) is as missing as an absent one.
        assertThrows(DopeException::class.java) {
            evalFrameExpr(
                expr("""{"param":"palette"}"""),
                ctx(params = mapOf("palette" to DopeValue.Palette(emptyList()))),
            )
        }
        assertThrows(DopeException::class.java) { evalFrameExpr(expr("""{"input":"wat"}"""), ctx()) }
        // The web throws at eval; the Kotlin port throws at decode — same posture.
        assertThrows(DopeException::class.java) { expr("""{"frob":1}""") }
    }

    @Test
    fun evaluatesArithmeticWithReduceSemantics() {
        assertEquals(6.0, evalFrameExpr(expr("""{"add":[1,2,3]}"""), ctx()), 0.0)
        assertEquals(5.0, evalFrameExpr(expr("""{"sub":[10,3,2]}"""), ctx()), 0.0) // left fold from first
        assertEquals(0.75, evalFrameExpr(expr("""{"sub":[1,{"input":"life"}]}"""), ctx()), 0.0)
        assertEquals(24.0, evalFrameExpr(expr("""{"mul":[2,3,4]}"""), ctx()), 0.0)
        assertEquals(2.0, evalFrameExpr(expr("""{"div":[12,3,2]}"""), ctx()), 0.0) // left fold from first
        assertEquals(Double.POSITIVE_INFINITY, evalFrameExpr(expr("""{"div":[1,0]}"""), ctx()), 0.0) // plain IEEE
        assertEquals(1.0, evalFrameExpr(expr("""{"min":[3,1,2]}"""), ctx()), 0.0)
        assertEquals(3.0, evalFrameExpr(expr("""{"max":[3,1,2]}"""), ctx()), 0.0)
        assertEquals(1024.0, evalFrameExpr(expr("""{"pow":[2,10]}"""), ctx()), 0.0)
    }

    @Test
    fun evaluatesMathAndTempoPrimitivesIdenticallyToTempoKt() {
        assertEquals(sin(1.2), evalFrameExpr(expr("""{"sin":1.2}"""), ctx()), 0.0)
        assertEquals(exp(-0.5), evalFrameExpr(expr("""{"exp":-0.5}"""), ctx()), 0.0)
        assertEquals(tempoClamp01(1.7), evalFrameExpr(expr("""{"clamp01":1.7}"""), ctx()), 0.0)
        assertEquals(
            envelope(0.25, 0.7),
            evalFrameExpr(expr("""{"envelope":[{"input":"life"},{"param":"overshoot"}]}"""), ctx()),
            0.0,
        )
        assertEquals(easeOutCubic(0.3), evalFrameExpr(expr("""{"easeOutCubic":0.3}"""), ctx()), 0.0)
        assertEquals(easeOutBack(0.3, 0.7), evalFrameExpr(expr("""{"easeOutBack":[0.3,0.7]}"""), ctx()), 0.0)
    }

    @Test
    fun ltPicksAndLazilyEvaluatesTheRightBranch() {
        assertEquals(10.0, evalFrameExpr(expr("""{"lt":[1,2,10,20]}"""), ctx()), 0.0)
        assertEquals(20.0, evalFrameExpr(expr("""{"lt":[2,1,10,20]}"""), ctx()), 0.0)
        assertEquals(20.0, evalFrameExpr(expr("""{"lt":[1,1,10,20]}"""), ctx()), 0.0) // strict <
        // The untaken branch is never evaluated (a missing param there cannot throw).
        assertEquals(10.0, evalFrameExpr(expr("""{"lt":[1,2,10,{"param":"nope"}]}"""), ctx()), 0.0)
    }

    @Test
    fun evalParamExprEvaluatesPureParamExpressions() {
        assertEquals(
            0.4,
            evalParamExpr(expr("""{"mul":[{"param":"scale"},0.5]}"""), mapOf("scale" to DopeValue.Number(0.8))),
            0.0,
        )
        assertEquals(0.42, evalParamExpr(expr("0.42"), emptyMap()), 0.0)
    }

    @Test
    fun evalParamExprThrowsOnInput() {
        // Shadow geometry must not read the frame clock.
        assertThrows(DopeException::class.java) { evalParamExpr(expr("""{"input":"life"}"""), emptyMap()) }
    }
}
