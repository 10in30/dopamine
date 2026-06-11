# DopamineDemo — simulator-runnable iOS demo

A SwiftUI app that fires Dopamine effects through the shared `DopamineCore`
stack and the Metal overlay (`MetalOverlayHost`). It mirrors the web demo: a
sample **"Order complete"** card, an **Effect** picker, a **Fire** button, and
**mood / intensity / whimsy** controls.

SwiftPM cannot emit an `.app`, so the Xcode project is generated with
[XcodeGen](https://github.com/yonaskolb/XcodeGen) from `project.yml`. The app
depends on the local SwiftPM packages by **path**: `DopamineCore`
(`packages.Dopamine.path: ".."`) plus every effect's
`dist/swift/DopamineEffect<Name>` package (built by
`node tools/dopamine/src/cli.mjs build`).

## Generate + build + run (macOS only)

```sh
brew install xcodegen                       # one-time

cd swift/Demo
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

## Install to a physical device (macOS only)

```sh
cd swift/Demo
./install-device.sh                  # auto-picks the one connected iPhone
./install-device.sh "Joshua"         # or filter by device name / UDID
LAUNCH=1 ./install-device.sh         # also foreground the app after install
```

On the device there is no autoplay (that's simulator/CI only) — pick an effect
from the **Effect** menu and tap **Fire**.

The script installs XcodeGen if needed, regenerates the project, builds for the
connected device with **automatic code signing**, and installs via `devicectl`
(Xcode 15+). Signing is configured in `project.yml`
(`CODE_SIGN_STYLE: Automatic`, `DEVELOPMENT_TEAM: HY6Z2F5595` — t-zero Security
Inc). `-allowProvisioningUpdates` lets Xcode register the device and mint the
provisioning profile on first run.

Requirements: Xcode, an Apple Developer account signed into Xcode for that team,
and the iPhone paired & trusted (verify with `xcrun devicectl list devices`).
To sign with a different team, edit the `DEVELOPMENT_TEAM` line in `project.yml`
(or override `DEVELOPMENT_TEAM=…` on the `xcodebuild` invocation). Opening the
generated `DopamineDemo.xcodeproj` in Xcode and picking your device + team in
**Signing & Capabilities** works too.

## Autoplay (Simulator / CI only)

Launch path for headless / CI firing in the **Simulator** — either:

- launch argument: `xcrun simctl launch booted ai.polyguard.DopamineDemo -autoplay solarbloom`
- environment variable: `DOPAMINE_AUTOPLAY=solarbloom`

When set, the app fires the effect ~0.8 s after launch (see `Autoplay` in
`Sources/DopamineDemoApp.swift`). **On a real device autoplay is disabled** —
`Autoplay.requestedEffect` returns `nil` outside the simulator — so the app
opens idle and you drive it with the **Effect** picker + **Fire** button.

## Files

- `project.yml` — XcodeGen spec (app target + path deps + the `DopamineDemo` scheme).
- `install-device.sh` — build + install to a connected iPhone (signed, via `devicectl`).
- `Info.plist` — bundle id `ai.polyguard.DopamineDemo`, Metal capability, portrait.
- `Sources/DopamineDemoApp.swift` — `@main` SwiftUI `App` + autoplay parsing.
- `Sources/ContentView.swift` — card + effect picker + Fire button + mood/intensity/whimsy controls.
- `Sources/EffectRegistry.swift` — the demo's effect table (one entry per installed effect package).
- `Sources/EffectOverlay.swift` — `UIViewRepresentable` hosting the Metal
  overlay layers + the `CADisplayLink` tick; resolves the feeling and plays.

## UNVERIFIED on Linux

XcodeGen, `xcodebuild`, the iOS SDK, and the simulator exist only on macOS — none
of this folder compiles or runs here. It is authored for the macOS CI (which
builds it, boots a sim, launches with `-autoplay`, and records a clip). The
shared `DopamineCore` + the generated uniform packer it links ARE verified on
Swift-for-Linux (see `../README.md`).
