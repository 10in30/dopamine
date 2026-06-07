# DopamineDemoiOS — superseded by `swift/Demo/`

The earlier UIKit `@main` skeleton that lived here has been replaced by a real,
simulator-runnable **SwiftUI** demo app under [`swift/Demo/`](../../Demo/).

The new app:
- is generated into `DopamineDemo.xcodeproj` by **XcodeGen** (`Demo/project.yml`),
  depending on the local SwiftPM packages by path;
- mirrors the web demo: an "Order complete" card, a **Fire** button, and
  mood / intensity / whimsy controls;
- fires **Solarbloom** through `DopamineCore` + the Metal overlay
  (`MetalOverlayHost<SolarbloomConfig>`), wrapped for SwiftUI in
  `SolarbloomOverlay` (a `UIViewRepresentable`);
- has an **autoplay** launch path (`-autoplay solarbloom` arg or
  `DOPAMINE_AUTOPLAY=solarbloom` env) so CI can fire it headlessly and record.

See `swift/Demo/README.md` for the exact `xcodegen` / `xcodebuild` / `simctl`
commands. This folder is intentionally left empty (no Swift sources) so it can't
collide with the app's `@main`.
