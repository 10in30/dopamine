// Registry of demo effects + a type-erased overlay host.
//
// `MetalOverlayHost<Config>` is generic per effect, so we can't hold hosts for
// different effects in one array directly. `AnyEffectHost` erases the Config:
// `MetalOverlayHost` already exposes everything the demo driver needs publicly,
// so conformance is free. Each registry entry builds an effect's host (from its
// OWN resource bundle / compiled metallib) plus a feeling→`.dope` resolver.
//
// The CI "sequence" autoplay (`-autoplay all`) walks `EffectRegistry.all` in
// order and the screen recording captures the whole run. The `all` array + the
// imports are GENERATED from the one folder-discovered effect list by
// scripts/gen-registries.mjs — adding effects/<name>/ + re-running wires it here.

#if canImport(Metal)
import Metal
import QuartzCore
import simd
import DopamineCore
// dopamine:effects:imports — generated from effects/ by scripts/gen-registries.mjs; do not edit
import DopamineEffectAurora
import DopamineEffectCheckmate
import DopamineEffectComic
import DopamineEffectConfetti
import DopamineEffectDots
import DopamineEffectFail
import DopamineEffectHalo
import DopamineEffectHeartburst
import DopamineEffectInkstroke
import DopamineEffectLightning
import DopamineEffectRipple
import DopamineEffectSolarbloom
// dopamine:effects:imports:end

/// Type-erased overlay host. All members below are already public on
/// `MetalOverlayHost<Config>`, so the conformance is empty.
public protocol AnyEffectHost: AnyObject {
    var lightLayer: CAMetalLayer { get }
    var timeScale: Double { get set }
    /// Backdrop luminance (0 dark .. 1 white) for the light-out boost; 0 ⇒ the
    /// classic dark look. The Swift mirror of the web `backdrop` option.
    var backdropLuminance: Double { get set }
    /// Heavy, ahead-of-time: compile pipelines + build/upload the panel texture.
    func prepare(params: [String: DopeValue]) throws
    /// Cheap: start the prepared effect's clock.
    func play()
    /// Drift-free pause/resume of a CONTINUOUS effect's clock (battery economics
    /// for a perpetual loop in a backgrounded view).
    func pause(now: CFTimeInterval)
    func resume(now: CFTimeInterval)
    var isPaused: Bool { get }
    func tick(now: CFTimeInterval, dpr: Float, anchorPx: SIMD2<Float>, targetPx: SIMD2<Float>)
    /// Render ONE light frame at a synthetic `elapsedMs` into a CPU-readable
    /// image (the deterministic CI media recorder — see
    /// `MetalOverlayHost.renderOffscreen`). `anchorPx`/`targetPx` are logical
    /// points, `width`/`height` device px (the live `tick` convention).
    func renderOffscreen(elapsedMs: Double, width: Int, height: Int,
                         dpr: Float, anchorPx: SIMD2<Float>,
                         targetPx: SIMD2<Float>) -> CGImage?
}
extension MetalOverlayHost: AnyEffectHost {}

/// One registered effect: a name + a builder returning a ready host and a
/// feeling→params resolver (nil if the effect failed to load its metallib/dope).
/// Hybrid effects (comic/heartburst) need NO entry here for their panel — the
/// backbone builds it from the effect's `PanelDrawing` conformance.
struct DemoEffect {
    let name: String
    let build: (MTLDevice) -> (host: any AnyEffectHost, resolve: (DopeResolveInput) -> [String: DopeValue])?
}

enum EffectRegistry {
    /// Every effect the demo can play, in sequence order. GENERATED from the one
    /// folder-discovered effect list (scripts/gen-registries.mjs) — do not edit by hand.
    static let all: [DemoEffect] = [
        // dopamine:effects:all — generated from effects/ by scripts/gen-registries.mjs; do not edit
        DemoEffect(name: "aurora") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: AuroraResources.bundle),
                  let host = try? MetalOverlayHost(config: Aurora.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Aurora() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "checkmate") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: CheckmateResources.bundle),
                  let host = try? MetalOverlayHost(config: Checkmate.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Checkmate() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "comic") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: ComicResources.bundle),
                  let host = try? MetalOverlayHost(config: Comic.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Comic() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "confetti") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: ConfettiResources.bundle),
                  let host = try? MetalOverlayHost(config: Confetti.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Confetti() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "dots") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: DotsResources.bundle),
                  let host = try? MetalOverlayHost(config: Dots.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Dots() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "fail") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: FailResources.bundle),
                  let host = try? MetalOverlayHost(config: Fail.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Fail() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "halo") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: HaloResources.bundle),
                  let host = try? MetalOverlayHost(config: Halo.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Halo() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "heartburst") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: HeartburstResources.bundle),
                  let host = try? MetalOverlayHost(config: Heartburst.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Heartburst() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "inkstroke") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: InkstrokeResources.bundle),
                  let host = try? MetalOverlayHost(config: Inkstroke.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Inkstroke() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "lightning") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: LightningResources.bundle),
                  let host = try? MetalOverlayHost(config: Lightning.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Lightning() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "ripple") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: RippleResources.bundle),
                  let host = try? MetalOverlayHost(config: Ripple.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Ripple() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        DemoEffect(name: "solarbloom") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: SolarbloomResources.bundle),
                  let host = try? MetalOverlayHost(config: Solarbloom.passConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Solarbloom() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        // dopamine:effects:all:end
    ]

    /// Effect names in registry order — the data source for the demo's effect
    /// picker. Kept in sync with `all` automatically.
    static let allNames: [String] = all.map(\.name)

    /// Resolve the autoplay request to an ordered effect list:
    /// `all`/`sequence` → every effect; a specific name → just that one;
    /// anything else → the first registered effect (the manual-Fire default).
    static func resolve(_ requested: String?) -> [DemoEffect] {
        switch requested {
        case "all", "sequence": return all
        case let .some(n):       return all.first(where: { $0.name == n }).map { [$0] } ?? Array(all.prefix(1))
        case .none:              return Array(all.prefix(1))
        }
    }
}
#endif
