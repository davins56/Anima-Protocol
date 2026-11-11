/**
 * Drives a 4D net battle on the client: fixed 20 Hz clock (frozen while the
 * Custom screen is open or the tab is hidden), deterministic engine steps,
 * an append-only input log, and batched server validation.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  advance,
  createSim,
  stateHash,
  step,
  TICK_MS,
  type EmittedEvent,
  type SimAction,
  type SimConfig,
  type SimState,
  type StampedAction,
} from "./engine";
import { flushSimActions } from "./simApi";

export type SyncStatus = "local" | "syncing" | "verified" | "rejected";
const FLUSH_MS = 2000;
const FX_KEEP = 48;

export function useSimBattle(config: SimConfig | null, sessionId: string | null) {
  const stateRef = useRef<SimState | null>(null);
  const logRef = useRef<StampedAction[]>([]);
  const sentRef = useRef(0);
  const fxRef = useRef<EmittedEvent[]>([]);
  const [, setFrame] = useState(0);
  const [sync, setSync] = useState<SyncStatus>(sessionId ? "syncing" : "local");
  const [lastReject, setLastReject] = useState<string | null>(null);
  const flushing = useRef(false);

  useEffect(() => {
    stateRef.current = config ? createSim(config) : null;
    logRef.current = [];
    sentRef.current = 0;
    fxRef.current = [];
    setSync(sessionId ? "syncing" : "local");
    setFrame((f) => f + 1);
  }, [config, sessionId]);

  const absorb = useCallback((events: EmittedEvent[]) => {
    if (!events.length) return;
    const rejected = [...events].reverse().find((e) => e.type === "rejected");
    if (rejected && rejected.type === "rejected") setLastReject(rejected.reason);
    fxRef.current = [...fxRef.current, ...events.filter((e) => e.type !== "action")].slice(-FX_KEEP);
  }, []);

  const flush = useCallback(async () => {
    const s = stateRef.current;
    if (!s || !sessionId || flushing.current || sync === "rejected") return;
    const pending = logRef.current.slice(sentRef.current);
    if (!pending.length && !s.outcome) return;
    flushing.current = true;
    try {
      const from = sentRef.current;
      const r = await flushSimActions(sessionId, { from_idx: from, actions: pending, claimed: { tick: s.tick, hash: stateHash(s) } });
      sentRef.current = from + pending.length;
      setSync("verified");
      return r;
    } catch (e) {
      const err = e as { status?: number; message?: string };
      if (err.status === 409) {
        setSync("rejected");
        setLastReject(err.message || "server rejected this battle log");
      } else if (err.status === 503) {
        setSync("local");
      }
    } finally {
      flushing.current = false;
    }
    return undefined;
  }, [sessionId, sync]);

  // Fixed-step clock.
  useEffect(() => {
    if (!config) return;
    let clock = stateRef.current?.tick ?? 0;
    const id = window.setInterval(() => {
      const s = stateRef.current;
      if (!s || s.outcome || s.custom.open || document.hidden) return;
      clock = Math.max(clock, s.tick) + 1;
      const r = advance(s, clock);
      stateRef.current = r.state;
      absorb(r.events);
      setFrame((f) => (f + 1) % 1_000_000);
    }, TICK_MS);
    return () => window.clearInterval(id);
  }, [config, absorb]);

  // Periodic + end-of-battle validation.
  useEffect(() => {
    if (!sessionId) return;
    const id = window.setInterval(() => void flush(), FLUSH_MS);
    return () => window.clearInterval(id);
  }, [sessionId, flush]);
  const outcome = stateRef.current?.outcome ?? null;
  useEffect(() => {
    if (outcome) void flush();
  }, [outcome, flush]);

  const dispatch = useCallback(
    (action: SimAction) => {
      const s = stateRef.current;
      if (!s || s.outcome) return;
      const stamped = { tick: s.tick, action };
      const r = step(s, stamped);
      stateRef.current = r.state;
      logRef.current.push(stamped);
      absorb(r.events);
      setFrame((f) => (f + 1) % 1_000_000);
    },
    [absorb],
  );

  return { state: stateRef.current, fx: fxRef.current, dispatch, sync, lastReject, flush, log: logRef.current };
}
