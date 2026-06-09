// dopamine-effect-lightning — the high-energy "power-up / boost" STRIKE.
//
// A PURE-SHADER pass whose jagged bolt polyline (trunk + forks) is PRECOMPUTED on
// the CPU each frame (LightningRenderer.kt) and fed to the shader as the
// uVerts/uBoltMeta uniform ARRAYS via the backbone's `frameArrays` seam — the
// shader keeps the original inverse-distance plasma glow. Mirrors the reworked
// web lightning (the swift port predates this rework). Byte-identical `.dope`.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.effect.lightning"
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
