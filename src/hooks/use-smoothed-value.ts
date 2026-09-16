import { useEffect, useRef, useState } from "react";

/**
 * Smoothly animates from the currently-displayed value to a new target
 * value whenever the target changes, instead of jumping straight to it.
 *
 * IMPORTANT — this does NOT simulate or fabricate price movement. It only
 * eases the visual transition between two REAL values that were actually
 * fetched (e.g. spot price on this poll vs the last poll). Between fetches,
 * once the animation finishes, the value holds steady at the last real
 * number — it never invents tick-by-tick movement that didn't happen. That
 * distinction matters here: this is a trading app, and a trader glancing at
 * a "live" number should never be looking at motion that isn't backed by
 * real data, even if a literal live tick feed would look smoother.
 */
export function useSmoothedValue(target: number, durationMs = 900): number {
  const [value, setValue] = useState(target);
  const fromRef = useRef(target);
  const displayedRef = useRef(target);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    const from = displayedRef.current;
    const to = target;
    fromRef.current = from;
    startRef.current = null;

    if (from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
      displayedRef.current = to;
      setValue(to);
      return;
    }

    const step = (ts: number) => {
      if (startRef.current === null) startRef.current = ts;
      const elapsed = ts - startRef.current;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // ease-out cubic — decelerates into the real value
      const next = from + (to - from) * eased;
      displayedRef.current = next;
      setValue(next);
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); };
  }, [target, durationMs]);

  return value;
}
