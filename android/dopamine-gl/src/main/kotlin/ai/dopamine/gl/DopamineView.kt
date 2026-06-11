// The Dopamine overlay host — a translucent GLSurfaceView + the conductor, the
// Android analog of `overlay.ts` + `framework/conductor.ts`.
//
// SELF-CONTAINED OVERLAY (mirrors swift's MetalOverlayHost rationale): Android,
// like Core Animation on iOS, has no per-surface `screen`-blend against arbitrary
// view content. So the surface is TRANSLUCENT, cleared transparent, and effects
// accumulate ADDITIVELY as PREMULTIPLIED light (each shader outputs alpha =
// brightness — see Look.kt's GLSL_LIGHT_OUT). Dark regions stay transparent (the
// host UI shows through); bright light reads as cast light over it — exactly the
// web's `mix-blend-mode: screen` light layer, achieved within one surface.
//
// The conductor owns the GL thread, the program cache (via GlContext), a set of
// concurrently-playing effects, and the continuous-vs-when-dirty render loop (it
// stops drawing when idle, like the web RAF loop).

package ai.dopamine.gl

import ai.dopamine.core.DopeResolveInput
import ai.dopamine.core.EffectRegistry
import ai.dopamine.core.randomSeed
import android.content.Context
import android.graphics.PixelFormat
import android.opengl.GLES30
import android.opengl.GLSurfaceView
import android.util.AttributeSet
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/** Options for a single fire (the shared feeling + an optional anchor / element box). */
data class PlayOptions(
    val mood: String = "celebratory",
    val intensity: Double = 0.7,
    val whimsy: Double = 0.5,
    val seed: UInt? = null,
    /** Anchor in device px (surface top-left origin). Null ⇒ surface centre. */
    val anchorXpx: Float? = null,
    val anchorYpx: Float? = null,
    /** Targeted element box in device px. Null ⇒ full surface. */
    val targetWidthPx: Float = 0f,
    val targetHeightPx: Float = 0f,
)

/**
 * What `DopamineView.play` returns: a `stop()` for CONTINUOUS effects (whose
 * `.dope` declares `tempo.loop` — the conductor re-arms them at every
 * `durationMs` seam until stopped). Calling `stop()` on a one-shot ends it
 * early; on an already-finished effect it is a no-op.
 */
class PlayHandle internal constructor(
    private val view: DopamineView,
    /** Whether the played effect is CONTINUOUS (loops until stopped). */
    val looping: Boolean,
) {
    /** Set on the GL thread when the drawable starts; read/written there only. */
    internal var active: Any? = null

    fun stop() {
        view.queueEvent { view.requestStop(this) }
    }
}

class DopamineView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : GLSurfaceView(context, attrs) {

    private val glContext = GlContext()
    private val density: Float = resources.displayMetrics.density

    /** Live effects, mutated ONLY on the GL thread (via onDrawFrame / queueEvent). */
    private class Active(
        val instance: EffectInstance,
        var startedAtNanos: Long,
        val durationMs: Double,
        /** CONTINUOUS effect: re-arm at durationMs instead of teardown. */
        val loops: Boolean,
    ) {
        /** Set by the play handle's `stop()`; the next frame disposes. */
        var stopRequested: Boolean = false
    }
    private val active = ArrayList<Active>()

    /** GL-thread side of `PlayHandle.stop()`. */
    internal fun requestStop(handle: PlayHandle) {
        (handle.active as? Active)?.stopRequested = true
    }

    /** Slow-motion time scale (1.0 = real time); 0.25 plays at quarter speed. */
    @Volatile var timeScale: Double = 1.0

    init {
        setEGLContextClientVersion(3)
        // RGBA8888, no depth/stencil — the overlay is a flat additive-light layer.
        setEGLConfigChooser(8, 8, 8, 8, 0, 0)
        holder.setFormat(PixelFormat.TRANSLUCENT)
        setZOrderOnTop(true) // float the overlay above the host content
        setRenderer(Renderer())
        renderMode = RENDERMODE_WHEN_DIRTY
    }

