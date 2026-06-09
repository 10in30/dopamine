// dopamine-effect-inkstroke — the Calligraphic Verdict success moment.
//
// A PURE-SHADER effect: one full-screen fragment pass writes a calligraphic
// CHECKMARK in light — a pressure-modulated brush path with wet-ink bleed,
// bristle rake, a racing wet tip, flung droplets, and an after-shimmer underline
// (InkstrokeShader.kt). Per the generalization mandate, EVERYTHING for the effect
// lives in this package: the shader (GLSL), the bespoke tempo, the config, and
// the byte-identical `.dope` (in assets/). It depends on dopamine-gl +
// dopamine-core.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.inkstroke"
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
}
