// dopamine-effect-comic — the Golden/Silver-Age comic-book "BAM! POW!" success
// moment.
//
// A HYBRID (Canvas-panel) effect: the jagged starburst balloon + the hand-lettered
// onomatopoeia word + bold ink contours are drawn as vector/text into an offscreen
// Canvas each frame (ComicPanel.kt) and lit by the fragment shader (ComicShader.kt:
// the Ben-Day halftone, radiating action lines, impact flash, noir↔pop styling).
// Per the generalization mandate, EVERYTHING for the effect lives in this package:
// the shader (GLSL), the bespoke tempo, the panel draw, the config, and the
// byte-identical `.dope` (in assets/). It depends on dopamine-gl + dopamine-core.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.comic"
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
