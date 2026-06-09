// Dopamine demo — fires effects over a dark backdrop, on tap or on autoplay.
//
// Mirrors the web demo + swift's Demo: a translucent `DopamineView` overlay, tap
// to fire at the touch point, and CI-friendly intent extras (`autoplay`, `slowmo`)
// so a screen recording can cycle every registered effect at a sampled-smooth
// slow-mo (like swift's `-autoplay all -slowmo 0.25`).

package ai.dopamine.demo

import ai.dopamine.core.EffectRegistry
import ai.dopamine.gl.DopamineView
import ai.dopamine.gl.PlayOptions
import android.app.Activity
import android.content.Context
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.MotionEvent
import android.view.ViewGroup

class MainActivity : Activity() {

    private lateinit var view: DopamineView
    private val handler = Handler(Looper.getMainLooper())
    private var names: List<String> = emptyList()
    private var index = 0
    private val moods = listOf("serene", "celebratory", "electric")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        view = DopamineView(this).apply {
            layoutParams = ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
            )
        }
        setContentView(view)

        // Register the available effects (the umbrella's all-nine when present, else
        // the heartburst reference). Returns the registered names.
        names = registerEffects(this)

        // CI / scripted control: `--ef slowmo 0.25 --es autoplay all`.
        val slowmo = intent.getFloatExtra("slowmo", 1.0f)
        view.timeScale = slowmo.toDouble()
        val autoplay = intent.getStringExtra("autoplay") != null

        // Tap to fire at the touch point (anchored there).
        view.setOnTouchListener { _, e ->
            if (e.action == MotionEvent.ACTION_DOWN) {
                fireNext(e.x, e.y)
                true
            } else {
                false
            }
        }

        if (autoplay) {
            // Cycle every registered effect; period scales with the slow-mo so plays
            // don't overlap when sampled for a recording.
            val periodMs = (2800.0 / view.timeScale).toLong().coerceAtLeast(500)
            val tick = object : Runnable {
                override fun run() {
                    fireNext(view.width / 2f, view.height / 2f)
                    handler.postDelayed(this, periodMs)
                }
            }
            handler.postDelayed(tick, 600)
        } else {
            // A first fire so an empty launch shows something.
            handler.postDelayed({ fireNext(view.width / 2f, view.height / 2f) }, 600)
        }
    }

    private fun fireNext(x: Float, y: Float) {
        if (names.isEmpty()) return
        val name = names[index % names.size]
        val mood = moods[index % moods.size]
        index++
        view.play(
            name,
            PlayOptions(
                mood = mood, intensity = 0.85, whimsy = 0.5,
                anchorXpx = x, anchorYpx = y,
                // Size the centrepiece to a reasonable element box (≈40% of the
                // smaller screen dim) so it's not full-screen.
                targetWidthPx = minOf(view.width, view.height) * 0.4f,
                targetHeightPx = minOf(view.width, view.height) * 0.4f,
            ),
        )
    }

    override fun onResume() { super.onResume(); view.onResume() }
    override fun onPause() { super.onPause(); view.onPause() }

    private companion object {
        /**
         * Register the effects available in this build. Prefers the `dopamine-effects`
         * umbrella (all nine) via a localized reflection lookup so the demo needs NO
         * code change when the eight land; falls back to registering the heartburst
         * reference effect directly (the only one present today).
         */
        fun registerEffects(context: Context): List<String> {
            try {
                val clazz = Class.forName("ai.dopamine.effects.Dopamine")
                val instance = clazz.getField("INSTANCE").get(null)
                val method = clazz.getMethod("registerAll", Context::class.java)
                @Suppress("UNCHECKED_CAST")
                return method.invoke(instance, context) as List<String>
            } catch (_: ClassNotFoundException) {
                // Umbrella not in this build yet — register the reference effect.
                ai.dopamine.effect.heartburst.Heartburst.register(context)
                return EffectRegistry.names()
            }
        }
    }
}
