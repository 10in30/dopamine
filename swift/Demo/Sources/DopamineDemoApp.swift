// DopamineDemo — a SwiftUI iOS app that fires Solarbloom through the SHARED
// DopamineCore stack + the Metal overlay. Mirrors the web demo: an "Order
// complete" card, a Fire button, and mood / intensity / whimsy controls.
//
// UNVERIFIED ON LINUX: this is an iOS app (UIKit/Metal/SwiftUI) — it compiles
// and runs only on an Apple toolchain (the macOS CI builds it for the iOS
// Simulator). The XcodeGen `project.yml` next to this folder turns these
// sources + the local SwiftPM packages into `DopamineDemo.xcodeproj`.
//
// AUTOPLAY (SIMULATOR ONLY): launch with `-autoplay solarbloom` (an argument the
// simulator passes via `simctl launch … --args`) — or set the env var
// `DOPAMINE_AUTOPLAY=solarbloom` — and the app fires the effect automatically
// ~0.4s after launch, so CI can screen-record a headless run with no tap. On a
// REAL DEVICE autoplay is disabled (see `Autoplay.requestedEffect`); the user
// drives the demo with the in-app effect picker + Fire button instead.

import SwiftUI

@main
struct DopamineDemoApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

/// Reads the autoplay effect name from a launch arg or env var, if present.
/// `-autoplay solarbloom` (argv) or `DOPAMINE_AUTOPLAY=solarbloom` (env).
enum Autoplay {
    static var requestedEffect: String? {
        // Autoplay is a SIMULATOR / CI affordance only. On a real device we never
        // autoplay — the user picks an effect and taps Fire — so any stray
        // `-autoplay` arg or env var is ignored there.
        #if targetEnvironment(simulator)
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-autoplay"), i + 1 < args.count {
            return args[i + 1]
        }
        if let env = ProcessInfo.processInfo.environment["DOPAMINE_AUTOPLAY"], !env.isEmpty {
            return env
        }
        return nil
        #else
        return nil
        #endif
    }

    /// Slow-motion time scale for the effect (1.0 = real time). `-slowmo 0.25`
    /// (argv) or `DOPAMINE_SLOWMO=0.25` (env) plays everything at quarter speed,
    /// etc. Used so a low-fps screen recording still samples the animation
    /// smoothly: at 1/4 speed a ~2.5fps grab sees ~10 effective fps of motion.
    static var slowmoScale: Double {
        let args = ProcessInfo.processInfo.arguments
        var raw: String?
        if let i = args.firstIndex(of: "-slowmo"), i + 1 < args.count { raw = args[i + 1] }
        else if let env = ProcessInfo.processInfo.environment["DOPAMINE_SLOWMO"], !env.isEmpty { raw = env }
        guard let raw, let v = Double(raw), v > 0, v <= 1 else { return 1.0 }
        return v
    }
}
