# DopamineDemoiOS — tiny iOS demo app skeleton

This is a **source skeleton** for a minimal iOS app that hosts Solarbloom in a
`CAMetalLayer` overlay, intended for the macOS CI to build (and, as a stretch,
boot in the simulator and screen-record). It is **NOT** a SwiftPM target — an
iOS `.app` needs an Xcode project / `xcodebuild` and the iOS SDK, neither of
which exists on Linux. The CI workflow (`.github/workflows/swift.yml`) generates
a throwaway Xcode app target around these files on the macOS runner.

Everything here is `#if canImport(UIKit)` so it never blocks the Linux build of
the library package.

Files:
- `AppDelegate.swift` — boots a window with `DemoViewController`.
- `DemoViewController.swift` — creates a `MetalOverlayHost<SolarbloomConfig>`,
  loads the bundled metallib, resolves a feeling via the shared `.dope`, and
  drives a `CADisplayLink` tick. This is the integration seam the simulator
  recording would capture.

UNVERIFIED: none of this compiles or runs on Linux (no UIKit / Metal SDK). It is
authored to be built on macOS only.
