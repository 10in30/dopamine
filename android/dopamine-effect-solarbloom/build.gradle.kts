// dopamine-effect-solarbloom — the success / confirmation moment.
//
// A PURE-SHADER effect: one full-screen fragment pass renders the domain-warped
// volumetric bloom, the drifting light motes, and the checkmark drawn in light
// (SolarbloomShader.kt). Per the generalization mandate, EVERYTHING for the
// effect lives in this package: the shader (GLSL), the bespoke tempo, the config,
// and the byte-identical `.dope` (in assets/). It depends on dopamine-gl +
// dopamine-core.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.solarbloom"
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
