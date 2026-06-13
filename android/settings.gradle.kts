// Dopamine — Android / OpenGL ES port (Gradle multi-module build).
//
// Mirrors the web monorepo + the swift/ package layout:
//   • dopamine-core            — the PORTABLE spine (the `.dope` loader + mapping
//                                grammar, OKLCH color, tempo primitives, shadow,
//                                registry/mood-registry, the shared GLSL "look"
//                                chunks) as a PURE Kotlin/JVM library. No Android
//                                deps, so the 192-case byte-parity grid runs on a
//                                plain JVM — the analog of swift's Linux job, and
//                                the only module that builds with NO Android SDK.
//   • dopamine-gl              — the Android GLSurfaceView overlay host + the
//                                generic GL pass/panel runners (OpenGL ES 3.0).
//   • dopamine-effect-<name>   — one Android library per effect (shader + tempo +
//                                `.dope` + panel draw + config), self-registering.
//   • dopamine-effects         — umbrella that registers all nine (mirrors
//                                @dopaminefx/effects). Activated once all nine
//                                effect modules are present (it references them).
//   • demo                     — the Android app that plays the effects.
//
// HARD PORTABILITY RULE (mirrors swift's `#if canImport(Metal)`): Kotlin has no
// per-import compile guard, so the split is by MODULE instead. Everything that
// touches `android.*` lives in the Android-library modules; `dopamine-core` is
// pure JVM. The Android modules need the Android SDK to configure, so they are
// included ONLY when an SDK is present — letting `gradle :dopamine-core:test`
// run the parity gate locally / on a free runner with no SDK installed.

import java.io.File

pluginManagement {
    repositories {
        google()
        gradlePluginPortal()
        mavenCentral()
    }
    // Central plugin-version registry. A version here is only RESOLVED when a
    // project actually applies the plugin, so the Android Gradle Plugin is never
    // fetched on an SDK-less build (only `dopamine-core` is configured there).
    plugins {
        kotlin("jvm") version "2.1.0"
        kotlin("android") version "2.1.0"
        id("com.android.library") version "8.7.3"
        id("com.android.application") version "8.7.3"
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "dopamine-android"

// The pure-JVM spine + its byte-parity test. Always included; needs no Android SDK.
include(":dopamine-core")

// The Android GL backbone + the per-effect packages + the demo need the Android
// SDK to even CONFIGURE (AGP resolves the SDK location at configuration time), so
// include them only when an SDK is discoverable. On a dev box / free CI runner
// with no SDK, the build is core-only and `:dopamine-core:test` still runs.
val androidSdkAvailable: Boolean =
    System.getenv("ANDROID_HOME") != null ||
    System.getenv("ANDROID_SDK_ROOT") != null ||
    file("local.properties").let { it.exists() && it.readText().contains("sdk.dir") }

if (androidSdkAvailable) {
    include(":dopamine-gl")

    // Auto-discover every effect module present in the tree (a `dopamine-effect-*`
    // dir with a build.gradle.kts). New effects slot in with ZERO settings edits —
    // drop the module and it's part of the build. The canonical ten are:
    // solarbloom, aurora, comic, confetti, fail, heartburst, inkstroke, lightning,
    // ripple, halo.
    val effectModules: List<String> = (rootDir.listFiles() ?: emptyArray())
        .filter { it.isDirectory && it.name.startsWith("dopamine-effect-") && File(it, "build.gradle.kts").exists() }
        .map { it.name }
        .sorted()
    for (name in effectModules) include(":$name")

    // Effects migrated to the single-folder model (effects/<id>/) are built into
    // standalone Gradle modules under dist/android/ by the @dopaminefx/build toolchain
    // (run `node tools/dopamine/src/cli.mjs build <effect>` first). Include any that
    // are present there, pointing the project at its dist location — the demo +
    // umbrella consume them exactly like the in-tree modules. (comic is the first.)
    val distAndroid = File(rootDir, "../dist/android")
    val distEffects: List<String> = (distAndroid.listFiles() ?: emptyArray())
        .filter { it.isDirectory && it.name.startsWith("dopamine-effect-") && File(it, "build.gradle.kts").exists() }
        .map { it.name }
        .sorted()
    for (name in distEffects) {
        include(":$name")
        project(":$name").projectDir = File(distAndroid, name)
    }

    // The umbrella hard-references the effect classes it bundles, so include it ONLY
    // once every one of them is present (otherwise it can't compile). All ten ship.
    val umbrellaEffects = listOf(
        "solarbloom", "aurora", "comic", "confetti", "fail",
        "heartburst", "inkstroke", "lightning", "ripple", "halo",
    )
    val haveUmbrellaEffects = umbrellaEffects.all {
        File(rootDir, "dopamine-effect-$it/build.gradle.kts").exists() ||
            File(rootDir, "../dist/android/dopamine-effect-$it/build.gradle.kts").exists()
    }
    if (haveUmbrellaEffects && File(rootDir, "dopamine-effects/build.gradle.kts").exists()) {
        include(":dopamine-effects")
    }

    include(":demo")
} else {
    println(
        "[dopamine] Android SDK not found (ANDROID_HOME / ANDROID_SDK_ROOT / local.properties) — " +
            "configuring the pure-JVM :dopamine-core only. Run `gradle :dopamine-core:test` for the parity gate.",
    )
}
