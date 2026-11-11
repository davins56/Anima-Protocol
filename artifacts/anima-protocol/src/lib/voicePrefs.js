/**
 * The steward's cloud-voice opt-ins (docs/voice-local.md §8). Her voice runs
 * on the home box (Kokoro + faster-whisper); every cloud or device-vendor
 * voice is OFF by default and only used once switched on here:
 *
 *   elevenlabs   ElevenLabs TTS (and the emotional ElevenLabs path)
 *   xai          xAI Grok Voice for voice notes
 *   webSpeech    the browser's speechSynthesis (some browsers send text to a vendor)
 *   nativeSpeech iOS AVSpeechSynthesizer in the app shell (the suggested
 *                backup on the iPad: on-device, works when the box is down)
 *
 * Stored per device in localStorage; no server table, no migration. The
 * Settings UI for these switches is the Builder's (V6). TODO(V6): toggles.
 */

export const VOICE_PREFS_KEY = "anima.voice.cloudOptIn.v1";
export const VOICE_PREFS_EVENT = "anima:voice-prefs";
export const DEFAULT_VOICE_PREFS = Object.freeze({
  elevenlabs: false,
  xai: false,
  webSpeech: false,
  nativeSpeech: false,
});
const KEYS = Object.keys(DEFAULT_VOICE_PREFS);

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Only a literal `true` opts in; anything else (missing, "true", 1) stays off. */
export function normalizeVoicePrefs(raw) {
  const out = { ...DEFAULT_VOICE_PREFS };
  if (raw && typeof raw === "object") {
    for (const k of KEYS) out[k] = raw[k] === true;
  }
  return out;
}

export function getVoicePrefs(storage = defaultStorage()) {
  try {
    const text = storage?.getItem(VOICE_PREFS_KEY);
    return normalizeVoicePrefs(text ? JSON.parse(text) : null);
  } catch {
    return { ...DEFAULT_VOICE_PREFS };
  }
}

export function setVoicePrefs(patch, storage = defaultStorage()) {
  const next = normalizeVoicePrefs({ ...getVoicePrefs(storage), ...(patch || {}) });
  try {
    storage?.setItem(VOICE_PREFS_KEY, JSON.stringify(next));
  } catch {
    /* private mode: stays default (off) */
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(VOICE_PREFS_EVENT, { detail: next }));
  } catch {
    /* non-DOM runtime */
  }
  return next;
}

/** Calls `fn(prefs)` on change in this tab or another. Returns unsubscribe. */
export function subscribeVoicePrefs(fn) {
  if (typeof globalThis.addEventListener !== "function") return () => {};
  const onLocal = (e) => fn(normalizeVoicePrefs(e?.detail));
  const onStorage = (e) => {
    if (e?.key === VOICE_PREFS_KEY) fn(getVoicePrefs());
  };
  globalThis.addEventListener(VOICE_PREFS_EVENT, onLocal);
  globalThis.addEventListener("storage", onStorage);
  return () => {
    globalThis.removeEventListener(VOICE_PREFS_EVENT, onLocal);
    globalThis.removeEventListener("storage", onStorage);
  };
}

/** `cloud_opt_in` for /api/media/voice-clip: xAI (her saved voice) before ElevenLabs. */
export function cloudOptInForClip(prefs) {
  const p = normalizeVoicePrefs(prefs);
  if (p.xai) return "xai";
  if (p.elevenlabs) return "elevenlabs";
  return null;
}

/**
 * Which engine reads a chat reply aloud. Each cloud/device engine needs its
 * opt-in AND (for the web hooks) its in-chat toggle. Returns null when none
 * may speak: the home-box voice is the default, and its playback in chat is
 * the Builder's V6 (TODO(V6): return "local" once the player exists).
 *
 * @returns {"native" | "emotional" | "elevenlabs" | "webSpeech" | null}
 */
export function chooseSpeechRoute({ prefs, isNative = false, emotionalEnabled = false, elevenEnabled = false, webEnabled = false }) {
  const p = normalizeVoicePrefs(prefs);
  if (isNative && p.nativeSpeech) return "native";
  if (p.elevenlabs && emotionalEnabled) return "emotional";
  if (p.elevenlabs && elevenEnabled) return "elevenlabs";
  if (p.webSpeech && webEnabled) return "webSpeech";
  return null;
}

/** "Read the story": ElevenLabs needs a voice id; native speech is not used for the long read. */
export function chooseStoryRoute({ prefs, voiceId, elevenEnabled = false, webEnabled = false }) {
  const p = normalizeVoicePrefs(prefs);
  if (voiceId && p.elevenlabs && elevenEnabled) return "elevenlabs";
  if (p.webSpeech && webEnabled) return "webSpeech";
  return null;
}
