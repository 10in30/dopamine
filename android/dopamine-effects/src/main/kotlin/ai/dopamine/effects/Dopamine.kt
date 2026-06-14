// The umbrella registration — the Android analog of `@dopaminefx/effects`.
//
// Each effect module is self-contained and exposes `<Name>.register(context)`
// (it needs a Context to read its byte-identical `.dope` from the merged assets).
// `registerAll` lights up the whole set in one call. The canonical ELEVEN effects:
// solarbloom, aurora, comic, confetti, fail, heartburst, inkstroke, lightning,
// ripple, halo, dots — each on the SAME shared `.dope` spine the web + swift use.

package ai.dopamine.effects

import ai.dopamine.core.EffectRegistry
// dopamine:effects:imports — generated from effects/ by scripts/gen-registries.mjs; do not edit
import ai.dopamine.effect.aurora.Aurora
import ai.dopamine.effect.checkmate.Checkmate
import ai.dopamine.effect.comic.Comic
import ai.dopamine.effect.confetti.Confetti
import ai.dopamine.effect.dots.Dots
import ai.dopamine.effect.fail.Fail
import ai.dopamine.effect.halo.Halo
import ai.dopamine.effect.heartburst.Heartburst
import ai.dopamine.effect.inkstroke.Inkstroke
import ai.dopamine.effect.lightning.Lightning
import ai.dopamine.effect.ripple.Ripple
import ai.dopamine.effect.solarbloom.Solarbloom
// dopamine:effects:imports:end
import android.content.Context

object Dopamine {
    /** Register every built-in effect. Returns the registered effect names. */
    fun registerAll(context: Context): List<String> {
        val app = context.applicationContext
        // dopamine:effects:register — generated from effects/ by scripts/gen-registries.mjs; do not edit
        Aurora.register(app)
        Checkmate.register(app)
        Comic.register(app)
        Confetti.register(app)
        Dots.register(app)
        Fail.register(app)
        Halo.register(app)
        Heartburst.register(app)
        Inkstroke.register(app)
        Lightning.register(app)
        Ripple.register(app)
        Solarbloom.register(app)
        // dopamine:effects:register:end
        return EffectRegistry.names()
    }
}
