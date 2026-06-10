# Handoff: finish the Comic renderer unification (Swift + Android → web parity)

Status: the **dist trio is DONE** — Swift, web, and Android all build the comic
effect from the single `effects/comic/` folder via the `@dopamine/build` toolchain
(`tools/dopamine`) into standalone packages under `dist/`. This doc is the prompt
to finish the LAST piece: bring the web's **animated panel + embedded per-mood
display fonts + full per-letter typography** to Swift and Android (level them UP;
do not dumb the web down).

## The canonical look (the target)

`effects/comic/web/src/comic-renderer.ts` is the reference: it redraws the panel
every frame with a live slam `impactScale` + `impactPresence`, renders the word in
the **mood's embedded display face** (Bangers / Anton / Luckiest Guy) with full
per-letter typography (skew, stretch, tilt, per-letter rotation + baseline jitter,
3D extrude stacks, stacked outline layers, inkRoundness joins), and the jagged
starburst + ink. `effects/comic/{swift/ComicPanel.swift, android/ComicPanel.kt}`
are currently SIMPLIFIED: a static snapshot (`slamScale = 1`, `presence = 1`), a
system font, and a single ink contour. The starburst + vector checkmark already
match; the word path + animation + fonts are what's missing.

## Verified facts (don't re-discover)

- **No host change needed for animation.** `MetalOverlayHost.tick` /
  `renderOffscreen` already call `redrawPanel(life:…)` → `drawPanel(…, frame:
  PanelFrame(life:…))` every frame; Android's `GlPanelRunner` already redraws each
  frame with `PanelFrameInfo.elapsedMs` + `.life`. The "static snapshot" is a
  CHOICE in the draw, not a host limit. Use the live values:
  `presence = impactPresence(life)`, `slamScale = impactScale(elapsedMs,
  overshoot)` (Swift: `elapsedMs = frame.life * params.durationMs`).
- **fonttools converts woff2→ttf** (verified): `from fontTools.ttLib import
  TTFont; f = TTFont(src_woff2); f.flavor = None; f.save(dst_ttf)` (needs
  `fonttools` + `brotli`).
- **Swift compiles here**: `swift build --package-path dist/swift/DopamineEffectComic`
  (Swift 6.0.3; `scripts/web-env-setup.sh` provisions it). The Android module
  compiles only with the SDK (`android.yml` build job). Visual correctness is the
  `swift.yml` sim clip + the `android.yml` emulator clip — review after CI.

## Tasks

### 1. Fonts: store ONE woff2 per face, convert to ttf at BUILD time
- Keep a single stored format: the three SIL-OFL **woff2** (Bangers/Anton/Luckiest
  Guy). Make `effects/comic/fonts/*.woff2` the single shared source (relocate from
  `effects/comic/web/assets/fonts/`, and point `scripts/embed-fonts.mjs` at the new
  location). **Do not commit `.ttf`.**
- `dopamine build` converts woff2→ttf (via the fonttools snippet above) and bundles
  the ttf into `dist/swift/.../Resources/fonts/` + `dist/android/.../src/main/assets/fonts/`.
  Gate it so `dopamine build` still works for effects with no fonts.
- Add `fonttools` + `brotli` to `scripts/web-env-setup.sh` and run a font-prep
  (or `dopamine build`) step before gradle/swift in `swift.yml` / `android.yml` /
  `web-reel.yml`. Swift `Package.swift`: add `.copy("Resources/fonts")`.

### 2. Thread the per-mood face into the resolved bag
- Add a `string` case to `DopeValue` (Swift `case string(String)` in
  `Loader.swift`; Android `data class Str(val value: String)` in `Loader.kt`) —
  additive, existing consumers ignore it.
- Port `resolveTypography` (from `packages/core/src/framework/content.ts`) to Swift
  `DopamineCore/Content.swift` + Android `dopamine-core/Content.kt`. It reads
  `doc.typography.perMood[mood]` + `.fields` and evaluates them with the EXISTING
  grammar evaluator (`evalExpr`/`decodeExpr`) — the per-mood baseline is the
  `EvalCtx.baseline`. Returns `fontStack` + the numeric curve fields.
- In `Comic.resolve` (Swift) + `Comic.kt` `resolve` (Android), compose the
  typography into the bag (mirroring the web `composeComic`): add `fontStack`/`face`
  (string) + `fontSkew`/`fontTilt`/`fontStretchX`/`fontTracking`/`outlineLayers`/
  `extrudeDepth`/`letterRotJitter`/`letterBaselineJitter`/`inkRoundness`. **Additive
  only — do not change the numeric/palette path; the parity gates must stay green.**

### 3. Animate + full typography in the panels
Rewrite `effects/comic/swift/ComicPanel.swift` + `effects/comic/android/ComicPanel.kt`
to mirror `comic-renderer.ts`:
- live `slamScale`/`presence` (task 1 facts);
- register/load the per-mood face (Swift `CTFontManagerRegisterGraphicsFont` from
  `Bundle.module` `Resources/fonts/`; Android `Typeface.createFromAsset("fonts/…")`),
  picked from the bag's `face`;
- per-letter layout (measure + tracking), the skew/stretch transform
  (`CGAffineTransform` / Canvas matrix), tilt, per-letter rotation + baseline jitter
  (`mulberry32((comicSeed*2654435761) >>> 0)`), 3D extrude stacks, stacked outline
  layers, inkRoundness joins, bright fill. Keep the starburst + checkmark.

## Verify
`swift build --package-path dist/swift/DopamineEffectComic` (here) · `npm test`
(web reference unchanged) · `gradle :dopamine-core:test` · `dopamine build --check`.
Then the CI sim/emulator clips for the visuals.

## Guardrails
Don't touch the `.dope` numeric/palette/tempo data path (byte-parity gates).
`DopeValue.string` + typography composition are additive. Commit author
`Claude <noreply@anthropic.com>`.
