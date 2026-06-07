// Solarbloom's bespoke timing — port of `solarbloom-tempo.ts`.
//
// The functional confirmation (the checkmark) draws within ~240 ms regardless
// of total duration — fast enough to land near the ~100 ms reward-prediction
// signal and read as an unambiguous "it worked". Built on the GENERIC
// `easeOutCubic` primitive from DopamineCore — this bespoke window is the ONLY
// timing code that lives in the effect package (matching the web boundary).

import DopamineCore

/// Window (ms) over which the checkmark draws in, independent of total length.
public let CHECK_DRAW_MS: Double = 240

/// Checkmark draw progress (0..1) given elapsed ms.
public func checkProgress(_ elapsedMs: Double) -> Double {
    easeOutCubic(elapsedMs / CHECK_DRAW_MS)
}
