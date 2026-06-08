// The demo screen: a sample "Order complete" card, a Fire button, and the three
// feeling controls (mood / intensity / whimsy). Firing resolves the feeling
// through the SHARED `.dope` loader and plays Solarbloom in a Metal overlay
// stacked over the card.

import SwiftUI
import simd

/// Collects each target chip's final laid-out frame (global points), keyed by
/// effect name, so the overlay can aim that effect's centrepiece at the box.
private struct TargetFrameKey: PreferenceKey {
    static var defaultValue: [String: CGRect] { [:] }
    static func reduce(value: inout [String: CGRect], nextValue: () -> [String: CGRect]) {
        value.merge(nextValue(), uniquingKeysWith: { _, new in new })
    }
}

struct ContentView: View {
    // Which effect to play. Defaults to the first registered effect, matching the
    // overlay's initial current effect.
    @State private var effectName: String = EffectRegistry.allNames.first ?? "solarbloom"

    // The feeling controls (mirror the web demo's mood / intensity / whimsy).
    @State private var mood: String = "celebratory"
    @State private var intensity: Double = 0.8
    @State private var whimsy: Double = 0.4

    // A monotonically increasing token; bumping it tells the overlay to fire.
    @State private var fireToken: Int = 0
    // The anchor (effect origin) in view points — center of the card.
    @State private var anchor: CGPoint = .zero
    // Per-effect TARGET boxes (global points). Effects that target an element
    // (comic / heartburst / inkstroke here) land their centrepiece on the matching
    // box at its size; everything else falls back to the card anchor + full canvas.
    @State private var targets: [String: CGRect] = [:]
    // True while an effect is playing. Used to fade the targeted chip's content
    // out (so its label doesn't show through the effect) and back in after.
    @State private var effectActive = false

    private let moods = ["serene", "celebratory", "electric"]

    var body: some View {
        ZStack {
            Color(white: 0.11).ignoresSafeArea()

            VStack(spacing: 24) {
                Spacer()
                orderCard
                targetsRow
                Spacer()
                controls
                fireButton
            }
            .padding(24)

            // The Metal overlay sits ON TOP, pointer-transparent, full-screen. It
            // self-drives autoplay (single effect or the full sequence) from the
            // launch args; the Fire button still replays the current effect.
            EffectOverlay(
                effectName: effectName,
                fireToken: fireToken,
                mood: mood, intensity: intensity, whimsy: whimsy,
                anchor: anchor, targets: targets,
                onActiveChange: { active in
                    if active {
                        effectActive = true                 // cut out instantly
                    } else {
                        withAnimation(.easeInOut(duration: 0.4)) { effectActive = false }  // fade back in
                    }
                }
            )
            .allowsHitTesting(false)
            .ignoresSafeArea()
        }
    }

    // MARK: - Pieces

    private var orderCard: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(Color.green.opacity(0.18))
                    .frame(width: 72, height: 72)
                Image(systemName: "checkmark")
                    .font(.system(size: 34, weight: .bold))
                    .foregroundStyle(.green)
            }
            // Hide the green check badge while a CARD-anchored effect plays over it
            // (an effect with no target chip), so it doesn't show through. The rest
            // of the card (title/subtitle) stays. Cut out instantly, fade back in.
            .opacity(effectActive && targets[effectName] == nil ? 0 : 1)
            Text("Order complete")
                .font(.title2.weight(.semibold))
                .foregroundStyle(.white)
            Text("Your dopamine hit is on its way.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 36)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(Color(white: 0.22))
                .overlay(
                    RoundedRectangle(cornerRadius: 20, style: .continuous)
                        .strokeBorder(Color.white.opacity(0.12), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.5), radius: 24, y: 12)
        )
        // Track the card's center in the global coordinate space so the overlay
        // anchors the bloom on the checkmark.
        .background(
            GeometryReader { geo in
                Color.clear.onAppear {
                    let f = geo.frame(in: .global)
                    anchor = CGPoint(x: f.midX, y: f.midY)
                }
            }
        )
    }

    // A row of three deliberately DIFFERENT-sized targets. comic / heartburst /
    // inkstroke each aim at one, so the demo shows the centrepiece matching the
    // element's location AND size (a small heart chip, a medium word button, a
    // wide signature field).
    private var targetsRow: some View {
        HStack(spacing: 14) {
            targetChip("heartburst", "♥", w: 46, h: 46, color: .pink)
            targetChip("comic", "POW!", w: 104, h: 50, color: .orange)
            targetChip("inkstroke", "Sign here", w: 184, h: 40, color: .blue)
        }
        // Collect the chips' FINAL laid-out frames (a PreferenceKey always reflects
        // the settled layout — onAppear could fire with a transient pre-layout frame,
        // which left the centrepiece off to one side).
        .onPreferenceChange(TargetFrameKey.self) { targets = $0 }
    }

    private func targetChip(_ key: String, _ label: String, w: CGFloat, h: CGFloat, color: Color) -> some View {
        Text(label)
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white.opacity(0.85))
            .frame(width: w, height: h)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(color.opacity(0.30))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .strokeBorder(color.opacity(0.7), lineWidth: 1)
                    )
            )
            // Publish this chip's global box so the overlay can target it by effect.
            .background(
                GeometryReader { geo in
                    Color.clear.preference(key: TargetFrameKey.self, value: [key: geo.frame(in: .global)])
                }
            )
            // Hide this chip while ITS effect is playing over it (the label/box
            // showing through the effect is confusing); fades back in after.
            // Opacity doesn't affect layout, so the published frame stays valid.
            .opacity(effectActive && effectName == key ? 0 : 1)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Effect").font(.caption).foregroundStyle(.white.opacity(0.6))
                // A menu picker (not segmented) — there are nine effects, too many
                // to fit as segments. Selecting an effect switches it; tap Fire to play.
                Picker("Effect", selection: $effectName) {
                    ForEach(EffectRegistry.allNames, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .pickerStyle(.menu)
                .tint(.orange)
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Mood").font(.caption).foregroundStyle(.white.opacity(0.6))
                Picker("Mood", selection: $mood) {
                    ForEach(moods, id: \.self) { Text($0.capitalized).tag($0) }
                }
                .pickerStyle(.segmented)
            }
            slider("Intensity", value: $intensity)
            slider("Whimsy", value: $whimsy)
        }
    }

    private func slider(_ label: String, value: Binding<Double>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(label).font(.caption).foregroundStyle(.white.opacity(0.6))
                Spacer()
                Text(String(format: "%.2f", value.wrappedValue))
                    .font(.caption.monospacedDigit()).foregroundStyle(.white.opacity(0.4))
            }
            Slider(value: value, in: 0...1)
        }
    }

    private var fireButton: some View {
        Button(action: fire) {
            Text("Fire")
                .font(.headline)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 14)
        }
        .buttonStyle(.borderedProminent)
        .tint(.orange)
    }

    // MARK: - Actions

    private func fire() {
        fireToken += 1
    }
}
