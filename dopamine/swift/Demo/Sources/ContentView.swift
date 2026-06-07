// The demo screen: a sample "Order complete" card, a Fire button, and the three
// feeling controls (mood / intensity / whimsy). Firing resolves the feeling
// through the SHARED `.dope` loader and plays Solarbloom in a Metal overlay
// stacked over the card.

import SwiftUI
import simd

struct ContentView: View {
    // The feeling controls (mirror the web demo's mood / intensity / whimsy).
    @State private var mood: String = "celebratory"
    @State private var intensity: Double = 0.8
    @State private var whimsy: Double = 0.4

    // A monotonically increasing token; bumping it tells the overlay to fire.
    @State private var fireToken: Int = 0
    // The anchor (effect origin) in view points — center of the card.
    @State private var anchor: CGPoint = .zero

    private let moods = ["serene", "celebratory", "electric"]

    var body: some View {
        ZStack {
            Color(white: 0.11).ignoresSafeArea()

            VStack(spacing: 28) {
                Spacer()
                orderCard
                Spacer()
                controls
                fireButton
            }
            .padding(24)

            // The Metal overlay sits ON TOP, pointer-transparent, full-screen.
            SolarbloomOverlay(
                fireToken: fireToken,
                mood: mood, intensity: intensity, whimsy: whimsy,
                anchor: anchor
            )
            .allowsHitTesting(false)
            .ignoresSafeArea()
        }
        .onAppear(perform: maybeAutoplay)
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

    private var controls: some View {
        VStack(alignment: .leading, spacing: 18) {
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

    private func maybeAutoplay() {
        guard Autoplay.requestedEffect != nil else { return }
        // For the CI screen recording: fire shortly after launch, then RE-FIRE on a
        // 3s loop. The celebratory bloom lasts ~1.7s, so a 3s interval leaves a
        // clean gap (no overlapping fires) while showing the unique-every-time
        // palette across several real-time plays over the card.
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { fire() }
        Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            fire()
        }
    }
}
