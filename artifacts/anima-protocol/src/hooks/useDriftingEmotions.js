import { useEffect, useMemo, useState } from "react";
import { driftCharacterEmotion } from "@/lib/companionAffect";

/**
 * Header view of each companion's felt state with the slow drift back toward
 * her baseline applied while the chat is quiet. Re-evaluates once a minute;
 * a new turn replaces the entry and the drift starts over from it.
 *
 * @param {Record<string, any> | null | undefined} characterEmotions keyed by character id
 * @param {{ intervalMs?: number }} [options]
 */
export function useDriftingEmotions(characterEmotions, { intervalMs = 60_000 } = {}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!intervalMs) return undefined;
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return useMemo(() => {
    const out = {};
    for (const [id, emotion] of Object.entries(characterEmotions || {})) {
      out[id] = driftCharacterEmotion(emotion, now);
    }
    return out;
  }, [characterEmotions, now]);
}
