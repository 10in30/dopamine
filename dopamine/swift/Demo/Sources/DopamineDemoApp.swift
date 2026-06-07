// DopamineDemo — a SwiftUI iOS app that fires Solarbloom through the SHARED
// DopamineCore stack + the Metal overlay. Mirrors the web demo: an "Order
// complete" card, a Fire button, and mood / intensity / whimsy controls.
//
// UNVERIFIED ON LINUX: this is an iOS app (UIKit/Metal/SwiftUI) — it compiles
// and runs only on an Apple toolchain (the macOS CI builds it for the iOS
// Simulator). The XcodeGen `project.yml` next to this folder turns these
// sources + the local SwiftPM packages into `DopamineDemo.xcodeproj`.
//
// AUTOPLAY: launch with `-autoplay solarbloom` (an argument the simulator passes
// via `simctl launch … --args`) — or set the env var `DOPAMINE_AUTOPLAY=solarbloom`
// — and the app fires the effect automatically ~0.4s after launch, so CI can
// screen-record a headless run with no tap.

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
        let args = ProcessInfo.processInfo.arguments
        if let i = args.firstIndex(of: "-autoplay"), i + 1 < args.count {
            return args[i + 1]
        }
        if let env = ProcessInfo.processInfo.environment["DOPAMINE_AUTOPLAY"], !env.isEmpty {
            return env
        }
        return nil
    }
}