    /**
     * Fire a registered effect by name. Resolves the feeling on the caller thread
     * (pure), then builds the drawable + starts its clock on the GL thread. A
     * one-shot auto-removes when it has fully played out; a CONTINUOUS effect
     * (`tempo.loop`) re-arms at every `durationMs` seam until the returned
     * handle's `stop()` is called.
     */
    fun play(effect: String, options: PlayOptions = PlayOptions()): PlayHandle {
        val factory = EffectRegistry.get(effect)
            ?: throw IllegalArgumentException("dopamine: unknown effect \"$effect\" (registered: ${EffectRegistry.names()})")
        val drawable = factory as? DrawableEffect
            ?: throw IllegalStateException("dopamine: effect \"$effect\" is not drawable on Android")
        val seed = options.seed ?: randomSeed()
        val params = drawable.resolve(DopeResolveInput(options.mood, options.intensity, options.whimsy, seed))
        val handle = PlayHandle(this, looping = drawable.loop != null)

        queueEvent {
            val w = glContext.width
            val h = glContext.height
            val ctx = EffectContext(
                gl = glContext,
                anchorX = options.anchorXpx ?: (w / 2f),
                anchorY = options.anchorYpx ?: (h / 2f),
                targetWidthPx = options.targetWidthPx,
                targetHeightPx = options.targetHeightPx,
                density = density,
            )
            try {
                val instance = drawable.create(params, ctx)
                val fx = Active(instance, System.nanoTime(), instance.durationMs, loops = handle.looping)
                handle.active = fx
                active.add(fx)
                renderMode = RENDERMODE_CONTINUOUSLY
                requestRender()
            } catch (e: Exception) {
                android.util.Log.e("Dopamine", "create failed for $effect", e)
            }
        }
        return handle
    }

    private inner class Renderer : GLSurfaceView.Renderer {
        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            glContext.onSurfaceCreated()
            // Transparent clear + premultiplied ADDITIVE light accumulation (the
            // web light-canvas model: layers sum as light).
            GLES30.glClearColor(0f, 0f, 0f, 0f)
            GLES30.glDisable(GLES30.GL_DEPTH_TEST)
            GLES30.glEnable(GLES30.GL_BLEND)
            GLES30.glBlendEquation(GLES30.GL_FUNC_ADD)
            GLES30.glBlendFunc(GLES30.GL_ONE, GLES30.GL_ONE)
        }

        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            glContext.onSurfaceChanged(width, height)
            GLES30.glViewport(0, 0, width, height)
        }

        override fun onDrawFrame(gl: GL10?) {
            GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT)
            if (active.isEmpty()) {
                renderMode = RENDERMODE_WHEN_DIRTY
                return
            }
            // Blend state can be clobbered by Canvas/GL interop on some drivers; arm
            // it every frame so the additive-light accumulation is deterministic.
            GLES30.glEnable(GLES30.GL_BLEND)
            GLES30.glBlendEquation(GLES30.GL_FUNC_ADD)
            GLES30.glBlendFunc(GLES30.GL_ONE, GLES30.GL_ONE)

            val now = System.nanoTime()
            val it = active.iterator()
            while (it.hasNext()) {
                val fx = it.next()
                val elapsedMs = (now - fx.startedAtNanos) / 1_000_000.0 * timeScale
                fx.instance.renderAt(minOf(elapsedMs, fx.durationMs))
                if (fx.stopRequested) {
                    fx.instance.dispose()
                    it.remove()
                } else if (elapsedMs >= fx.durationMs) {
                    if (fx.loops) {
                        // CONTINUOUS effect: re-arm at the seam instead of teardown.
                        // The .dope loop contract guarantees t == durationMs renders
                        // as t == 0, so advancing the start by whole durations
                        // (several at once if frames stalled) is seamless. The
                        // advance is in REAL nanos, so it respects timeScale.
                        val cycles = Math.floor(elapsedMs / fx.durationMs)
                        fx.startedAtNanos += (cycles * fx.durationMs / timeScale * 1_000_000.0).toLong()
                    } else {
                        fx.instance.dispose()
                        it.remove()
                    }
                }
            }
            if (active.isEmpty()) renderMode = RENDERMODE_WHEN_DIRTY
        }
    }
}
