# Dopamine ✨

**Gorgeous, next-generation visual effects — implemented twice from one shared
data spine.** Algorithmic color (unique every fire), motion informed by the
natural world, hardware-accelerated, and usable as a component that sits in your
page *and* casts real light onto the UI beneath it. You pick a **mood**, an
**intensity**, and an amount of **whimsy** — not raw parameters.

The same effect runs on the **web** (TypeScript + WebGL2), on **Apple
platforms** (Swift + Metal), and on **Android** (Kotlin + OpenGL ES 3.0), driven
by the *same bytes* — each effect's [`.dope`](docs/effect-format.md) document.

> The portable **`.dope` file is the heart of the project** — a declarative,
> cross-platform description of an effect (its mood→params mapping, content
> pool, typography, icon). The code on either side is an interpreter for it.

## The ten effects

| Effect | Feeling | What it does |
|---|---|---|
| **solarbloom** | success | a centered radial volumetric bloom — light radiating from a point |
| **aurora** | success | shimmering aurora curtains |
| **comic** | success | a comic-book BAM/POW impact — hand-lettered affirmation slams in over a starburst (hybrid Canvas2D + WebGL) |
| **confetti** | celebration | a launched confetti burst |
| **fail** | error | a stamped-cross failure mark |
| **heartburst** | love / favorite | a lub-dub heart burst (hybrid offscreen panel + shader) |
| **inkstroke** | success | a calligraphic ink-stroke "verdict" signature |
| **lightning** | power-up | a high-energy lightning strike |
| **ripple** | success | concentric water ripples |
| **halo** | loading | a calm ambient ring of light that breathes + sweeps — the first CONTINUOUS effect, loops seamlessly |

We plan to add many more and expand the mechanisms in every effect. **Android
support ships all ten effects** — the shared portable core (byte-parity-tested
against the web) + the OpenGL ES 3.0 rendering backbone + every effect on the
same `.dope` spine (see [`android/`](android/README.md)). The effects are grounded
in research on dopamine reward responses, modern aesthetics, and a sense of whimsy.

## Repository layout

```
.
├─ packages/                  # WEB monorepo (npm workspaces)
│  ├─ core/                   # @dopamine/core — slim runtime (conductor, registries, .dope loader, pass/panel runners, engine)
│  ├─ effect-<name>/          # @dopamine/effect-<name> — one package per effect (shader + .dope + tempo + factory; self-registers)
│  ├─ effects/                # @dopamine/effects — batteries-included umbrella + <dopamine-success> element
│  └─ react/                  # @dopamine/react — <DopamineSuccess> + useDopamine()
├─ examples/demo/             # interactive Vite demo (mood/intensity/whimsy controls)
├─ scripts/                   # build/render/reel tooling + gen-uniforms.mjs (the web↔Swift uniform generator)
├─ docs/                      # .dope format spec + schema + authoring guide
├─ swift/                     # SWIFT/Metal port (SwiftPM)
│  ├─ Package.swift           # DopamineCore + DopamineEffect<Name> libraries + tests
│  ├─ Sources/DopamineCore/   # shared runtime (mirrors packages/core; Linux-portable behind canImport guards)
│  ├─ Sources/DopamineEffect<Name>/  # per-effect: Swift + .metal shader + generated *Uniforms + .dope
│  ├─ Generated/              # @generated uniform JSON (do not hand-edit — see gen-uniforms)
│  ├─ Demo/                   # XcodeGen project.yml for the iOS-Simulator demo app
│  └─ Tests/                  # portable + Metal-guarded + the cross-platform parity suite
├─ android/                   # ANDROID port (Gradle multi-module)
│  ├─ dopamine-core/          # PURE-Kotlin/JVM spine (mirrors packages/core) + the 192-case parity test — no Android SDK needed
│  ├─ dopamine-gl/            # OpenGL ES 3.0 backbone: GLSurfaceView overlay host + generic pass/panel runners
│  ├─ dopamine-effect-<name>/ # per-effect: GLSL shader + tempo + .dope (asset) + panel draw + factory (self-registers)
│  ├─ dopamine-effects/       # umbrella that registers all ten (activates once all are present)
│  └─ demo/                   # Android demo app
└─ .github/workflows/         # swift.yml (Metal/iOS CI) + web-reel.yml (reel CI) + android.yml (GL/JVM CI)
```

## Quick start — web

```bash
npm install
npm run dev        # interactive demo at localhost
```

Use it in your app — batteries-included (registers every effect):

```ts
import { celebrate } from "@dopamine/effects";
await celebrate({ mood: "celebratory", intensity: 0.8, whimsy: 0.6 });
```

Or pay only for what you import (each effect self-registers):

```ts
import "@dopamine/effect-solarbloom";
import { play } from "@dopamine/core";
await play("solarbloom", { mood: "celebratory", intensity: 0.8 });
```

Declarative element, or React:

```html
<dopamine-success mood="electric" intensity="0.9"></dopamine-success>
```
```tsx
import { DopamineSuccess } from "@dopamine/react";
<DopamineSuccess trigger={orderId} mood="celebratory" intensity={0.8} />;
```

