// dopamine-effect-fail — the failure / error moment, the emotional OPPOSITE of
// the success effects.
//
// A PURE-SHADER effect: a red/amber ✗ cross is STAMPED in light over a recoiling
// error flare, then the frame desaturates and collapses fast. Per the
// generalization mandate, EVERYTHING for the effect lives in this package: the
// shader (GLSL), the bespoke tempo, the config, and the byte-identical `.dope`
// (in assets/). It depends on dopamine-gl + dopamine-core.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.fail"
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
