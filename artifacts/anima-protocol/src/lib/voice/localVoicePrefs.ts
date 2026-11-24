/**
 * V6 flags and per-device preferences for the home-box voice.
 * - Build flag VITE_ANIMA_LOCAL_VOICE ("1"/"true"/"on"); off by default.
 * - `autoSpeak` (read each new reply aloud with her home voice): off by default.
 * Cloud voices stay in lib/voicePrefs.js (all opt-in, off by default).
 */
export function localVoiceEnabled(env: Record<string, unknown> | undefined = import.meta.env): boolean {
  const raw = String(env?.VITE_ANIMA_LOCAL_VOICE ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "on";
}

export const LOCAL_VOICE_PREFS_KEY = "anima.voice.local.v1";
export interface LocalVoicePrefs {
  autoSpeak: boolean;
}
export const DEFAULT_LOCAL_VOICE_PREFS: LocalVoicePrefs = Object.freeze({ autoSpeak: false });

export function getLocalVoicePrefs(storage: Storage | null = safeStorage()): LocalVoicePrefs {
  try {
    const raw = storage?.getItem(LOCAL_VOICE_PREFS_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    return { autoSpeak: parsed?.autoSpeak === true };
  } catch {
    return { ...DEFAULT_LOCAL_VOICE_PREFS };
  }
}

export function setLocalVoicePrefs(patch: Partial<LocalVoicePrefs>, storage: Storage | null = safeStorage()): LocalVoicePrefs {
  const next: LocalVoicePrefs = { autoSpeak: (patch.autoSpeak ?? getLocalVoicePrefs(storage).autoSpeak) === true };
  try {
    storage?.setItem(LOCAL_VOICE_PREFS_KEY, JSON.stringify(next));
  } catch {
    // Private mode: stays off.
  }
  return next;
}

function safeStorage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Kokoro voice ids the server accepts (docs/voice-local.md §9). */
export const KOKORO_VOICE_RE = /^[a-z]{2}_[a-z0-9]{2,24}$/;

/**
 * Companions must sound different. Returns, per companion id, the other
 * companions that resolve to the same Kokoro voice (unset → `fallback`).
 */
export function sharedVoices(
  companions: { id: string; name: string; kokoro_voice_id?: string | null }[],
  fallback = "af_heart",
): Record<string, string[]> {
  const byVoice = new Map<string, { id: string; name: string }[]>();
  for (const c of companions) {
    const v = c.kokoro_voice_id && KOKORO_VOICE_RE.test(c.kokoro_voice_id) ? c.kokoro_voice_id : fallback;
    byVoice.set(v, [...(byVoice.get(v) || []), c]);
  }
  const out: Record<string, string[]> = {};
  for (const group of byVoice.values()) {
    for (const c of group) out[c.id] = group.filter((o) => o.id !== c.id).map((o) => o.name);
  }
  return out;
}

/** First voice not used by any other companion, for a one-tap suggestion. */
export function suggestDistinctVoice(
  companionId: string,
  companions: { id: string; kokoro_voice_id?: string | null }[],
  voices: string[],
  fallback = "af_heart",
): string | null {
  const taken = new Set(
    companions
      .filter((c) => c.id !== companionId)
      .map((c) => (c.kokoro_voice_id && KOKORO_VOICE_RE.test(c.kokoro_voice_id) ? c.kokoro_voice_id : fallback)),
  );
  return voices.find((v) => KOKORO_VOICE_RE.test(v) && !taken.has(v)) ?? null;
}
