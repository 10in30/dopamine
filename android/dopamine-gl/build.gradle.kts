// dopamine-gl — the Android OpenGL ES 3.0 rendering backbone.
//
// The analog of swift's Metal-guarded `DopamineCore` half (MetalPassRunner +
// MetalOverlayHost): the GLSurfaceView overlay HOST, the generic GL pass + panel
// runners, and the uniform binding. It depends on the pure-JVM `dopamine-core`
// (the `.dope` loader, color, tempo, the shared GLSL chunks) and adds everything
// that touches `android.*`. Effects depend on this + core and self-register.

plugins {
    id("com.android.library")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.gl"
    compileSdk = 35

    defaultConfig {
        minSdk = 24
        consumerProguardFiles("consumer-rules.pro")
    }
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
    api(project(":dopamine-core"))
}
