/**
 * @dopamine/build — the cross-platform effect build toolchain (programmatic API).
 *
 * A single folder under `effects/<id>/` (the expanded `.dope` package: the data
 * spine + per-platform sources + a binding manifest) is the source of truth for
 * an effect on every platform. This tool builds it into standalone, installable
 * packages under `dist/` — a SwiftPM package today; Android (Gradle) + web (npm)
 * next. Demo apps (and external consumers) load the built packages from `dist/`.
 */
export { buildEffect, loadEffect } from "./build.mjs";
export { generateSwiftPackage } from "./swift.mjs";
export { buildFields, emitSwift, emitMSL, emitWeb, STANDARD } from "./uniforms.mjs";
