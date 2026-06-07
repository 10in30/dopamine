// Registry of demo effects + a type-erased overlay host.
//
// `MetalOverlayHost<Config>` is generic per effect, so we can't hold hosts for
// different effects in one array directly. `AnyEffectHost` erases the Config:
// `MetalOverlayHost` already exposes everything the demo driver needs publicly,
// so conformance is free. Each registry entry builds an effect's host (from its
// OWN resource bundle / compiled metallib) plus a feeling→`.dope` resolver.
//
// The CI "sequence" autoplay (`-autoplay all`) walks `EffectRegistry.all` in
// order and the screen recording captures the whole run. Each of the eight
// in-flight effect ports adds ONE entry here once merged.

#if canImport(Metal)
import Metal
import QuartzCore
import CoreGraphics
import simd
import DopamineCore
import DopamineEffectSolarbloom

/// Type-erased overlay host. All members below are already public on
/// `MetalOverlayHost<Config>`, so the conformance is empty.
public protocol AnyEffectHost: AnyObject {
    var lightLayer: CAMetalLayer { get }
    var timeScale: Double { get set }
    func play(params: [String: DopeValue]) throws
    func tick(now: CFTimeInterval, dpr: Float, anchorPx: SIMD2<Float>)
    /// Upload the offscreen panel image hybrid effects (comic/heartburst) sample;
    /// nil for pure-shader effects.
    func setPanel(_ image: CGImage?)
}
extension MetalOverlayHost: AnyEffectHost {}

/// One registered effect: a name, an optional panel drawer (hybrid effects draw
/// their word/hearts into a CGImage of the given pixel size for the resolved
/// feeling), and a builder returning a ready host + a feeling→params resolver
/// (nil if the effect failed to load its metallib/dope).
struct DemoEffect {
    let name: String
    let panel: ((_ feeling: DopeResolveInput, _ sizePx: CGSize) -> CGImage?)?
    let build: (MTLDevice) -> (host: any AnyEffectHost, resolve: (DopeResolveInput) -> [String: DopeValue])?

    init(name: String,
         panel: ((_ feeling: DopeResolveInput, _ sizePx: CGSize) -> CGImage?)? = nil,
         build: @escaping (MTLDevice) -> (host: any AnyEffectHost, resolve: (DopeResolveInput) -> [String: DopeValue])?) {
        self.name = name
        self.panel = panel
        self.build = build
    }
}

enum EffectRegistry {
    /// Every effect the demo can play, in sequence order. ONE entry per ported
    /// effect — the eight in-flight Swift ports each append a line here on merge.
    static let all: [DemoEffect] = [
        DemoEffect(name: "solarbloom") { device in
            guard let lib = try? device.makeDefaultLibrary(bundle: SolarbloomResources.bundle),
                  let host = try? MetalOverlayHost(config: SolarbloomConfig(), device: device,
                                                   library: lib, wantsShadow: false),
                  let fx = try? Solarbloom() else { return nil }
            return (host, { (try? fx.resolve($0)) ?? [:] })
        },
        // === ported effects land here, one DemoEffect entry each, e.g.: ===
        // DemoEffect(name: "aurora") { device in
        //     guard let lib = try? device.makeDefaultLibrary(bundle: AuroraResources.bundle),
        //           let host = try? MetalOverlayHost(config: AuroraConfig(), device: device,
        //                                            library: lib, wantsShadow: false),
        //           let fx = try? Aurora() else { return nil }
        //     return (host, { (try? fx.resolve($0)) ?? [:] })
        // },
    ]

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
