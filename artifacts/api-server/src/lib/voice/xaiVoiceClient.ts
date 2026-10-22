/**
 * xAI Voice REST calls used server-side. Every endpoint here is taken from
 * docs.x.ai (verified 2026-10-22):
 *   POST /v1/realtime/client_secrets   ephemeral token { value, expires_at }
 *   GET  /v1/tts/voices                built-in voice roster
 *   POST /v1/custom-voices             clone (multipart, ≤120 s, Enterprise-gated)
 *   GET  /v1/custom-voices/{voice_id}  verify a console-created custom voice
 * Realtime itself is a browser WebSocket: wss://api.x.ai/v1/realtime?model=…
 * The API key never leaves the Worker.
 */
export const XAI_API_BASE = "https://api.x.ai/v1";
export const XAI_REALTIME_URL = "wss://api.x.ai/v1/realtime";
export const DEFAULT_VOICE_MODEL = "grok-voice-latest";
export const MAX_CLONE_SECONDS = 120;

export function xaiKey(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.XAI_API_KEY || "").trim();
}

/**
 * Voice is an explicit opt-in: the repo's chat is fail-closed to the
 * self-hosted Anima LLM, and the realtime agent sends persona + memories to xAI.
 */
export function isVoiceAgentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return Boolean(xaiKey(env)) && String(env.ANIMA_VOICE_AGENT || "").trim().toLowerCase() === "xai";
}

export function voiceModel(env: NodeJS.ProcessEnv = process.env): string {
  const m = String(env.ANIMA_VOICE_MODEL || "").trim();
  return /^grok-voice-[a-z0-9.-]+$/.test(m) ? m : DEFAULT_VOICE_MODEL;
}

export class XaiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string,
  ) {
    super(message);
  }
}

async function xaiFetch(path: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<Response> {
  const key = xaiKey();
  if (!key) throw new XaiError("XAI_API_KEY is not configured.", 503, "voice_disabled");
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(`${XAI_API_BASE}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function failFrom(res: Response, fallbackCode: string): Promise<never> {
  const text = await res.text().catch(() => "");
  let msg = text.slice(0, 300);
  try {
    const j = JSON.parse(text);
    msg = String(j.error?.message || j.error || j.message || msg);
  } catch {
    /* keep text */
  }
  throw new XaiError(msg || `xAI request failed (${res.status})`, res.status >= 500 ? 502 : res.status, fallbackCode);
}

export async function createClientSecret(seconds = 300): Promise<{ value: string; expires_at: number }> {
  const s = Math.max(30, Math.min(3600, Math.round(seconds)));
  const res = await xaiFetch("/realtime/client_secrets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ expires_after: { seconds: s } }),
  });
  if (!res.ok) await failFrom(res, "xai_client_secret_failed");
  const body = (await res.json()) as { value?: string; expires_at?: number };
  if (!body.value) throw new XaiError("xAI returned no client secret.", 502, "xai_client_secret_failed");
  return { value: body.value, expires_at: Number(body.expires_at) || Math.floor(Date.now() / 1000) + s };
}

let voicesCache: { at: number; voices: Array<{ voice_id: string; name: string; language: string | null }> } | null = null;
export async function listBuiltinVoices() {
  if (voicesCache && Date.now() - voicesCache.at < 3_600_000) return voicesCache.voices;
  const res = await xaiFetch("/tts/voices");
  if (!res.ok) await failFrom(res, "xai_voices_failed");
  const body = (await res.json()) as { voices?: Array<{ voice_id: string; name: string; language?: string | null }> };
  const voices = (body.voices || []).map((v) => ({ voice_id: v.voice_id, name: v.name, language: v.language ?? null }));
  voicesCache = { at: Date.now(), voices };
  return voices;
}

export async function getCustomVoice(voiceId: string) {
  const res = await xaiFetch(`/custom-voices/${encodeURIComponent(voiceId)}`);
  if (res.status === 404) return null;
  if (!res.ok) await failFrom(res, "xai_custom_voice_failed");
  return (await res.json()) as { voice_id: string; name?: string | null; language?: string | null };
}

export async function createCustomVoice(args: {
  bytes: Uint8Array;
  contentType: string;
  filename: string;
  name?: string;
  language?: string;
  gender?: string;
  tone?: string;
}) {
  const form = new FormData();
  if (args.name) form.append("name", args.name.slice(0, 80));
  if (args.language) form.append("language", args.language);
  if (args.gender && ["male", "female", "neutral"].includes(args.gender)) form.append("gender", args.gender);
  if (args.tone && ["warm", "casual", "professional", "friendly", "authoritative", "expressive", "calm"].includes(args.tone)) {
    form.append("tone", args.tone);
  }
  form.append("use_case", "characters");
  // `file` must be last in the multipart form.
  form.append("file", new Blob([args.bytes as BlobPart], { type: args.contentType }), args.filename);
  const res = await xaiFetch("/custom-voices", { method: "POST", body: form }, 60_000);
  if (res.status === 403) {
    throw new XaiError(
      "Voice cloning via API requires an xAI Enterprise plan (and is US-only, excluding Illinois). Clone in the xAI console, then paste the voice ID.",
      403,
      "xai_clone_not_enabled",
    );
  }
  if (!res.ok) await failFrom(res, "xai_clone_failed");
  return (await res.json()) as { voice_id: string; name?: string | null; language?: string | null };
}

/** Duration of a PCM WAV from its header (null for other containers). */
export function wavDurationSeconds(bytes: Uint8Array): number | null {
  if (bytes.length < 44) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(bytes[o], bytes[o + 1], bytes[o + 2], bytes[o + 3]);
  if (tag(0) !== "RIFF" || tag(8) !== "WAVE") return null;
  let off = 12;
  let byteRate = 0;
  while (off + 8 <= bytes.length) {
    const id = tag(off);
    const size = dv.getUint32(off + 4, true);
    if (id === "fmt ") byteRate = dv.getUint32(off + 16, true);
    if (id === "data") return byteRate ? size / byteRate : null;
    off += 8 + size + (size % 2);
  }
  return null;
}
