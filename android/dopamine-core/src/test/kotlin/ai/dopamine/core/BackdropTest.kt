// Backdrop luminance parsing — the Android mirror of the web `parseBackdrop`
// tests (packages/core/test/color.test.ts). Pure-JVM (no Android SDK).

package ai.dopamine.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class BackdropTest {
    @Test fun hexLuminance() {
        assertEquals(0.0, backdropLuminance("#000000")!!, 1e-9)
        assertEquals(1.0, backdropLuminance("#ffffff")!!, 1e-6)
        assertEquals(1.0, backdropLuminance("#FFF")!!, 1e-6) // shorthand, case-insensitive
    }

    @Test fun rgbFuncLuminance() {
        assertEquals(1.0, backdropLuminance("rgb(255, 255, 255)")!!, 1e-6)
        assertEquals(0.0, backdropLuminance("rgba(0,0,0,0.5)")!!, 1e-9)
        // space-separated; Rec.709 sum of 20/24/37 over 255
        val expected = 0.2126 * (20.0 / 255.0) + 0.7152 * (24.0 / 255.0) + 0.0722 * (37.0 / 255.0)
        assertEquals(expected, backdropLuminance("rgb(20 24 37)")!!, 1e-9)
        assertEquals(0.2126, backdropLuminance("rgb(100% 0% 0%)")!!, 1e-6) // pure red
    }

    @Test fun lightRanksAboveDark() {
        assertTrue(backdropLuminance("#ffffff")!! > backdropLuminance("#070910")!!)
    }

    @Test fun unparseableIsNull() {
        assertNull(backdropLuminance("not-a-color"))
    }
}
