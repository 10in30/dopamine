// dopamine-effect-halo — the calm ambient "loading" indicator.
//
// A PURE-SHADER effect: a single full-screen triangle runs the ring fragment
// shader (HaloShader.kt) — a soft luminous ring that gently breathes + rotates,
// with a highlight arc sweeping around it (the "loading" read). There is NO
// offscreen Canvas panel (unlike the heartburst hybrid). Per the generalization
// mandate, EVERYTHING for the effect lives in this package: the shader (GLSL —
// the web source reused verbatim), the tempo breathe gate, the config, and the
// byte-identical `.dope` (in assets/). It depends on dopamine-gl + dopamine-core.
//
// Halo is Dopamine's first CONTINUOUS effect: it LOOPS SEAMLESSLY (all motion is
// periodic in uTimeS with period = 1.5 s; durationMs = 6000 is 4 periods). See
// HaloShader.kt / Halo.kt.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.halo"
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
