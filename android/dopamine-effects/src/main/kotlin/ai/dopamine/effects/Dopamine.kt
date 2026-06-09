// The umbrella registration — the Android analog of `@dopamine/effects`.
//
// Each effect module is self-contained and exposes `<Name>.register(context)`
// (it needs a Context to read its byte-identical `.dope` from the merged assets).
// `registerAll` lights up the whole set in one call.
//
// SHIPS EIGHT TODAY: solarbloom, aurora, comic, confetti, fail, heartburst,
// inkstroke, ripple. The ninth — LIGHTNING — is pending a rework on another
// branch; when its `dopamine-effect-lightning` module lands, re-enable it in THREE
// places: the import + `Lightning.register(app)` call below, the `api(project(...))`
// in this module's build.gradle.kts, and the effect list in settings.gradle.kts.

package ai.dopamine.effects

import ai.dopamine.core.EffectRegistry
import ai.dopamine.effect.aurora.Aurora
import ai.dopamine.effect.comic.Comic
import ai.dopamine.effect.confetti.Confetti
import ai.dopamine.effect.fail.Fail
import ai.dopamine.effect.heartburst.Heartburst
import ai.dopamine.effect.inkstroke.Inkstroke
import ai.dopamine.effect.ripple.Ripple
import ai.dopamine.effect.solarbloom.Solarbloom
import android.content.Context

object Dopamine {
    /** Register all built-in effects (eight today). Returns the registered names. */
    fun registerAll(context: Context): List<String> {
        val app = context.applicationContext
        Solarbloom.register(app)
        Aurora.register(app)
        Comic.register(app)
        Confetti.register(app)
        Fail.register(app)
        Heartburst.register(app)
        Inkstroke.register(app)
        Ripple.register(app)
        // Lightning.register(app)  // pending rework — see header.
        return EffectRegistry.names()
    }
}
