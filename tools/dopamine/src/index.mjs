/**
 * @dopamine/build — the cross-platform effect build toolchain (programmatic API).
 *
 * A single file `effects/<id>/<slug>.dope.json` (the expanded `.dope`: the data
 * spine + the cross-platform binding contract + the per-platform `x-build` config)
 * is the source of truth for an effect on every platform. This tool builds it into
 * standalone, installable packages under `dist/` — a SwiftPM package today;
 * Android (Gradle) + web (npm) next. Demos + external consumers load from `dist/`.
 */
export { buildEffect, loadEffect, portableDope } from "./build.mjs";
export { generateSwiftPackage } from "./swift.mjs";
export { buildFields, emitSwift, emitMSL, emitWeb, STANDARD } from "./uniforms.mjs";
