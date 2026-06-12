/**
 * @dopamine/build — the cross-platform effect build toolchain (programmatic API).
 *
 * A single file `effects/<id>/<slug>.dope.json` (the expanded `.dope`: the data
 * spine + the cross-platform binding contract + the per-platform `x-build` config)
 * is the source of truth for an effect on every platform. This tool builds it into
 * standalone, installable packages under `dist/` — a SwiftPM package + an npm
 * package today; Android (Gradle) next. Demos + external consumers load from there.
 */
export { buildEffect, loadEffect, portableDope } from "./build.mjs";
export { generateSwiftPackage } from "./swift.mjs";
export { generateNpmPackage } from "./web.mjs";
export { generateAndroidLibrary } from "./android.mjs";
export { buildFields, emitSwift, emitMSL, emitWeb, STANDARD } from "./uniforms.mjs";
export { transpileLogic, parseLogicModule, loadLogic } from "./logic.mjs";
