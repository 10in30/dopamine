# DopamineDemo — simulator-runnable iOS demo

A SwiftUI app that fires **Solarbloom** through the shared `DopamineCore` stack
and the Metal overlay (`MetalOverlayHost<SolarbloomConfig>`). It mirrors the web
demo: a sample **"Order complete"** card, a **Fire** button, and **mood /
intensity / whimsy** controls.

SwiftPM cannot emit an `.app`, so the Xcode project is generated with
[XcodeGen](https://github.com/yonaskolb/XcodeGen) from `project.yml`. The app
depends on the local SwiftPM packages (`DopamineCore`,
`DopamineEffectSolarbloom`) by **path** (`packages.Dopamine.path: ".."`).

## Generate + build + run (macOS only)

```sh
brew install xcodegen                       # one-time

cd dopamine/swift/Demo
xcodegen generate                           # → DopamineDemo.xcodeproj

# Build for an iOS Simulator destination.
xcodebuild \
  -project DopamineDemo.xcodeproj \
  -scheme DopamineDemo \
  -destination 'platform=iOS Simulator,name=iPhone 15' \
  build

# Boot a simulator, install, and launch with the AUTOPLAY arg so it fires
# Solarbloom automatically (no tap) — what CI screen-records.
xcrun simctl boot 'iPhone 15' || true
APP=$(find ~/Library/Developer/Xcode/DerivedData -name 'DopamineDemo.app' -type d | head -1)
xcrun simctl install booted "$APP"
xcrun simctl launch booted ai.polyguard.DopamineDemo -autoplay solarbloom
```

## Autoplay

Launch path for headless / CI firing — either:

- launch argument: `xcrun simctl launch booted ai.polyguard.DopamineDemo -autoplay solarbloom`
- environment variable: `DOPAMINE_AUTOPLAY=solarbloom`

When set, the app fires the effect ~0.4 s after launch (see `Autoplay` in
`Sources/DopamineDemoApp.swift` and `maybeAutoplay()` in `ContentView.swift`).

## Files

- `project.yml` — XcodeGen spec (app target + path deps + the `DopamineDemo` scheme).
- `Info.plist` — bundle id `ai.polyguard.DopamineDemo`, Metal capability, portrait.
- `Sources/DopamineDemoApp.swift` — `@main` SwiftUI `App` + autoplay parsing.
- `Sources/ContentView.swift` — card + Fire button + mood/intensity/whimsy controls.
- `Sources/SolarbloomOverlay.swift` — `UIViewRepresentable` hosting the Metal
  overlay layers + the `CADisplayLink` tick; resolves the feeling and plays.

## UNVERIFIED on Linux

XcodeGen, `xcodebuild`, the iOS SDK, and the simulator exist only on macOS — none
of this folder compiles or runs here. It is authored for the macOS CI (which
builds it, boots a sim, launches with `-autoplay`, and records a clip). The
shared `DopamineCore` + the generated uniform packer it links ARE verified on
Swift-for-Linux (see `../README.md`).
```
