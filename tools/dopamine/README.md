# @dopaminefx/build

The Dopamine cross-platform effect build toolchain. It reads a single effect
folder (`effects/<name>/`) — the canonical `.dope.json` plus the `web/` sources —
and emits **standalone, installable platform packages**: an npm package, a
SwiftPM package, and a Gradle library, each embedding a byte-identical portable
`.dope`.

## Install

```bash
npm install --save-dev @dopaminefx/build
```

## Usage

```bash
# Regenerate every platform artifact (or pass effect folders to scope it).
dopamine build
dopamine build effects/aurora

# CI staleness gate — fails if a committed source would produce a different build.
dopamine build --check
```

From one GLSL ES 3.00 shader source it generates the Metal (`.metal`) and Kotlin
(`.kt`) shader variants; from the `.dope` `render.params` + `binding` contract it
generates the Metal uniform struct + packing; and it generates the Swift/Android
factory shells for fully declarative effects. See
[`docs/effect-format.md`](https://github.com/10in30/dopamine/blob/main/docs/effect-format.md)
for the format the toolchain consumes.

## Requirements

- Node 20+.
- For effects that bundle display faces (e.g. `comic`), the woff2→ttf conversion
  needs Python with `fonttools` + `brotli` installed.

MIT © 10in30