| Option | Default | Meaning |
|---|---|---|
| `mood` | `"celebratory"` | `serene` · `celebratory` · `electric` |
| `intensity` | `0.7` | 0..1 — saturation, brightness, bloom size, overshoot |
| `whimsy` | `0.5` | 0..1 — photoreal ↔ non-photoreal (cel / hand-drawn) stylization |
| `seed` | random | pin for reproducible output |
| `origin` | center | viewport-pixel anchor |
| `target` | `document.body` | element the overlay lights (light + shadow are cast on what's beneath) |

## Quick start — Swift / Metal

```bash
cd swift
swift build          # builds DopamineCore + every DopamineEffect<Name>
swift test           # portable suites + (on macOS) Metal-guarded suites + the parity grid
```

`DopamineCore` builds on **Linux with no Apple toolchain** — every
Metal/MetalKit/UIKit type sits behind `#if canImport(Metal)` / `canImport(UIKit)`.
Apple platforms additionally get the Metal overlay host, the shader pass-runner,
and the `.metal` shaders.

The iOS demo app is generated by XcodeGen (SwiftPM can't emit an `.app`):

```bash
cd swift/Demo
xcodegen generate
xcodebuild -project DopamineDemo.xcodeproj -scheme DopamineDemo \
  -destination 'platform=iOS Simulator,name=iPhone 16' build
# then: xcrun simctl launch booted ai.polyguard.DopamineDemo -autoplay all
```

## Quick start — Android

```bash
cd android
./gradlew :dopamine-core:test     # the 192-case byte-parity grid (NO Android SDK needed)
./gradlew assembleDebug           # build the GL backbone + effects + the demo APK (needs the SDK)
```

`dopamine-core` is **pure Kotlin/JVM** — it builds + runs the parity grid on a
plain JVM with no Android SDK (the analog of swift's Linux job). The GL backbone
+ effect packages + demo are Android-library/app modules (they need the SDK).
Android uses **OpenGL ES 3.0 — the same GLSL ES 3.00 as the web's WebGL2** — so
the shaders port near-verbatim and uniforms bind by name (no Metal-style struct
codegen). Fire an effect:

```kotlin
val view = DopamineView(context)               // a translucent overlay
Heartburst.register(context)                    // or Dopamine.registerAll(context)
view.play("heartburst", PlayOptions(mood = "celebratory", intensity = 0.85))
```

See [`android/README.md`](android/README.md) for the architecture + how to port
an effect.

## Reels & recordings

Both stacks render a full ten-effect showcase in CI.

- **Web reel** — renders every effect in headless Chromium (WebGL via
  SwiftShader, no GPU needed) at a fixed timestep and stitches them into one
  video:
  ```bash
  npm run build && npm run reel    # → e2e/output/dopamine-suite.mp4
  ```
- **iOS recording** — the Metal effects running on a booted Simulator,
  screen-recorded via `simctl recordVideo` on a macOS GPU runner (see CI below).

## CI

| Workflow | Runner(s) | What it does | Artifact |
|---|---|---|---|
| [`web-reel.yml`](.github/workflows/web-reel.yml) | ubuntu | build web packages → render + stitch the reel | `dopamine-web-reel` → `e2e/output/dopamine-suite.mp4` |
| [`swift.yml`](.github/workflows/swift.yml) | macOS (`macos-15-xlarge`, M2) + ubuntu (`swift:6.0.3`) | macOS: `swift build`/`test` (Metal), the **gen-uniforms staleness gate**, XcodeGen → build the iOS demo, boot a sim, autoplay all ten, screen-record. Linux: portability build + the 192-case parity suite with no Apple SDK | `solarbloom-sim-clip` (the recorded sequence) |
| [`android.yml`](.github/workflows/android.yml) | ubuntu ×3 | **jvm**: the 192-case parity grid + `.dope` byte-parity check on a free runner (no SDK). **build**: install the SDK + `assembleDebug` the GL backbone + effects + demo. **emulator** (best-effort): boot an emulator, autoplay, `screenrecord` a clip | `dopamine-demo-apk`, `dopamine-android-clip` |

> **Note:** the macOS job needs the `macos-15-xlarge` (M2) larger runner and a
> non-zero GitHub Actions spending limit on the owning account. The web-reel and
> the Linux Swift portability job run on standard free runners.

Download artifacts from the **Actions** tab → the latest run → *Artifacts*.

## How it works (short version)

`@dopamine/core` (web) and `DopamineCore` (Swift) are thin **backbones**; each
effect plugs in from its own package with only what's genuinely per-effect — its
**shader**, its **bespoke tempo**, and its **uniform config**. Everything else
(color, mood model, the `.dope` loader/grammar, the pass/overlay runners, the
PRNG order) is shared and generalized. The two sides stay byte-identical because
they consume the *same* `.dope` document and a generator (`gen-uniforms`) emits
the Swift + Metal uniform structs from it.

See [`CLAUDE.md`](CLAUDE.md) for the full architecture, the generalization
boundary, the parity/staleness gates, and the conventions for adding effects.
Format spec: [`docs/effect-format.md`](docs/effect-format.md). Authoring guide:
[`docs/authoring-effects.md`](docs/authoring-effects.md).
