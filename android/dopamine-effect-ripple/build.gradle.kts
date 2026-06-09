// dopamine-effect-ripple — the tactile "droplet in a still pool" acknowledge moment.
//
// A PURE-SHADER effect: a single full-screen triangle runs the water fragment
// shader (RippleShader.kt) — concentric wavefronts expand from the action point
// and refract bright caustic light, then settle. There is NO offscreen Canvas
// panel (unlike the heartburst hybrid). Per the generalization mandate,
// EVERYTHING for the effect lives in this package: the shader (GLSL), the tempo
// envelope, the config, and the byte-identical `.dope` (in assets/). It depends
// on dopamine-gl + dopamine-core.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.ripple"
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
