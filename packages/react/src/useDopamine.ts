import { useCallback } from "react";
import { celebrate, type DopamineSuccessOptions } from "@dopaminefx/effects";

/**
 * Returns a stable `celebrate` function for imperative use:
 *
 * ```tsx
 * const celebrate = useDopamine();
 * <button onClick={() => celebrate({ mood: "electric" })}>Done</button>
 * ```
 */
export function useDopamine(): (options?: DopamineSuccessOptions) => Promise<void> {
  return useCallback((options?: DopamineSuccessOptions) => celebrate(options), []);
}
