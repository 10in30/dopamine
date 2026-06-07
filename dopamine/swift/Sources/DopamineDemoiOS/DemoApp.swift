// Minimal iOS demo host for Solarbloom — macOS/iOS ONLY (guarded by UIKit+Metal).
//
// Builds on the macOS CI into a throwaway app target around these files. It does
// NOT compile on Linux (no UIKit/Metal SDK) and is intentionally excluded from
// the SwiftPM library targets — see this folder's README.
//
// It wires the SHARED stack end to end: the `.dope`-resolved param bag → the
// generic `MetalPassRunner` (via `MetalOverlayHost<SolarbloomConfig>`) → the
// CAMetalLayer overlay. The only effect-specific pieces it touches are the
// `SolarbloomConfig` + the bundled metallib name, exactly as intended.

#if canImport(UIKit) && canImport(Metal)
import UIKit
import Metal
import simd
import DopamineCore
import DopamineEffectSolarbloom

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    var window: UIWindow?
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let w = UIWindow(frame: UIScreen.main.bounds)
        w.rootViewController = DemoViewController()
        w.makeKeyAndVisible()
        window = w
        return true
    }
}

final class DemoViewController: UIViewController {
    private var host: MetalOverlayHost<SolarbloomConfig>?
    private var displayLink: CADisplayLink?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black

        guard let device = MTLCreateSystemDefaultDevice() else { return }

        // The effect's compiled shaders. SwiftPM compiles the `.metal` files into
        // the effect bundle's `default.metallib`; load it from that bundle.
        guard let library = try? device.makeDefaultLibrary(bundle: .module) else {
            // (On the demo app the metallib is built from the effect's Shaders/.)
            return
        }

        let config = SolarbloomConfig()
        host = try? MetalOverlayHost(config: config, device: device, library: library, wantsShadow: true)
        guard let host else { return }

        // Layer it over the view; size to the screen at native scale.
        let scale = view.window?.screen.scale ?? UIScreen.main.scale
        host.lightLayer.frame = view.bounds
        host.lightLayer.contentsScale = scale
        host.lightLayer.drawableSize = CGSize(width: view.bounds.width * scale,
                                              height: view.bounds.height * scale)
        view.layer.addSublayer(host.lightLayer)
        if let shadow = host.shadowLayer {
            shadow.frame = view.bounds
            shadow.contentsScale = scale
            shadow.drawableSize = host.lightLayer.drawableSize
            view.layer.insertSublayer(shadow, below: host.lightLayer)
        }

        // Resolve a feeling through the SHARED `.dope` loader and fire.
        if let solar = try? Solarbloom() {
            let params = (try? solar.resolve(DopeResolveInput(
                mood: "celebratory", intensity: 0.8, whimsy: 0.4, seed: 42))) ?? [:]
            try? host.play(params: params)
        }

        let link = CADisplayLink(target: self, selector: #selector(tick))
        link.add(to: .main, forMode: .common)
        displayLink = link
    }

    @objc private func tick() {
        let scale = Float(view.window?.screen.scale ?? UIScreen.main.scale)
        let center = SIMD2<Float>(Float(view.bounds.midX), Float(view.bounds.midY))
        host?.tick(now: CACurrentMediaTime(), dpr: scale, anchorPx: center)
    }
}
#endif
