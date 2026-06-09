// dopamine-effect-heartburst — the love / like / favorite moment.
//
// A HYBRID (Canvas-panel) effect: the hero heart + the flurry of little burst
// hearts are drawn as vector heart curves into an offscreen Canvas each frame
// (HeartburstPanel.kt) and lit by the fragment shader (HeartburstShader.kt). Per
// the generalization mandate, EVERYTHING for the effect lives in this package:
// the shader (GLSL), the bespoke tempo, the panel draw, the config, and the
// byte-identical `.dope` (in assets/). It depends on dopamine-gl + dopamine-core.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.heartburst"
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
