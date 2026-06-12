// Lightning's bespoke timing — port of `lightning-tempo.ts`.
//
// A high-energy "power-up / boost" STRIKE: the bolt cracks in almost instantly
// with a hard FLASH on contact, then a brief FLICKER AFTERGLOW strobes and
// decays. These shapes are pure functions of time (frame-deterministic). Built
// on the GENERIC `tempoClamp01` primitive from DopamineCore — this bespoke
// timing is the ONLY tempo code that lives in the effect package (matching the
// web boundary).

import Foundation
import DopamineCore

// NOTE: `STRIKE_MS` + `strikeProgress` now live in the GENERATED
// `LightningRenderer.swift` — the bolt precompute keys off the strike clock, so
// they ride the single transpiled web source (lightning-logic.ts). Only the
// flash/strobe shape below remains hand-written here.

/// FLASH / STROBE amplitude (0..1+) over normalized life — the signature
/// electric hit. An instantaneous near-white flash on the strike instant that
/// decays fast, then a few discrete FLICKER re-pulses (the afterglow strobe)
/// whose peaks decay across the tail. `flicker` (driven by intensity) scales how
/// many/how strong the re-pulses are. `flashStrobe(0)≈peak`, → 0 by life 1.
public func flashStrobe(_ life: Double, flicker: Double = 1) -> Double {
    let t = tempoClamp01(life)
    let primary = exp(-t / 0.035)
    let beats = 6.0
    let phase = t * beats * Double.pi * 2
    let spike = max(0, sin(phase))
    let sharp = pow(spike, 8)
    let tail = pow(1 - t, 2.2) * 0.28 * flicker
    return primary + sharp * tail
}
