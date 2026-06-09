// demo — the Android app that plays Dopamine effects (the analog of examples/demo
// + swift's Demo). Floats a translucent `DopamineView` overlay over a dark
// backdrop and fires effects on tap / autoplay.

plugins {
    id("com.android.application")
    kotlin("android")
}

android {
    namespace = "ai.dopamine.demo"
    compileSdk = 35

    defaultConfig {
        applicationId = "ai.dopamine.demo"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }
    buildTypes {
        release { isMinifyEnabled = false }
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
    implementation(project(":dopamine-gl"))
    // The heartburst reference effect always ships (it's the fallback the demo
    // registers directly). The umbrella (all nine) is preferred when present — the
    // demo picks it up at runtime with no code change once the eight land.
    implementation(project(":dopamine-effect-heartburst"))
    if (findProject(":dopamine-effects") != null) {
        implementation(project(":dopamine-effects"))
    }
}
