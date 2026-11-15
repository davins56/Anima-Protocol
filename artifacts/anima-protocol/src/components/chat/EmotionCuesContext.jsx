// @ts-check
import { createContext, useContext } from "react";

/**
 * Talk-screen emotion cues (#765, ANIMA_EMOTIONS). The default value is
 * "off", so any component rendered outside the provider (or with the flag
 * off) behaves exactly as before.
 *
 * @typedef {{
 *   enabled: boolean,
 *   cueFor: (characterId: string | null | undefined) => import("@/lib/emotionCues").AffectCue | null,
 *   reunionIds: string[],
 * }} EmotionCuesValue
 */

/** @type {EmotionCuesValue} */
export const EMOTION_CUES_OFF = Object.freeze({
  enabled: false,
  cueFor: () => null,
  reunionIds: [],
});

export const EmotionCuesContext = createContext(EMOTION_CUES_OFF);

export function useEmotionCues() {
  return useContext(EmotionCuesContext);
}
