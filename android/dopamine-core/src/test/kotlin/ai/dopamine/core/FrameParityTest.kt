// P2 frame-parity gate — the Android analog of the per-effect web
// `effects/<name>/web/test/frame-parity.test.ts` suites, on the SAME pure-JVM
// grid the 192-case resolve parity runs on (no Android SDK).
//
// The per-frame logic hooks (frame() / shadowHeightFrac / bindings / uniforms /
// consts / scatterKey / reducedMotion) moved from the hand-written per-effect
// `PassConfig`s + `<Name>Tempo.kt` files into each `.dope`, derived/evaluated by
// `dopePassPlan` (DopePass.kt + FrameExpr.kt). This suite pins the datafied
// output EXACTLY (== at Double precision — the old hooks computed Double too,
// `.toFloat()` is the same single conversion in both paths) against the FROZEN
// pre-P2 hand-written Kotlin, across a real-feeling grid × a clock grid, and
// pins the derived uniforms/bindings against the old config literals.
//
// The five test-resource `.dope` files are byte-identical copies of the
// `dist/android/dopamine-effect-<name>` embeds (android.yml md5-checks this,
// like solarbloom's).

package ai.dopamine.core

import org.junit.Assert.assertEquals
import org.junit.Test
import kotlin.math.PI
import kotlin.math.exp
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

class FrameParityTest {

    // ── the shared grids (mirror the web frame-parity suites) ──────────────
    private val lives = doubleArrayOf(0.0, 0.01, 0.049, 0.05, 0.1, 0.18, 0.3, 0.549, 0.55, 0.7, 0.9, 0.999, 1.0)
    private val intensities = doubleArrayOf(0.15, 0.6, 0.95)
    private val whimsies = doubleArrayOf(0.0, 0.5, 1.0)
    private val seeds = listOf(1u, 42u)
    private val successMoods = listOf("serene", "celebratory", "electric")
    private val failMoods = listOf("try-again", "error", "denied")

