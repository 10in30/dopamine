// dopamine-effects — the umbrella that bundles + registers all ten effects.
//
// Mirrors the web `@dopaminefx/effects` package: depends on every effect module and
// exposes a single `Dopamine.registerAll(context)` so an app lights up the whole
// set in one call (each effect still ships as its own self-contained module).

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effects"
    compileSdk = 35
    defaultConfig { minSdk = 24 }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    api(project(":dopamine-gl"))
    api(project(":dopamine-effect-solarbloom"))
    api(project(":dopamine-effect-aurora"))
    api(project(":dopamine-effect-comic"))
    api(project(":dopamine-effect-confetti"))
    api(project(":dopamine-effect-fail"))
    api(project(":dopamine-effect-heartburst"))
    api(project(":dopamine-effect-inkstroke"))
    api(project(":dopamine-effect-lightning"))
    api(project(":dopamine-effect-ripple"))
    api(project(":dopamine-effect-halo"))
}
