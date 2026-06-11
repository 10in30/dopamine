// Generic DATA-DRIVEN pass factory — the GL half of the web
// `framework/dope-pass.ts`. `ai.dopamine.core.dopePassPlan` derives everything
// portable (uniforms / bindings / per-frame exprs / shadow / consts / reduced
// motion) from the `.dope`; this wraps that plan into the runner's
// `PassConfig`, so the only hand-written Android source left for a datafied
// effect is its GLSL (toolchain-generated) plus any genuinely code-shaped hook.
//
// The honest boundary stays honest: anything code-shaped (fail's canvas-
// dependent pass uniforms, a `frameArrays` precompute) is passed through the
// same seams `PassConfig` always had.

package ai.dopamine.gl

import ai.dopamine.core.DopeDoc
import ai.dopamine.core.DopePassPlan
import ai.dopamine.core.DopeValue
import ai.dopamine.core.dopePassPlan

/**
 * Build a {@link PassConfig} from a datafied `.dope` + its GLSL (+ optional code
 * hooks). Equivalent, for the migrated effects, to the hand-written config
 * literals it replaced (gated by the frame-parity JVM tests in dopamine-core).
 *
 * Pass `plan` when the factory already derived one (to share it with the
 * `resolve()` call); it defaults to deriving from `doc`.
 */
fun dopePassConfig(
    doc: DopeDoc,
    vertex: String,
    fragment: String,
    plan: DopePassPlan = dopePassPlan(doc),
    passUniforms: ((widthPx: Int, heightPx: Int, params: Map<String, DopeValue>, density: Float) -> Map<String, Float>)? = null,
    frameArrays: ((FrameInfo, Map<String, DopeValue>, FrameGeom) -> List<UniformArray>)? = null,
): PassConfig = PassConfig(
    vertex = vertex,
    fragment = fragment,
    uniforms = plan.uniforms,
    usesOrigin = plan.usesOrigin,
    bindings = plan.bindings,
    shadowHeightFrac = { params -> plan.shadowHeightFrac(params) },
    passUniforms = passUniforms,
    frame = { info, params ->
        // The plan evaluates in Double (bit-parity with the old hand hooks, which
        // also computed Double); the runner consumes Float — the SAME single
        // `.toFloat()` the old configs applied.
        val out = LinkedHashMap<String, Float>()
        for ((name, v) in plan.frame(info.animMs, info.life, info.elapsedMs, params)) {
            out[name] = v.toFloat()
        }
        out
    },
    frameArrays = frameArrays,
)
