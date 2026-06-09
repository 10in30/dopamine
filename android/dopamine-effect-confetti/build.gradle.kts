// dopamine-effect-confetti — the celebration / success burst moment.
//
// A PURE-SHADER effect: one full-screen fragment pass renders a burst of paper
// confetti that POPS upward from the action then TUMBLES DOWN under gravity with
// air-drag flutter (ConfettiShader.kt), driven by the bespoke launch-then-fall
// amplitude envelope (ConfettiTempo.kt). Per the generalization mandate,
// EVERYTHING for the effect lives in this package: the shader (GLSL), the bespoke
// tempo, the config, and the byte-identical `.dope` (in assets/). It depends on
// dopamine-gl + dopamine-core.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.confetti"
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
