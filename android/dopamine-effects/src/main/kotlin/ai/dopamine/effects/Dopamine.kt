// The umbrella registration — the Android analog of `@dopamine/effects`.
//
// Each effect module is self-contained and exposes `<Name>.register(context)`
// (it needs a Context to read its byte-identical `.dope` from the merged assets).
// `registerAll` lights up the whole set in one call. The canonical TEN effects:
// solarbloom, aurora, comic, confetti, fail, heartburst, inkstroke, lightning,
// ripple, halo — each ported on the SAME shared `.dope` spine the web + swift use.

package ai.dopamine.effects

import ai.dopamine.core.EffectRegistry
import ai.dopamine.effect.aurora.Aurora
import ai.dopamine.effect.comic.Comic
import ai.dopamine.effect.confetti.Confetti
import ai.dopamine.effect.fail.Fail
import ai.dopamine.effect.halo.Halo
import ai.dopamine.effect.heartburst.Heartburst
import ai.dopamine.effect.inkstroke.Inkstroke
import ai.dopamine.effect.lightning.Lightning
import ai.dopamine.effect.ripple.Ripple
import ai.dopamine.effect.solarbloom.Solarbloom
import android.content.Context

object Dopamine {
    /** Register all ten built-in effects. Returns the registered effect names. */
    fun registerAll(context: Context): List<String> {
        val app = context.applicationContext
        Solarbloom.register(app)
        Aurora.register(app)
        Comic.register(app)
        Confetti.register(app)
        Fail.register(app)
        Heartburst.register(app)
        Inkstroke.register(app)
        Lightning.register(app)
        Ripple.register(app)
        Halo.register(app)
        return EffectRegistry.names()
    }
}
