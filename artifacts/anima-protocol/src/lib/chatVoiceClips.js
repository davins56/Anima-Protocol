/**
 * In-chat voice notes from the Anima (server: /api/media, switch
 * ANIMA_KERNEL_MEDIA). Mirrors chatImageGeneration: the companion emits
 * [VOICE: words to say] when she wants to be heard, or the steward asks for a
 * voice note; the client asks the server to speak it in her saved voice and
 * attaches the clip to the reply. Solo chat only.
 *
 * The server speaks on the home box. A cloud voice (xAI / ElevenLabs) is used
 * only when the steward opted in (lib/voicePrefs.js, off by default).
 */
import { apiUrl } from "./apiOrigin";
import { cloudOptInForClip, getVoicePrefs } from "./voicePrefs";

/** Loaded on first request so the pure tag helpers stay import-light. */
async function authHeaders(extra) {
  const { requireChatAuthHeaders } = await import("@/api/animaApi");
  return requireChatAuthHeaders(extra);
}

export const VOICE_TAG_RE = /\[VOICE:\s*([^\]]+)\]/gi;
export const CHAT_VOICE_TIMEOUT_MS = 35_000;
/** At most one voice note per reply. */
const MAX_SPOKEN_CHARS = 400;

const USER_VOICE_REQUEST_RE =
  /\b(voice\s*(note|message|memo|clip)|audio\s*(note|message|clip))\b|\b(say|read|tell)\b.{0,30}\b(out loud|aloud)\b|\b(let me|i want to|wanna|can i)\s+hear\s+(you|your voice)\b|\bsend\b.{0,20}\b(your voice|a voice)\b/i;

export function voiceClipTagInstruction() {
  return (
    "VOICE NOTES: You can send a short voice note in your own voice. When the user asks to hear " +
    "you, or when hearing your voice would mean more than reading it (comfort, a goodnight, a " +
    "laugh, something tender), emit on its own line: [VOICE: the exact words you say aloud]. " +
    "Keep it under 60 words, spoken naturally, no stage directions or emojis inside the tag. " +
    "At most one per reply, and not every reply. Never claim you cannot send voice notes."
  );
}

export function parseVoiceClip(text) {
  const re = new RegExp(VOICE_TAG_RE.source, "gi");
  const match = re.exec(String(text || ""));
  const spoken = String(match?.[1] || "").trim();
  return spoken ? spoken.slice(0, MAX_SPOKEN_CHARS) : null;
}

export function stripVoiceTags(text) {
  return String(text || "")
    .replace(VOICE_TAG_RE, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function userRequestedVoice(userText) {
  return USER_VOICE_REQUEST_RE.test(String(userText || ""));
}

/**
 * What the reply should say after its voice tag is lifted out. A reply that
 * was only a voice note keeps the words as text so history (and the
 * text-only model) still knows what she said.
 */
export function replyTextAfterVoice(strippedText, spoken) {
  const text = String(strippedText || "").trim();
  return text || String(spoken || "").trim();
}

let capabilitiesPromise = null;

/**
 * voice_clip is true when the home box can speak, or when the steward opted
 * into a cloud voice this deployment has a key for.
 */
export function voiceClipAvailable(body, prefs = getVoicePrefs()) {
  if (body?.voice_clip === true) return true;
  const optIn = cloudOptInForClip(prefs);
  return Boolean(optIn && body?.voice_clip_cloud?.[optIn] === true);
}

/** Server body cached per page load; opt-ins are read on every call. `{ voice_clip: false }` on any failure. */
export async function fetchMediaCapabilities({ fetchImpl = globalThis.fetch, prefs } = {}) {
  if (!capabilitiesPromise) {
    capabilitiesPromise = (async () => {
      try {
        const headers = await authHeaders();
        const res = await fetchImpl(apiUrl("/api/media/capabilities"), { headers });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        capabilitiesPromise = null;
        return null;
      }
    })();
  }
  const body = await capabilitiesPromise;
  return { voice_clip: voiceClipAvailable(body, prefs ?? getVoicePrefs()) };
}

export function resetMediaCapabilitiesForTests() {
  capabilitiesPromise = null;
}

export async function requestVoiceClip({ characterId, text, fetchImpl = globalThis.fetch, signal, prefs }) {
  const headers = await authHeaders({ "Content-Type": "application/json" });
  const cloudOptIn = cloudOptInForClip(prefs ?? getVoicePrefs());
  const res = await fetchImpl(apiUrl("/api/media/voice-clip"), {
    method: "POST",
    headers,
    body: JSON.stringify(cloudOptIn ? { characterId, text, cloud_opt_in: cloudOptIn } : { characterId, text }),
    signal,
  });
  if (!res.ok) throw new Error(`Voice note failed (${res.status})`);
  return res.json();
}

/**
 * Resolve the voice-note attachment for a companion reply.
 * Tag first; otherwise, when the steward asked to hear her, speak the reply.
 *
 * @returns {Promise<{ attachments: object[], source: "tag" | "request" | null, spoken: string | null }>}
 */
export async function resolveChatVoiceAttachments({ replyText, userText, characterId, synthesize }) {
  let spoken = parseVoiceClip(replyText);
  let source = spoken ? "tag" : null;
  if (!spoken && userRequestedVoice(userText)) {
    const fallback = stripVoiceTags(replyText).replace(/\[[A-Z]+:[^\]]*\]/g, "").trim();
    if (fallback) {
      spoken = fallback.slice(0, MAX_SPOKEN_CHARS);
      source = "request";
    }
  }
  if (!spoken || !characterId || typeof synthesize !== "function") {
    return { attachments: [], source: null, spoken: null };
  }
  try {
    const clip = await Promise.race([
      synthesize({ characterId, text: spoken }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("Voice note timed out.")), CHAT_VOICE_TIMEOUT_MS)),
    ]);
    if (!clip?.url) return { attachments: [], source: null, spoken };
    return {
      attachments: [{ type: "audio", url: clip.url, name: "Voice note", transcript: clip.transcript || spoken }],
      source,
      spoken,
    };
  } catch {
    return { attachments: [], source: null, spoken };
  }
}
