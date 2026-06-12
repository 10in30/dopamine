// Per-effect gallery media recorder (CI, simulator only).
//
// Launch the demo with `-recordMedia 1` (or DOPAMINE_RECORD_MEDIA=1) and this
// renders EVERY registered effect OFF-SCREEN, frame by frame, at synthetic times
// via `MetalOverlayHost.renderOffscreen` — no screen recording, no display-link
// pacing, no slow-mo: timing is exact and per-effect segmentation is structural
// (each effect writes its own PNG sequence). swift.yml converts the sequences to
// docs/media/ios/<effect>.gif with ffmpeg.
//
// Output (app sandbox, pulled via `simctl get_app_container … data`):
//   Documents/media/<effect>/f_00000.png … f_00027.png
//   Documents/media/done.txt                (the CI completion handshake)
//
// Deterministic on purpose: fixed per-effect feelings (mirroring
// scripts/media.mjs's gallery table) + FIXED seeds, so a refresh run only
// changes the committed GIFs when the effect itself changed.

#if targetEnvironment(simulator)
import Foundation
import CoreGraphics
import Metal
import UIKit
import simd
import os
import DopamineCore

enum MediaRecorder {
    private static let log = Logger(subsystem: "ai.polyguard.DopamineDemo", category: "media")

    /// Frames sampled evenly across each effect's life + the GIF playback rate —
    /// the same 28-frame / 11 fps contract as scripts/media.mjs.
    static let frameCount = 28
    /// Logical canvas (pt) — a card-ish 4:5 box — rendered at 2× (`dpr`).
    static let sizePt = CGSize(width: 320, height: 400)
    static let dpr: Float = 2

    /// Per-effect feeling, mirroring scripts/media.mjs's gallery table.
    private static let feelings: [String: (mood: String, intensity: Double, whimsy: Double)] = [
        "solarbloom": ("celebratory", 0.85, 0.35),
        "aurora": ("serene", 0.85, 0.4),
        "comic": ("celebratory", 0.85, 0.5),
        "confetti": ("celebratory", 0.9, 0.4),
        "fail": ("electric", 0.9, 0.4),
        "heartburst": ("celebratory", 0.85, 0.4),
        "inkstroke": ("celebratory", 0.85, 0.45),
        "lightning": ("electric", 0.95, 0.4),
        "ripple": ("celebratory", 0.85, 0.4),
        "halo": ("serene", 0.8, 0.45),
    ]

    static var requested: Bool {
        ProcessInfo.processInfo.arguments.contains("-recordMedia")
            || ProcessInfo.processInfo.environment["DOPAMINE_RECORD_MEDIA"] != nil
    }

    /// Kick the render off a background queue (it synchronously waits on the GPU
    /// per frame); the normal demo UI stays idle (no `-autoplay` arg).
    static func runIfRequested() {
        guard requested else { return }
        DispatchQueue.global(qos: .userInitiated).async { run() }
    }

    private static func run() {
        guard let device = MTLCreateSystemDefaultDevice() else {
            log.error("[DopamineDemo] media: no Metal device"); return
        }
        let fm = FileManager.default
        let docs = fm.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let root = docs.appendingPathComponent("media", isDirectory: true)
        try? fm.removeItem(at: root)
        try? fm.createDirectory(at: root, withIntermediateDirectories: true)

        let wPx = Int(sizePt.width) * Int(dpr)
        let hPx = Int(sizePt.height) * Int(dpr)
        // Anchor at the canvas centre; centrepiece sized to a card-ish box —
        // logical points, like the live tick path (the runner multiplies by dpr).
        let anchor = SIMD2<Float>(Float(sizePt.width) / 2, Float(sizePt.height) / 2)
        let target = SIMD2<Float>(Float(sizePt.width) * 0.62, Float(sizePt.height) * 0.34)

        for (i, e) in EffectRegistry.all.enumerated() {
            guard let built = e.build(device) else {
                log.error("[DopamineDemo] media: build failed for \(e.name, privacy: .public)"); continue
            }
            let f = feelings[e.name] ?? (mood: "celebratory", intensity: 0.85, whimsy: 0.45)
            let params = built.resolve(DopeResolveInput(
                mood: f.mood, intensity: f.intensity, whimsy: f.whimsy,
                seed: 0x0D0A_0000 &+ UInt32(i)))
            // The panel (hybrids) sizes itself from the layer's drawableSize.
            built.host.lightLayer.drawableSize = CGSize(width: wPx, height: hPx)
            built.host.lightLayer.contentsScale = CGFloat(dpr)
            do { try built.host.prepare(params: params) } catch {
                log.error("[DopamineDemo] media: prepare failed for \(e.name, privacy: .public)"); continue
            }
            var durationMs = 1800.0
            if case let .number(v)? = params["durationMs"] { durationMs = v }

            let dir = root.appendingPathComponent(e.name, isDirectory: true)
            try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
            for fi in 0..<frameCount {
                // halo (continuous) renders exactly one loop period set, so the
                // GIF loops seamlessly; one-shots render their full life.
                let t = Double(fi) / Double(frameCount - 1) * durationMs
                guard let img = built.host.renderOffscreen(
                    elapsedMs: t, width: wPx, height: hPx, dpr: dpr,
                    anchorPx: anchor, targetPx: target) else { continue }
                let png = composite(img, size: CGSize(width: wPx, height: hPx))
                try? png.write(to: dir.appendingPathComponent(String(format: "f_%05d.png", fi)))
            }
            log.log("[DopamineDemo] media: rendered \(e.name, privacy: .public) (\(frameCount) frames)")
        }

        try? Data("done\n".utf8).write(to: root.appendingPathComponent("done.txt"))
        log.log("[DopamineDemo] media: COMPLETE")
    }

    /// The light pass is premultiplied light over transparency. Composite it
    /// ADDITIVELY (.plusLighter — the self-contained overlay model) onto the
    /// demo's dark backdrop so the GIF reads like the app.
    private static func composite(_ img: CGImage, size: CGSize) -> Data {
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: size, format: format)
        return renderer.pngData { ctx in
            UIColor(red: 0x0B / 255.0, green: 0x0D / 255.0, blue: 0x12 / 255.0, alpha: 1).setFill()
            ctx.fill(CGRect(origin: .zero, size: size))
            UIImage(cgImage: img).draw(in: CGRect(origin: .zero, size: size),
                                       blendMode: .plusLighter, alpha: 1)
        }
    }
}
#endif
