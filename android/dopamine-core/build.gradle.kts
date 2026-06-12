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

    // Toolchain-SYNCED generated parity tests (gitignored; `dopamine build`
    // writes them): for every effect with `x-build.logic`, the GENERATED Kotlin
    // renderer + a generated JUnit grid test + the committed web-dumped fixture
    // land in src/testGenerated — so this pure-JVM module COMPILES the generated
    // Kotlin and replays the numeric parity grid with no Android SDK (the jvm CI
    // job runs `dopamine build` first). Absent (fresh clone, no build yet) the
    // dirs contribute nothing and the suite still runs.
    sourceSets["test"].kotlin.srcDir("src/testGenerated/kotlin")
}

sourceSets["test"].resources.srcDir("src/testGenerated/resources")

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
