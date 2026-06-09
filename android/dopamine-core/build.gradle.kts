// dopamine-core — the PORTABLE spine, as a pure Kotlin/JVM library.
//
// This is the analog of swift's `DopamineCore` portable half: the `.dope` loader
// + mapping grammar, OKLCH color, the tempo primitives, shadow geometry, the
// registry + mood-registry, content pickers, and the shared GLSL "look" chunks.
// It has NO Android dependency, so the 192-case byte-parity grid (test/) runs on
// a plain JVM — the headline correctness anchor — with no Android SDK present.

plugins {
    kotlin("jvm")
    `java-library`
}

kotlin {
    // Target JVM 17 bytecode so the Android-library modules (AGP, JVM 17) can
    // consume this artifact. Compiles fine on the running JDK 21.
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

dependencies {
    testImplementation("junit:junit:4.13.2")
}

tasks.test {
    testLogging {
        events("passed", "failed", "skipped")
        showStandardStreams = true
    }
}
