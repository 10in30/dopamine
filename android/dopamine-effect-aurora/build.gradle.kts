// dopamine-effect-aurora — a calm success / ambient moment.
//
// A PURE-SHADER effect (no Canvas panel): hanging CURTAINS of polar light drape
// across the upper field, sway and sweep sideways, then gently brighten and fade.
// Per the generalization mandate, EVERYTHING for the effect lives in this package:
// the shader (GLSL), the bespoke tempo, the config, and the byte-identical `.dope`
// (in assets/). It depends on dopamine-gl + dopamine-core.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.aurora"
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
