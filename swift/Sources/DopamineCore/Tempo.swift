// Animation tempo PRIMITIVES — direct port of `engine/tempo.ts`.
//
// The GENERIC easing + envelope building blocks shared across effects. Each
// effect's BESPOKE envelope (e.g. Solarbloom's check-draw) lives in that
// effect's own package on top of these, exactly as in the web library.

import Foundation

/// Coarse animation step (ms) for the "animate on twos" look at full whimsy
/// (~12 updates/sec). Motion snaps toward this grid as style rises.
public let NPR_TIME_STEP_MS: Double = 1000.0 / 12.0

/// Clamp into [0, 1].
public func tempoClamp01(_ x: Double) -> Double { x < 0 ? 0 : (x > 1 ? 1 : x) }

/// Classic ease-out cubic — quick start, gentle settle.
public func easeOutCubic(_ x: Double) -> Double {
    let t = tempoClamp01(x)
    return 1 - pow(1 - t, 3)
}

/// Ease-out "back" — overshoots past 1 then settles to 1 at x=1.
public func easeOutBack(_ x: Double, overshoot: Double = 1) -> Double {
    let t = tempoClamp01(x)
    let c1 = 1.70158 * overshoot
    let c3 = c1 + 1
    return 1 + c3 * pow(t - 1, 3) + c1 * pow(t - 1, 2)
}

/// Bloom amplitude over normalized life t ∈ [0, 1]: fast overshooting attack in
/// the first ~18%, then a long decay to zero. envelope(0)==0, envelope(1)==0.
public func envelope(_ t: Double, overshoot: Double = 1) -> Double {
    if t <= 0 || t >= 1 { return 0 }
    let attack = 0.18
    if t < attack {
        return easeOutBack(t / attack, overshoot: overshoot)
    }
    let x = (t - attack) / (1 - attack)
    return pow(1 - x, 1.6)
}
