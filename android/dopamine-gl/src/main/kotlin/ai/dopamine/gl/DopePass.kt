// Generic DATA-DRIVEN pass factory — the GL half of the web
// `framework/dope-pass.ts`. `ai.dopamine.core.dopePassPlan` derives everything
// portable (uniforms / bindings / per-frame exprs / per-pass exprs / shadow /
// consts / reduced motion) from the `.dope`; this wraps that plan into the
// runner's `PassConfig`, so the only hand-written Android source left for a
// datafied effect is its GLSL (toolchain-generated) plus any genuinely
// code-shaped hook.
//
// The honest boundary stays honest: anything code-shaped (a hand pass-uniform
// hook, a `frameArrays` precompute) is passed through the same seams
// `PassConfig` always had — a supplied `passUniforms` hook overrides the
// derived `render.pass` evaluation.

package ai.dopamine.gl

import ai.dopamine.core.DopeDoc
import ai.dopamine.core.DopeException
import ai.dopamine.core.DopePassPlan
import ai.dopamine.core.DopeValue
import ai.dopamine.core.dopePassPlan
import kotlin.math.min

/**
 * Build a {@link PassConfig} from a datafied `.dope` + its GLSL (+ optional code
 * hooks). The derived contract is pinned by the dope-config JVM tests in
 * dopamine-core.
 *
 * Pass `plan` when the factory already derived one (to share it with the
 * `resolve()` call); it defaults to deriving from `doc`.
 */
fun dopePassConfig(
    doc: DopeDoc,
    vertex: String,
    fragment: String,
    plan: DopePassPlan = dopePassPlan(doc),
    passUniforms: ((widthPx: Int, heightPx: Int, params: Map<String, DopeValue>, density: Float, targetWidthPx: Float, targetHeightPx: Float) -> Map<String, Float>)? = null,
    frameArrays: ((FrameInfo, Map<String, DopeValue>, FrameGeom) -> List<UniformArray>)? = null,
): PassConfig = PassConfig(
    vertex = vertex,
    fragment = fragment,
    uniforms = plan.uniforms,
    usesOrigin = plan.usesOrigin,
    loopPeriodMs = plan.loopPeriodMs,
    bindings = plan.bindings,
    shadowHeightFrac = { params -> plan.shadowHeightFrac(params) },
    passUniforms = passUniforms ?: derivePassUniforms(plan),
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

/**
 * The DECLARATIVE per-pass uniforms: `render.pass` evaluated against the live
 * target geometry (min dim of the targeted element box, full-canvas fallback —
 * the `targetMinDimPx` pass input), plus each sampler `on` flag pinned OFF.
 *
 * The on-flag pin is deliberate: the GL backbone has no aux-texture support,
 * so the analytic fallback must render — and GL programs are CACHED per
 * surface and reused across fires (`GlContext.program`), so uniform state
 * persists between fires; an explicit per-pass 0 (rather than relying on the
 * post-link zero-init) keeps a stale value from ever sticking.
 */
private fun derivePassUniforms(
    plan: DopePassPlan,
): ((Int, Int, Map<String, DopeValue>, Float, Float, Float) -> Map<String, Float>)? {
    if (!plan.hasPassUniforms && plan.samplerOnUniforms.isEmpty()) return null
    return { _, _, params, density, targetWidthPx, targetHeightPx ->
        val out = LinkedHashMap<String, Float>()
        for ((web, v) in plan.passUniforms(min(targetWidthPx, targetHeightPx).toDouble(), params, density.toDouble())) {
            out[web] = v.toFloat()
        }
        for (web in plan.samplerOnUniforms) out[web] = 0f
        out
    }
}

/**
 * Build a {@link PanelConfig} (the Canvas-panel runner's config) from a
 * datafied PANEL `.dope` + its GLSL + the ONE genuinely code-shaped piece —
 * the per-frame Canvas `draw` (the panel-draw seam; the generated factory
 * shims wire `draw<Name>Panel` here). Mirrors the web `dopePanelConfig`:
 * uniforms/bindings/`tempo.frame`/`render.shadowHeightFrac`/`render.pass`
 * derive exactly as for a pass effect; `panelSampler` comes from
 * `render.panel.sampler`. The panel runner never snaps "on twos"
 * (`render.config.stepping: "none"` — its frame clock IS the wall clock).
 */
fun dopePanelConfig(
    doc: DopeDoc,
    vertex: String,
    fragment: String,
    plan: DopePassPlan = dopePassPlan(doc),
    draw: PanelDraw,
): PanelConfig = PanelConfig(
    vertex = vertex,
    fragment = fragment,
    uniforms = plan.uniforms,
    panelSampler = plan.panelSampler
        ?: throw DopeException("dope: ${doc.id} has no render.panel (not a panel effect)"),
    bindings = plan.bindings,
    shadowHeightFrac = { params -> plan.shadowHeightFrac(params) },
    draw = draw,
    frame = { info, params ->
        // Panels never snap on twos, so the snapped clock IS the wall clock —
        // `animMs := elapsedMs` (mirrors the web dopePanelConfig).
        val out = LinkedHashMap<String, Float>()
        for ((name, v) in plan.frame(info.elapsedMs, info.life, info.elapsedMs, params)) {
            out[name] = v.toFloat()
        }
        out
    },
    // The same per-pass derivation as the pass config (the panel runner's
    // passUniforms now shares the pass runner's signature).
    passUniforms = derivePassUniforms(plan),
)