    private fun resource(name: String): String {
        val stream = javaClass.classLoader.getResourceAsStream(name)
            ?: error("missing test resource: $name")
        return stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    private fun load(name: String): Pair<DopeDoc, DopePassPlan> {
        val doc = parseDope(resource("$name.dope.json"))
        return doc to dopePassPlan(doc)
    }

    /**
     * Run `check(params, animMs, life, elapsedMs)` over the full feeling × clock
     * grid (REAL `resolveDopeParams` output; `animMs = life * durationMs`;
     * `elapsedMs` exercises both the snapped clock and a faster real clock).
     */
    private fun forEachCase(
        doc: DopeDoc,
        plan: DopePassPlan,
        moods: List<String>,
        check: (params: Map<String, DopeValue>, animMs: Double, life: Double, elapsedMs: Double) -> Unit,
    ) {
        for (mood in moods) for (i in intensities) for (w in whimsies) for (seed in seeds) {
            val p = resolveDopeParams(
                doc,
                DopeResolveInput(mood, i, w, seed),
                consts = plan.consts,
                scatterKey = plan.scatterKey ?: error("no scatterKey"),
            )
            val durationMs = p.number("durationMs", 1.0)
            for (life in lives) {
                val animMs = life * durationMs
                for (elapsedMs in doubleArrayOf(animMs, animMs / 0.7)) {
                    check(p, animMs, life, elapsedMs)
                }
            }
        }
    }

    private fun assertFrame(label: String, want: Map<String, Double>, got: Map<String, Double>) {
        assertEquals("$label frame keys", want.keys, got.keys)
        for ((k, v) in want) assertEquals("$label $k", v, got[k]!!, 0.0)
    }

    // ════════════════════════════════ aurora ════════════════════════════════
    // FROZEN pre-P2 oracle (copied verbatim from AuroraTempo.kt + the old CONFIG).
    private fun oracleAuroraSweep(animMs: Double, life: Double): Double =
        0.02 * (animMs / 1000.0) * (1.0 - 0.5 * life)

    @Test
    fun auroraFrameAndShadowMatchTheHandWrittenHooks() {
        val (doc, plan) = load("aurora")
        forEachCase(doc, plan, successMoods) { p, animMs, life, elapsedMs ->
            assertEquals("aurora shadow", p.number("bandHeight", 0.6) * 0.6, plan.shadowHeightFrac(p), 0.0)
            val want = linkedMapOf(
                "amp" to envelope(life, p.number("overshoot", 1.0)),
                "uSweep" to oracleAuroraSweep(animMs, life),
            )
            assertFrame("aurora", want, plan.frame(animMs, life, elapsedMs, p))
        }
    }

    @Test
    fun auroraDerivesTheOldConfigLiterals() {
        val (_, plan) = load("aurora")
        assertEquals(
            setOf("uExposure", "uCoverage", "uBandY", "uBandHeight", "uSway", "uSweep", "uStriation", "uRays", "uSeed"),
            plan.uniforms.toSet(),
        )
        assertEquals(mapOf("auroraSeed" to "uSeed", "overshoot" to null), plan.bindings)
        assertEquals(false, plan.usesOrigin)
        assertEquals(mapOf("MAX_CURTAINS" to 7.0), plan.consts)
        assertEquals("auroraSeed", plan.scatterKey)
        assertEquals(520.0, plan.reducedMotionPeakMs!!, 0.0)
        assertEquals(520.0, plan.reducedMotionHoldMs!!, 0.0)
    }

    // ════════════════════════════════ ripple ════════════════════════════════
    @Test
    fun rippleFrameAndShadowMatchTheHandWrittenHooks() {
        val (doc, plan) = load("ripple")
        forEachCase(doc, plan, successMoods) { p, animMs, life, elapsedMs ->
            // FROZEN: the old shadow lambda + the envelope-only frame.
            assertEquals(
                "ripple shadow",
                min(p.number("wavelength") * p.number("rings") * 0.6 + p.number("amplitude") * 0.3, 1.0),
                plan.shadowHeightFrac(p),
                0.0,
            )
            val want = linkedMapOf("amp" to envelope(life, p.number("overshoot", 1.0)))
            assertFrame("ripple", want, plan.frame(animMs, life, elapsedMs, p))
        }
    }

    @Test
    fun rippleDerivesTheOldConfigLiterals() {
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
    // FROZEN pre-P2 oracle (copied verbatim from InkstrokeTempo.kt).
    private fun oracleStrokeProgress(elapsedMs: Double): Double = easeOutCubic(elapsedMs / 360.0)

    @Test
    fun inkstrokeFrameAndShadowMatchTheHandWrittenHooks() {
        val (doc, plan) = load("inkstroke")
        forEachCase(doc, plan, successMoods) { p, animMs, life, elapsedMs ->
            assertEquals("inkstroke shadow", p.number("scale", 0.7) * 0.5, plan.shadowHeightFrac(p), 0.0)
            val want = linkedMapOf(
                "amp" to envelope(life, p.number("overshoot", 1.0)),
                // The pen draws on the on-twos-snapped animMs (shares the cel
                // jitter clock) — NOT the un-stepped elapsedMs.
                "uDraw" to oracleStrokeProgress(animMs),
            )
            assertFrame("inkstroke", want, plan.frame(animMs, life, elapsedMs, p))
        }
    }

    @Test
    fun inkstrokeDerivesTheOldConfigLiterals() {
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
    // FROZEN pre-P2 oracle (copied verbatim from HaloTempo.kt).
    private fun oracleHaloBreathe(timeS: Double, periodS: Double): Double {
        val ph = (2.0 * PI * timeS) / maxOf(periodS, 1e-3)
        return 0.85 + 0.15 * sin(ph)
    }

    @Test
    fun haloFrameAndShadowMatchTheHandWrittenHooks() {
        val (doc, plan) = load("halo")
        forEachCase(doc, plan, successMoods) { p, animMs, life, elapsedMs ->
            assertEquals(
                "halo shadow",
                min(p.number("ringRadius") + p.number("ringWidth") * 2.0, 1.0),
                plan.shadowHeightFrac(p),
                0.0,
            )
            // CONTINUOUS: a steady periodic breathe, NOT envelope(life).
            val want = linkedMapOf("amp" to oracleHaloBreathe(animMs / 1000.0, p.number("period", 1.5)))
            assertFrame("halo", want, plan.frame(animMs, life, elapsedMs, p))
        }
    }

    @Test
    fun haloDatafiedAmpKeepsTheLoopSeamContract() {
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
    fun haloDerivesTheOldConfigLiterals() {
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
    // FROZEN pre-P2 oracle (copied verbatim from FailTempo.kt; stamp/shake take
    // the un-stepped elapsedMs — what this port always did).
    private fun oracleStampProgress(elapsedMs: Double): Double {
        val x = tempoClamp01(elapsedMs / 170.0)
        return 1 - (1 - x).pow(5)
    }

    private fun oracleFailEnvelope(life: Double): Double {
        val t = tempoClamp01(life)
        if (t < 0.05) return easeOutCubic(t / 0.05)
        if (t < 0.55) return 1.0
        val fade = tempoClamp01(1 - (t - 0.55) / 0.45)
        return fade.pow(1.7)
    }

    private fun oracleShakeOffset(elapsedMs: Double, amount: Double): Double {
        if (elapsedMs <= 0) return 0.0
        val decay = exp(-elapsedMs / (300.0 * 0.35))
        val osc = sin((elapsedMs / 300.0) * PI * 7.0)
        return osc * decay * amount
    }

    @Test
    fun failFrameAndShadowMatchTheHandWrittenHooks() {
        val (doc, plan) = load("fail")
        forEachCase(doc, plan, failMoods) { p, animMs, life, elapsedMs ->
            assertEquals("fail shadow", 0.42, plan.shadowHeightFrac(p), 0.0) // bare-number passthrough
            val want = linkedMapOf(
                "amp" to oracleFailEnvelope(life),
                "uStamp" to oracleStampProgress(elapsedMs),
                "uShake" to oracleShakeOffset(elapsedMs, p.number("shakeAmount", 1.0)),
            )
            assertFrame("fail", want, plan.frame(animMs, life, elapsedMs, p))
        }
    }

    @Test
    fun failDerivesTheOldConfigLiterals() {
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
