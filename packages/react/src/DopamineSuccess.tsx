import { useEffect, useRef } from "react";
import { celebrate, type DopamineMood } from "@dopamine/effects";

export interface DopamineSuccessProps {
  /**
   * Change this value to fire the celebration. The effect plays whenever
   * `trigger` changes to a new value (the initial mount does not fire).
   */
  trigger: unknown;
  mood?: DopamineMood;
  intensity?: number;
  whimsy?: number;
  seed?: number;
  /** Called when the animation finishes. */
  onDone?: () => void;
}

/**
 * Declarative success effect. Drops an invisible marker into the layout and
 * anchors the full-page bloom at its center.
 *
 * ```tsx
 * <DopamineSuccess trigger={orderId} mood="celebratory" intensity={0.8} />
 * ```
 */
export function DopamineSuccess({
  trigger,
  mood,
  intensity,
  whimsy,
  seed,
  onDone,
}: DopamineSuccessProps): JSX.Element {
  const ref = useRef<HTMLSpanElement>(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const el = ref.current;
    const origin = el
      ? (() => {
          const r = el.getBoundingClientRect();
          return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        })()
      : undefined;
    void celebrate({ mood, intensity, whimsy, seed, origin }).then(() => onDone?.());
    // Intentionally only re-run when `trigger` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  return <span ref={ref} aria-hidden style={{ display: "contents" }} />;
}
