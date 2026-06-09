// Cross-platform byte-parity test — the headline proof that the ported Kotlin
// math + the SHARED `.dope` data agree with the web (and the swift port).
//
// It loads the SAME `solarbloom-parity.json` fixture the swift `ParityTests`
// asserts against (dumped by running the ACTUAL web loader.ts across a
// mood × intensity × whimsy × seed grid — ground truth, not a reimplementation),
// resolves the bundled `solarbloom.dope.json` across that 192-case grid in
// Kotlin, and asserts every scalar + palette stop is IDENTICAL to the web output.
// This catches any drift in the PRNG order, the OKLCH math, the mapping grammar,
// the clamp flags, or the default-mood fallback.

package ai.dopamine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ParityTest {

    private val maxMotes = mapOf("MAX_MOTES" to 80.0)
    private val scatterKey = "moteSeed"
    private val eps = 1e-9

    private fun resource(name: String): String {
        val stream = javaClass.classLoader.getResourceAsStream(name)
            ?: error("missing test resource: $name")
        return stream.bufferedReader(Charsets.UTF_8).use { it.readText() }
    }

    private fun loadDoc(): DopeDoc = parseDope(resource("solarbloom.dope.json"))

    /** (1) The bundled `.dope` parses + carries the canonical web id/magic. */
    @Test
    fun dopeBytesAreShared() {
        val doc = loadDoc()
        assertEquals("dopamine.success.solarbloom", doc.id)
        assertEquals("dopamine-effect", doc.fmt)
    }

    /** (2) Kotlin resolve output == web loader output across the whole 192 grid. */
    @Test
    fun resolveParityAcrossGrid() {
        val doc = loadDoc()
        val fixture = parseOrderedJson(resource("solarbloom-parity.json"))
        val cases = fixture["cases"]?.asArray ?: error("fixture missing cases")

        assertEquals("expected the full grid", 192, cases.size)

        for (c in cases) {
            val mood = c["mood"]!!.asString!!
            val intensity = c["intensity"]!!.asNumber!!
            val whimsy = c["whimsy"]!!.asNumber!!
            val seedD = c["seed"]!!.asNumber!!
            val seed = seedD.toLong().toUInt()
            val label = "$mood/$intensity/$whimsy/$seedD"

            val out = resolveDopeParams(
                doc,
                DopeResolveInput(mood, intensity, whimsy, seed),
                consts = maxMotes,
                scatterKey = scatterKey,
            )

            // Scalars.
            val scalars = c["scalars"]!!.asObject!!
            for ((key, expectedJson) in scalars) {
                val expected = expectedJson.asNumber!!
                val got = (out[key] as? DopeValue.Number)?.value
                assertTrue("missing scalar $key for $label", got != null)
                assertEquals("scalar $key for $label", expected, got!!, eps)
            }

            // Palette (3 linear-RGB stops).
            val palette = c["palette"]!!.asArray!!
            val pal = (out["palette"] as? DopeValue.Palette)?.stops ?: error("missing palette for $label")
            assertEquals(palette.size, pal.size)
            for ((idx, stopJson) in palette.withIndex()) {
                val stop = stopJson.asArray!!
                assertEquals("pal[$idx].r for $label", stop[0].asNumber!!, pal[idx].r, eps)
                assertEquals("pal[$idx].g for $label", stop[1].asNumber!!, pal[idx].g, eps)
                assertEquals("pal[$idx].b for $label", stop[2].asNumber!!, pal[idx].b, eps)
            }
        }
    }

    /** The whimsy→band picker matches the web `pickBand` (3 equal bands). */
    @Test
    fun pickBandMatchesWeb() {
        val bands = listOf("a", "b", "c")
        assertEquals("a", pickBand(bands, 0.0))
        assertEquals("b", pickBand(bands, 0.5))
        assertEquals("c", pickBand(bands, 1.0))
    }
}
