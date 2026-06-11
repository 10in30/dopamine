// The Android drawable-effect contracts — the analog of `framework/effect.ts`.
//
// `dopamine-core` defines the PORTABLE `EffectFactory` (name + `resolve` → the
// flat `.dope` bag). Here we add the GPU half: `DrawableEffect` (which can build
// a drawable `EffectInstance` from resolved params + a GL context) — exactly the
// swift split where `create()` sits behind `#if canImport(Metal)`.

package ai.dopamine.gl

import ai.dopamine.core.DopeLoop
import ai.dopamine.core.DopeValue
import ai.dopamine.core.EffectFactory

/**
 * Everything an effect instance needs to draw, supplied by the host. Coordinates
 * are DEVICE PIXELS (the GLSurfaceView drawable space); `density` is the
 * dpr-equivalent used only to scale physically-sized features (stroke weight,
 * halftone cell) the way the web multiplied by `dpr`.
 */
data class EffectContext(
    val gl: GlContext,
    /** Effect origin in device px, relative to the surface top-left. */
    val anchorX: Float,
    val anchorY: Float,
    /** Targeted element box in device px the centrepiece is sized to; 0 ⇒ full canvas. */
    val targetWidthPx: Float,
    val targetHeightPx: Float,
    /** Screen density — scales physically-sized features (web's `dpr`). */
    val density: Float,
)

/** A live, drawable effect. Pure function of time: same `elapsedMs` → same frame. */
interface EffectInstance {
    /** Total length in ms after which the effect has fully played out. */
    val durationMs: Double

    /** Draw the frame at `elapsedMs` since the effect started. */
    fun renderAt(elapsedMs: Double)

    /** Release any per-instance GPU resources (not shared/cached programs). */
    fun dispose()
}

/** Per-frame timing for a pure-shader effect's `frame()` hook. */
data class FrameInfo(
    /** The "on twos"-snapped animation clock in ms (stepping already applied). */
    val animMs: Double,
    /** Normalized life 0..1 (animMs / durationMs, clamped). */
    val life: Double,
    /** The REAL (un-stepped) elapsed ms — for timing that must stay smooth. */
    val elapsedMs: Double,
)

/** Per-frame timing for a Canvas panel effect's draw + frame hooks. */
data class PanelFrameInfo(
    /** Raw elapsed time since start, ms (panels don't snap "on twos"). */
    val elapsedMs: Double,
    /** Normalized life 0..1. */
    val life: Double,
    /** Screen density the panel is rendered at (web's `dpr`). */
    val density: Float,
    /** Targeted element CENTRE in panel device px (canvas space, y-down). */
    val centerX: Float,
    val centerY: Float,
    /** Targeted element SIZE in device px (the centrepiece is sized to this box). */
    val targetWidthPx: Float,
    val targetHeightPx: Float,
)

/**
 * The GPU-backed contract an effect implements on top of the portable
 * `EffectFactory`. `create()` builds a drawable for resolved params + a context.
 */
interface DrawableEffect : EffectFactory {
    fun create(params: Map<String, DopeValue>, ctx: EffectContext): EffectInstance

    /** Whether this effect wants a shadow companion pass. Default true. */
    val castsShadow: Boolean get() = true

    /** Reduced-motion peak/hold (ms). Sensible defaults if null. */
    val reducedMotionPeakMs: Double? get() = null
    val reducedMotionHoldMs: Double? get() = null

    /**
     * CONTINUOUS-loop contract (the parsed `tempo.loop`): the conductor re-arms
     * the effect at `durationMs` instead of tearing down — the host stops it
     * via the handle `DopamineView.play` returns. Null for one-shot effects.
     */
    val loop: DopeLoop? get() = null
}
