// Dopamine demo — fires effects AT a target card, on tap or on autoplay.
//
// Mirrors the web demo (examples/demo: an "Order complete" receipt card the
// effects anchor to and size against) and swift's Demo (the same card concept in
// ContentView.swift): a centered rounded card over a dark backdrop, with the
// translucent `DopamineView` overlay floating above it. Tap anywhere to fire the
// next effect at the touch point; autoplay fires at the card's center, sized to
// the card's bounds.
//
// CI / scripted control (intent extras):
//   --es autoplay all          cycle EVERY registered effect, each dwelling for
//                              ITS OWN resolved durationMs (slow-mo-scaled) + gap
//   --es autoplay <name>       play that one effect ONCE, then log
//                              "autoplay-done <name>" — the per-effect recording
//                              handshake android/ci/emulator-record.sh waits on
//   --ef slowmo 0.25           play at quarter speed (recording-sampling aid)
//   --el startDelayMs 600      delay before the first fire
// The activity is singleTop: re-`am start`-ing it with new extras re-drives the
// autoplay without restarting the process (one warm app, N recordings).

package ai.dopamine.demo

import ai.dopamine.core.DopeResolveInput
import ai.dopamine.core.EffectRegistry
import ai.dopamine.core.number
import ai.dopamine.core.randomSeed
import ai.dopamine.gl.DopamineView
import ai.dopamine.gl.PlayHandle
import ai.dopamine.gl.PlayOptions
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.Gravity
import android.view.MotionEvent
import android.view.ViewGroup
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView

class MainActivity : Activity() {

    private lateinit var view: DopamineView
    private lateinit var card: LinearLayout
    private val handler = Handler(Looper.getMainLooper())
    private var names: List<String> = emptyList()
    private var index = 0
    private val moods = listOf("serene", "celebratory", "electric")

