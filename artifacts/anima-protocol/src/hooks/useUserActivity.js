// @ts-check
import { useEffect, useMemo, useState } from "react";
import { WAITING_THRESHOLD_MS, resolveWaiting } from "@/lib/homeWake";
import {
  bindActivityListeners,
  readActivityRecord,
  resolveAbsenceRange,
  subscribeActivity,
} from "@/lib/userActivity";

const TICK_MS = 30_000;

/**
 * Tracks real app presence for `userId` and returns a live "I waited…" value
 * for the home Waiting tile. Safe to call from more than one component.
 *
 * @param {{
 *   userId?: unknown,
 *   lastUserMessageAt?: unknown,
 *   serverLastVisitAt?: unknown,
 *   tickMs?: number,
 * }} [opts]
 */
export function useUserActivity(opts = {}) {
  const { userId, lastUserMessageAt, serverLastVisitAt, tickMs = TICK_MS } = opts;
  const [record, setRecord] = useState(() => readActivityRecord(userId));
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    setRecord(readActivityRecord(userId));
    const stopListen = bindActivityListeners({
      userId,
      thresholdMs: WAITING_THRESHOLD_MS,
      getExtras: () => ({ lastUserMessageAt, serverLastVisitAt }),
      onChange: setRecord,
    });
    const stopSub = subscribeActivity(userId, setRecord);
    return () => {
      stopListen();
      stopSub();
    };
  }, [userId, lastUserMessageAt, serverLastVisitAt]);

  useEffect(() => {
    if (!tickMs) return undefined;
    const timer = setInterval(() => setNowMs(Date.now()), tickMs);
    return () => clearInterval(timer);
  }, [tickMs]);

  const waiting = useMemo(() => {
    const range = resolveAbsenceRange({
      record,
      lastUserMessageAt,
      serverLastVisitAt,
      now: nowMs,
    });
    if (!range) return null;
    return resolveWaiting(range.startMs, range.endMs);
  }, [record, lastUserMessageAt, serverLastVisitAt, nowMs]);

  return { waiting, record, nowMs };
}

export default useUserActivity;
