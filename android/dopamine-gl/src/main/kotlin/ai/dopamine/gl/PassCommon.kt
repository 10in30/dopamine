// Shared plumbing for the two generic runners — port of `framework/pass-common.ts`.
//
// KEY SIMPLIFICATION the Android port surfaces: OpenGL ES sets uniforms ONE BY
// ONE by NAME (`glUniform*(location, …)`), exactly like WebGL — so the web's
// `name → u<Name>` auto-binding ports VERBATIM, and Android needs NONE of the
// Metal-only `gen-uniforms` struct-packing machinery (that exists solely because
// a `.metal` reads one `constant Uniforms&` struct). The binding map stays the
// runner's data, not generated code.

package ai.dopamine.gl

import ai.dopamine.core.DopeValue
import ai.dopamine.core.RGB
import ai.dopamine.core.ShadowInput
import ai.dopamine.core.shadowGeometry
import android.opengl.GLES30

/** `bloomRadius` → `uBloomRadius` — the auto-binding name convention. */
fun cap(s: String): String = "u" + s.replaceFirstChar { it.uppercase() }

/**
 * The numeric `render.params` that auto-bind to a uniform: each `name → u<Name>`
 * unless an explicit `bindings` entry overrides the uniform name (or maps it to
 * `null` to skip — a param the shader ignores, e.g. a scatter seed). The tempo
 * `durationMs` is never a shader uniform.
 */
fun computeScalarBinds(
    params: Map<String, DopeValue>,
    bindings: Map<String, String?>,
): List<Pair<String, String>> {
    val out = ArrayList<Pair<String, String>>()
    for ((name, value) in params) {
        if (value !is DopeValue.Number) continue // palette etc.
        if (name == "durationMs") continue // tempo, not a shader uniform
        if (bindings.containsKey(name)) {
            val override = bindings[name] ?: continue // explicit null => skip
            out.add(name to override)
        } else {
            out.add(name to cap(name))
        }
    }
    return out
}

/** Set a float uniform iff the shader actually declares it. */
fun setF(prog: GlProgram, name: String, v: Float) {
    val loc = prog.uniform(name)
    if (loc >= 0) GLES30.glUniform1f(loc, v)
}

/** Apply a `{ name → float }` map, skipping uniforms the shader doesn't declare. */
fun applyFloatMap(prog: GlProgram, map: Map<String, Float>?) {
    if (map == null) return
    for ((n, v) in map) setF(prog, n, v)
}

/** Bind the three palette stops (uC0/uC1/uC2). */
fun bindPalette(prog: GlProgram, pal: List<RGB>) {
    if (pal.size > 0) prog.uniform("uC0").let { if (it >= 0) GLES30.glUniform3f(it, pal[0].r.toFloat(), pal[0].g.toFloat(), pal[0].b.toFloat()) }
    if (pal.size > 1) prog.uniform("uC1").let { if (it >= 0) GLES30.glUniform3f(it, pal[1].r.toFloat(), pal[1].g.toFloat(), pal[1].b.toFloat()) }
    if (pal.size > 2) prog.uniform("uC2").let { if (it >= 0) GLES30.glUniform3f(it, pal[2].r.toFloat(), pal[2].g.toFloat(), pal[2].b.toFloat()) }
}

/** Bind the auto-bound scalar params (`name → uniform`). */
fun bindScalars(
    prog: GlProgram,
    params: Map<String, DopeValue>,
    scalarBinds: List<Pair<String, String>>,
) {
    for ((name, uniformName) in scalarBinds) {
        val loc = prog.uniform(uniformName)
        if (loc >= 0) {
            val v = (params[name] as? DopeValue.Number)?.value ?: 0.0
            GLES30.glUniform1f(loc, v.toFloat())
        }
    }
}

/**
 * Apply the per-frame uniform map from an effect's `frame()` hook. The well-known
 * key `amp` maps to `uAmp`; every other key is its own uniform name.
 */
fun bindFrameUniforms(prog: GlProgram, frameUniforms: Map<String, Float>) {
    for ((n, v) in frameUniforms) {
        val loc = prog.uniform(if (n == "amp") "uAmp" else n)
        if (loc >= 0) GLES30.glUniform1f(loc, v)
    }
}

/** Set the shadow-pass uniforms (offset/soft/strength) from `shadowGeometry`. */
fun bindShadowGeometry(prog: GlProgram, widthPx: Int, heightPx: Int, heightFrac: Double, amp: Double, style: Double) {
    val minDim = minOf(widthPx, heightPx).toDouble()
    val sg = shadowGeometry(ShadowInput(minDim = minDim, heightFrac = heightFrac, amp = amp, style = style))
    prog.uniform("uShadowOffset").let { if (it >= 0) GLES30.glUniform2f(it, sg.offsetX.toFloat(), sg.offsetY.toFloat()) }
    setF(prog, "uShadowSoft", sg.soft.toFloat())
    setF(prog, "uShadowStrength", sg.strength.toFloat())
}

/**
 * Bind `uTarget` — the targeted element's size (device px) the centrepiece is
 * sized to — falling back to the full canvas when no element box was supplied.
 */
fun bindTarget(prog: GlProgram, widthPx: Int, heightPx: Int, targetWidthPx: Float, targetHeightPx: Float) {
    val loc = prog.uniform("uTarget")
    if (loc < 0) return
    val w = if (targetWidthPx > 0f) targetWidthPx else widthPx.toFloat()
    val h = if (targetHeightPx > 0f) targetHeightPx else heightPx.toFloat()
    GLES30.glUniform2f(loc, w, h)
}