    /** A CONTINUOUS effect (halo) loops until stopped — stop it on the next fire. */
    private var loopingHandle: PlayHandle? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = FrameLayout(this).apply {
            // The web demo's vignetted dark backdrop (its --bg gradient), so the
            // additive light overlay reads as cast light.
            background = GradientDrawable(
                GradientDrawable.Orientation.TOP_BOTTOM,
                intArrayOf(0xFF1A2336.toInt(), 0xFF0B0D12.toInt(), 0xFF070910.toInt()),
            )
        }
        card = buildCard()
        root.addView(
            card,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
                Gravity.CENTER,
            ),
        )
        view = DopamineView(this)
        // The overlay is added LAST so it z-orders above the card and owns touch.
        root.addView(
            view,
            FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT,
            ),
        )
        setContentView(root)

        // Register the available effects (the umbrella's full set when present,
        // else the heartburst reference). Returns the registered names.
        names = registerEffects(this)
        Log.i(TAG, "registered effects: $names")

        // Tap to fire the next effect at the touch point (the alternate anchor);
        // the centrepiece still sizes to the card.
        view.setOnTouchListener { _, e ->
            if (e.action == MotionEvent.ACTION_DOWN) {
                fireNext(e.x, e.y)
                true
            } else {
                false
            }
        }

        handleLaunch(intent)
    }

    /** singleTop relaunch: new extras re-drive the autoplay on the warm app. */
    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        handleLaunch(intent)
    }

    private fun handleLaunch(intent: Intent) {
        handler.removeCallbacksAndMessages(null)
        val slowmo = intent.getFloatExtra("slowmo", 1.0f).toDouble()
        view.timeScale = if (slowmo in 0.05..1.0) slowmo else 1.0
        val startDelayMs = intent.getLongExtra("startDelayMs", 600L)
        when (val autoplay = intent.getStringExtra("autoplay")) {
            null -> // A first fire so an empty launch shows something.
                handler.postDelayed({ fireNext(cardCenterX(), cardCenterY()) }, startDelayMs)
            "all", "sequence" ->
                handler.postDelayed({ autoplayTick() }, startDelayMs)
            else ->
                handler.postDelayed({ autoplayOne(autoplay) }, startDelayMs)
        }
    }

    // MARK: autoplay

    /**
     * Cycle every registered effect at the card, each dwelling for ITS OWN
     * resolved duration (the old build advanced on a fixed 2800 ms / timeScale
     * regardless of each effect's durationMs, truncating long effects and
     * padding short ones).
     */
    private fun autoplayTick() {
        if (names.isEmpty()) return
        val name = names[index % names.size]
        val dwellMs = fire(name, moodFor(name, index), cardCenterX(), cardCenterY())
        index++
        handler.postDelayed({ autoplayTick() }, dwellMs)
    }

    /**
     * Play ONE effect at the card, then log the `autoplay-done <name>` handshake
     * the CI recorder waits on. halo is CONTINUOUS — it gets one durationMs
     * (the dwell), then its looping handle is stopped.
     */
    private fun autoplayOne(name: String) {
        if (name !in names) {
            Log.w(TAG, "autoplay: unknown effect \"$name\" (registered: $names)")
            return
        }
        val dwellMs = fire(name, moodFor(name, 0), cardCenterX(), cardCenterY())
        handler.postDelayed({
            loopingHandle?.stop()
            loopingHandle = null
            Log.i(TAG, "autoplay-done $name")
        }, dwellMs)
    }

    /** Tap path: cycle effect + mood, anchored at the touch point. */
    private fun fireNext(x: Float, y: Float) {
        if (names.isEmpty()) return
        fire(names[index % names.size], moods[index % moods.size], x, y)
        index++
    }

    /**
     * Fire `name` anchored at (x, y), sized to the card, and return the REAL-time
     * dwell in ms: resolvedDurationMs / timeScale + a gap (the swift demo's
     * `dwellSeconds`). Resolving here with an explicit seed and passing the SAME
     * seed to `play` keeps the two resolves byte-identical (resolve is pure).
     */
    private fun fire(name: String, mood: String, x: Float, y: Float): Long {
        // A looping effect plays until stopped; end the previous one when the
        // cycle moves on (a real host would stop it when its "loading" finishes).
        loopingHandle?.stop()
        loopingHandle = null
        val seed = randomSeed()
        val durationMs = EffectRegistry.get(name)
            ?.resolve(DopeResolveInput(mood, INTENSITY, WHIMSY, seed))
            ?.number("durationMs", FALLBACK_DURATION_MS) ?: FALLBACK_DURATION_MS
        val handle = view.play(
            name,
            PlayOptions(
                mood = mood, intensity = INTENSITY, whimsy = WHIMSY, seed = seed,
                anchorXpx = x, anchorYpx = y,
                // Size the centrepiece to the target card's box (the web demo's
                // originTarget); fall back to ≈40% of the smaller screen dim
                // before the first layout pass.
                targetWidthPx = if (card.width > 0) card.width.toFloat()
                    else minOf(view.width, view.height) * 0.4f,
                targetHeightPx = if (card.height > 0) card.height.toFloat()
                    else minOf(view.width, view.height) * 0.4f,
            ),
        )
        if (handle.looping) loopingHandle = handle
        val dwellMs = (durationMs / view.timeScale + GAP_MS).toLong()
        Log.i(TAG, "fired $name mood=$mood durationMs=${durationMs.toLong()} dwellMs=$dwellMs")
        return dwellMs
    }

    // MARK: the target card

    /** Card center in surface device px (card and DopamineView share the root). */
    private fun cardCenterX(): Float =
        if (card.width > 0) (card.left + card.right) / 2f else view.width / 2f
    private fun cardCenterY(): Float =
        if (card.height > 0) (card.top + card.bottom) / 2f else view.height / 2f

    /**
     * The "Order complete" receipt card — visually in the family of the web
     * demo's (#141925 card, #222a3a edge, the green ✓ badge) and the swift
     * demo's orderCard.
     */
    private fun buildCard(): LinearLayout {
        val d = resources.displayMetrics.density
        fun dp(v: Float) = (v * d)
        fun dpi(v: Float) = (v * d).toInt()

        val badge = TextView(this).apply {
            text = "✓"
            textSize = 30f
            setTextColor(0xFF7FF0B0.toInt())
            gravity = Gravity.CENTER
            includeFontPadding = false
            typeface = Typeface.DEFAULT_BOLD
            background = GradientDrawable().apply {
                shape = GradientDrawable.OVAL
                setColor(0xFF10331F.toInt())
                setStroke(dpi(1f).coerceAtLeast(1), 0xFF1C5235.toInt())
            }
        }
        val title = TextView(this).apply {
            text = "Order complete"
            textSize = 20f
            setTextColor(0xFFEEF2FB.toInt())
            typeface = Typeface.create("sans-serif-medium", Typeface.BOLD)
        }
        val subtitle = TextView(this).apply {
            text = "Your dopamine hit is on its way."
            textSize = 14f
            setTextColor(0xFF8B95AD.toInt())
        }

        return LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER_HORIZONTAL
            setPadding(dpi(36f), dpi(32f), dpi(36f), dpi(32f))
            minimumWidth = dpi(280f)
            background = GradientDrawable().apply {
                cornerRadius = dp(20f)
                setColor(0xFF141925.toInt())
                setStroke(dpi(1f).coerceAtLeast(1), 0xFF222A3A.toInt())
            }
            elevation = dp(16f)
            addView(badge, LinearLayout.LayoutParams(dpi(64f), dpi(64f)).apply { bottomMargin = dpi(16f) })
            addView(title, LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT,
            ).apply { bottomMargin = dpi(6f) })
            addView(subtitle)
        }
    }

    override fun onResume() { super.onResume(); view.onResume() }
    override fun onPause() { super.onPause(); view.onPause() }

    private companion object {
        const val TAG = "DopamineDemo"
        const val INTENSITY = 0.85
        const val WHIMSY = 0.5
        const val FALLBACK_DURATION_MS = 1800.0
        /** Real-time gap between autoplay fires (the swift demo's sequence gap). */
        const val GAP_MS = 1200.0

        /** Per-effect autoplay moods (mirrors scripts/media.mjs's gallery table). */
        val mediaMoods = mapOf(
            "solarbloom" to "celebratory", "aurora" to "serene",
            "comic" to "celebratory", "confetti" to "celebratory",
            "fail" to "electric", "heartburst" to "celebratory",
            "inkstroke" to "celebratory", "lightning" to "electric",
            "ripple" to "celebratory", "halo" to "serene", "dots" to "celebratory",
        )

        fun moodFor(name: String, i: Int) =
            mediaMoods[name] ?: listOf("serene", "celebratory", "electric")[i % 3]

        /**
         * Register the effects available in this build. Prefers the `dopamine-effects`
         * umbrella (the full set) via a localized reflection lookup so the demo needs
         * NO code change as effects land; falls back to registering the heartburst
         * reference effect directly.
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
