# DopamineDemoiOS — placeholder (the demo lives at `swift/Demo/`)

This folder intentionally contains no Swift sources, so nothing here can
collide with the demo app's `@main`.

The simulator-runnable iOS demo is [`swift/Demo/`](../../Demo/): a SwiftUI app
generated into `DopamineDemo.xcodeproj` by **XcodeGen** (`Demo/project.yml`),
depending on `DopamineCore` and every effect's `dist/swift/` SwiftPM package by
path. It mirrors the web demo (an "Order complete" card, an **Effect** picker,
a **Fire** button, and mood / intensity / whimsy controls) and has an
**autoplay** launch path (`-autoplay <effect>` arg or `DOPAMINE_AUTOPLAY` env)
so CI can fire it headlessly and record.

See `swift/Demo/README.md` for the exact `xcodegen` / `xcodebuild` / `simctl`
commands.
