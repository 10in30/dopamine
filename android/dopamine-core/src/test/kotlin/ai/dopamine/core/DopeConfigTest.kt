// Per-effect `.dope` config contracts — the Android analog of the per-effect
// web `effects/<name>/web/test/dope-config.test.ts` suites, pure-JVM (no
// Android SDK).
//
// The five datafied effects (aurora, ripple, inkstroke, halo, fail) drive
// their uniforms / bindings / consts / scatterKey / usesOrigin / reducedMotion
// from the `.dope`, derived by `dopePassPlan` (DopePass.kt + FrameExpr.kt).
// This suite pins the derived plan — the effect's expected config — plus
// halo's loop-seam contract (its amp is PERIODIC, so t == durationMs matches
// t == 0). Numeric cross-platform parity is gated by the 192-case grid in
// ParityTest.kt; the per-frame evaluator by FrameExprTest.kt.
//
// The five test-resource `.dope` files are byte-identical copies of the
// `dist/android/dopamine-effect-<name>` embeds (android.yml md5-checks this,
// like solarbloom's).

package ai.dopamine.core

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.min

class DopeConfigTest {

    private fun resource(name: String): String {
        val stream = javaClass.classLoader.getResourceAsStream(name)
            ?: error("missing test resource: $name")
        return stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    private fun load(name: String): Pair<DopeDoc, DopePassPlan> {
        val doc = parseDope(resource("$name.dope.json"))
        return doc to dopePassPlan(doc)
    }

    // ════════════════════════════════ aurora ════════════════════════════════
    @Test
    fun auroraDerivesTheExpectedConfig() {
        val (_, plan) = load("aurora")
        assertEquals(
            setOf("uExposure", "uCoverage", "uBandY", "uBandHeight", "uSway", "uSweep", "uStriation", "uRays", "uSeed"),
            plan.uniforms.toSet(),
        )
        assertEquals(mapOf("auroraSeed" to "uSeed", "overshoot" to null), plan.bindings)
        // Aurora paints the whole sky — it ignores the fire origin.
        assertEquals(false, plan.usesOrigin)
        assertEquals(mapOf("MAX_CURTAINS" to 7.0), plan.consts)
        assertEquals("auroraSeed", plan.scatterKey)
        assertEquals(520.0, plan.reducedMotionPeakMs!!, 0.0)
        assertEquals(520.0, plan.reducedMotionHoldMs!!, 0.0)
    }

    // ════════════════════════════════ ripple ════════════════════════════════
    @Test
    fun rippleDerivesTheExpectedConfig() {
        val (_, plan) = load("ripple")
        assertEquals(
            setOf("uExposure", "uAmplitude", "uRings", "uWavelength", "uSpeed", "uCaustic", "uSeed"),
            plan.uniforms.toSet(),
        )
        assertEquals(mapOf("rippleSeed" to "uSeed", "overshoot" to null), plan.bindings)
        assertEquals(true, plan.usesOrigin)
        assertEquals(mapOf("MAX_RINGS" to 7.0, "MIN_RINGS" to 2.0), plan.consts)
        assertEquals("rippleSeed", plan.scatterKey)
        assertEquals(280.0, plan.reducedMotionPeakMs!!, 0.0)
        assertEquals(380.0, plan.reducedMotionHoldMs!!, 0.0)
    }

    // ══════════════════════════════ inkstroke ═══════════════════════════════
    @Test
    fun inkstrokeDerivesTheExpectedConfig() {
        val (_, plan) = load("inkstroke")
        assertEquals(
            setOf("uDraw", "uExposure", "uScale", "uPressure", "uWetness", "uBristle", "uDroplets", "uSeed"),
            plan.uniforms.toSet(),
        )
        assertEquals(mapOf("inkSeed" to "uSeed", "overshoot" to null), plan.bindings)
        assertEquals(true, plan.usesOrigin)
        assertEquals(mapOf("MAX_DROPS" to 64.0), plan.consts)
        assertEquals("inkSeed", plan.scatterKey)
        assertEquals(300.0, plan.reducedMotionPeakMs!!, 0.0)
        assertEquals(360.0, plan.reducedMotionHoldMs!!, 0.0)
    }

    // ════════════════════════════════ halo ══════════════════════════════════
    // The CONTINUOUS looping effect: its amp is a steady periodic breathe, so
    // the frame at t == durationMs must match t == 0 (the loop seam).
    @Test
    fun haloAmpKeepsTheLoopSeamContract() {
        val (doc, plan) = load("halo")
        val p = resolveDopeParams(
            doc,
            DopeResolveInput("electric", 0.8, 0.5, 3u),
            consts = plan.consts,
            scatterKey = plan.scatterKey!!,
        )
        val durationMs = p.number("durationMs", 1.0)
        fun at(animMs: Double): Double =
            plan.frame(animMs, min(animMs / durationMs, 1.0), animMs, p)["amp"]!!
        assertEquals("halo loop seam", at(0.0), at(durationMs), 1e-9)
    }

    @Test
    fun haloDerivesTheExpectedConfig() {
        val (_, plan) = load("halo")
        assertEquals(
            setOf("uExposure", "uRingRadius", "uRingWidth", "uBreathe", "uSweepArc", "uSweepTurns", "uGlow", "uPeriod"),
            plan.uniforms.toSet(),
        )
        // haloSeed feeds the seeded palette only — no scatterWeb, not a uniform.
        assertEquals(mapOf<String, String?>("haloSeed" to null), plan.bindings)
        assertEquals(true, plan.usesOrigin)
        assertEquals(emptyMap<String, Double>(), plan.consts)
        assertEquals("haloSeed", plan.scatterKey)
        assertEquals(0.0, plan.reducedMotionPeakMs!!, 0.0)
        assertEquals(600.0, plan.reducedMotionHoldMs!!, 0.0)
    }

    // ════════════════════════════════ fail ══════════════════════════════════
    @Test
    fun failDerivesTheExpectedConfig() {
        val (_, plan) = load("fail")
        assertEquals(
            setOf("uStamp", "uShake", "uExposure", "uSeverity", "uSdfTex", "uSdfOn", "uSdfRangePx", "uSdfStrokePx", "uBoxPx"),
            plan.uniforms.toSet(),
        )
        assertEquals(mapOf("shakeAmount" to null, "failSeed" to null, "seed" to null), plan.bindings)
        assertEquals(true, plan.usesOrigin)
        assertEquals(emptyMap<String, Double>(), plan.consts)
        assertEquals("failSeed", plan.scatterKey)
        assertEquals(200.0, plan.reducedMotionPeakMs!!, 0.0)
        assertEquals(320.0, plan.reducedMotionHoldMs!!, 0.0)
    }
}
