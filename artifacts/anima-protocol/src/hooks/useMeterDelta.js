// @ts-check
import { useEffect, useRef, useState } from "react";

/**
 * Pure step for {@link useMeterDelta}: given the last seen value and the next
 * one, returns the change to show (or null when nothing should flash).
 *
 * @param {number | null} previous
 * @param {number | null | undefined} next
 * @returns {number | null}
 */
export function meterDelta(previous, next) {
  if (typeof previous !== "number" || !Number.isFinite(previous)) return null;
  if (typeof next !== "number" || !Number.isFinite(next)) return null;
  const delta = Math.round(next) - Math.round(previous);
  return delta === 0 ? null : delta;
}

/**
 * Remembers the last value of a meter and briefly reports how much it moved,
 * so a +2 after a warm reply is visible instead of a bar that seems frozen.
 * Changing `resetKey` (another companion, or a different data source) starts
 * over without flashing the jump between them.
 *
 * @param {number | null | undefined} value
 * @param {{ resetKey?: string | number | null, holdMs?: number }} [options]
 * @returns {{ delta: number | null, pulse: number }}
 */
export function useMeterDelta(value, { resetKey = null, holdMs = 2600 } = {}) {
  const lastRef = useRef(/** @type {number | null} */ (null));
  const keyRef = useRef(resetKey);
  const [state, setState] = useState(
    /** @type {{ delta: number | null, pulse: number }} */ ({ delta: null, pulse: 0 }),
  );

  useEffect(() => {
    const next = typeof value === "number" && Number.isFinite(value) ? Math.round(value) : null;
    if (keyRef.current !== resetKey) {
      keyRef.current = resetKey;
      lastRef.current = next;
      setState((s) => (s.delta == null ? s : { delta: null, pulse: s.pulse }));
      return undefined;
    }
    const delta = meterDelta(lastRef.current, next);
    if (next != null) lastRef.current = next;
    if (delta == null) {
      // A pending flash's timer was cleared with the old deps; drop it now.
      setState((s) => (s.delta == null ? s : { delta: null, pulse: s.pulse }));
      return undefined;
    }
    setState((s) => ({ delta, pulse: s.pulse + 1 }));
    const timer = setTimeout(() => {
      setState((s) => ({ delta: null, pulse: s.pulse }));
    }, holdMs);
    return () => clearTimeout(timer);
  }, [value, resetKey, holdMs]);

  return state;
}

/** "+3" / "−2" label for a meter delta. */
export function formatMeterDelta(delta) {
  if (typeof delta !== "number" || !delta) return "";
  return delta > 0 ? `+${delta}` : `\u2212${Math.abs(delta)}`;
}
