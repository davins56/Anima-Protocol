/**
 * V6 voice UI: client for the self-hosted voice contract `anima-voice/1`
 * (docs/voice-local.md, routes in api-server/src/routes/voiceLocal.ts).
 *
 * Fail closed: a 503 (`voice_offline` / `voice_disabled` / `voice_busy`) is
 * returned as an offline result. Nothing here calls a cloud voice.
 */
import { apiUrl } from "@/lib/apiOrigin";
import { authHeaders } from "@/api/authBridge";

export type LocalVoiceState = "online" | "offline" | "disabled" | "busy";
export type LocalVoiceReason = "box_unreachable" | "model_loading" | "disabled_by_user" | "busy";

export interface LocalVoiceStatus {
  state: LocalVoiceState;
  reason?: LocalVoiceReason | string;
  stt?: { maxSeconds?: number; ok?: boolean; sampleRate?: number };
  tts?: { ok?: boolean; sampleRate?: number; visemes?: boolean };
}

export interface VoiceUnavailable {
  ok: false;
  status: number;
  code: string;
  reason: string | null;
  message: string;
}

/** Type guard (the project's TS config doesn't narrow on `ok: false`). */
export function isUnavailable(x: unknown): x is VoiceUnavailable {
  return Boolean(x) && typeof x === "object" && (x as { ok?: unknown }).ok === false;
}

export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh" | "sil";
export interface VisemeCue {
  viseme: Viseme;
  startMs: number;
  endMs: number;
  weight?: number;
}

export type SpeakEvent =
  | { type: "meta"; streamId: string; utteranceId: string; sentenceIndex: number; offsetMs: number; sampleRate: number; voice?: { id?: string } }
  | { type: "visemes"; seq: number; offsetMs: number; cues: VisemeCue[] }
  | { type: "word"; seq: number; word: string; startMs: number; endMs: number }
  | { type: "audio"; seq: number; offsetMs: number; samples: number; durationMs: number; pcm: string }
  | { type: "stopped"; heardMs: number }
  | { type: "error"; code: string; reason?: string; retryable?: boolean; error?: string }
  | { type: "done"; reason: "completed" | "stopped" | "error"; durationMs: number; totalMs: number };

export const OFFLINE_COPY: Record<string, string> = {
  box_unreachable: "Her voice is offline. Your home voice server isn't reachable.",
  model_loading: "Her voice is waking up on your home server. Try again in a moment.",
  disabled_by_user: "Local voice is switched off on the server.",
  busy: "Her voice is busy with another reply.",
};

export function offlineMessage(reason: string | null | undefined): string {
  return (reason && OFFLINE_COPY[reason]) || OFFLINE_COPY.box_unreachable;
}

type FetchOpts = { fetchImpl?: typeof fetch; signal?: AbortSignal };

async function headers(extra: Record<string, string> = {}) {
  return { ...(await authHeaders()), ...extra };
}

async function unavailableFrom(res: Response): Promise<VoiceUnavailable> {
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const reason = typeof body.reason === "string" ? body.reason : null;
  const code = typeof body.code === "string" ? body.code : res.status === 503 ? "voice_offline" : "voice_error";
  const message =
    res.status === 503
      ? offlineMessage(reason ?? (code === "voice_busy" ? "busy" : code === "voice_disabled" ? "disabled_by_user" : null))
      : res.status === 413
        ? "That recording is too long (60 seconds max)."
        : res.status === 404
          ? "This companion wasn't found."
          : res.status === 401
            ? "Sign in again to use voice."
            : typeof body.error === "string"
              ? body.error
              : "Voice didn't work this time.";
  return { ok: false, status: res.status, code, reason, message };
}

export async function fetchLocalVoiceStatus({ fetchImpl = globalThis.fetch, signal }: FetchOpts = {}, fresh = false): Promise<LocalVoiceStatus> {
  try {
    const res = await fetchImpl(apiUrl(`/voice/local/status${fresh ? "?fresh=1" : ""}`), {
      headers: await headers(),
      credentials: "include",
      signal,
    });
    const body = (await res.json().catch(() => null)) as LocalVoiceStatus | null;
    if (!res.ok || !body || typeof body.state !== "string") return { state: "offline", reason: "box_unreachable" };
    return body;
  } catch {
    return { state: "offline", reason: "box_unreachable" };
  }
}

export async function fetchLocalVoices({ fetchImpl = globalThis.fetch }: FetchOpts = {}): Promise<string[] | VoiceUnavailable> {
  try {
    const res = await fetchImpl(apiUrl("/voice/local/voices"), { headers: await headers(), credentials: "include" });
    if (!res.ok) return unavailableFrom(res);
    const body = (await res.json().catch(() => ({}))) as { voices?: unknown };
    return Array.isArray(body.voices) ? body.voices.filter((v): v is string => typeof v === "string") : [];
  } catch {
    return { ok: false, status: 0, code: "network", reason: null, message: "Couldn't reach the server." };
  }
}

/** Parse SSE text into named events. Returns the unparsed tail. */
export function parseNamedSse(text: string): { rest: string; events: { event: string; data: unknown }[] } {
  const blocks = text.replace(/\r\n/g, "\n").split("\n\n");
  const rest = blocks.pop() ?? "";
  const events: { event: string; data: unknown }[] = [];
  for (const block of blocks) {
    let event = "message";
    const data: string[] = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) event = line.slice(6).trim();
      else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
    }
    if (!data.length) continue;
    try {
      events.push({ event, data: JSON.parse(data.join("\n")) });
    } catch {
      // skip a malformed block
    }
  }
  return { rest, events };
}

function toSpeakEvent(event: string, data: unknown): SpeakEvent | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  switch (event) {
    case "meta":
    case "visemes":
    case "word":
    case "audio":
    case "stopped":
    case "error":
    case "done":
      return { type: event, ...d } as SpeakEvent;
    default:
      return null;
  }
}

/**
 * POST /voice/:characterId/speak and stream its events. Resolves with an
 * unavailable result (never a cloud fallback) when the route answers non-2xx.
 */
export async function speakSentence(
  characterId: string,
  body: { utteranceId: string; sentenceIndex: number; sentenceOffsetMs: number; text: string },
  onEvent: (e: SpeakEvent) => void,
  { fetchImpl = globalThis.fetch, signal }: FetchOpts = {},
): Promise<{ ok: true } | VoiceUnavailable> {
  let res: Response;
  try {
    res = await fetchImpl(apiUrl(`/voice/${encodeURIComponent(characterId)}/speak`), {
      method: "POST",
      headers: await headers({ "Content-Type": "application/json", Accept: "text/event-stream" }),
      credentials: "include",
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error)?.name === "AbortError") return { ok: true };
    return { ok: false, status: 0, code: "voice_offline", reason: "box_unreachable", message: offlineMessage("box_unreachable") };
  }
  if (!res.ok || !res.body) return unavailableFrom(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { rest, events } = parseNamedSse(buffer);
      buffer = rest;
      for (const e of events) {
        const ev = toSpeakEvent(e.event, e.data);
        if (ev) onEvent(ev);
      }
    }
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") {
      return { ok: false, status: 0, code: "voice_offline", reason: "box_unreachable", message: offlineMessage("box_unreachable") };
    }
  }
  return { ok: true };
}

export async function stopSpeaking(
  characterId: string,
  streamId: string,
  body: { utteranceId: string; heardMs: number; reason: "barge_in" | "user_stop" | "navigation" },
  { fetchImpl = globalThis.fetch }: FetchOpts = {},
): Promise<{ heardText: string | null } | null> {
  try {
    const res = await fetchImpl(
      apiUrl(`/voice/${encodeURIComponent(characterId)}/speak/${encodeURIComponent(streamId)}/stop`),
      {
        method: "POST",
        headers: await headers({ "Content-Type": "application/json" }),
        credentials: "include",
        body: JSON.stringify({ ...body, heardMs: Math.max(0, Math.round(body.heardMs)) }),
        keepalive: true,
      },
    );
    if (!res.ok) return null;
    const json = (await res.json().catch(() => ({}))) as { heardText?: unknown };
    return { heardText: typeof json.heardText === "string" ? json.heardText : null };
  } catch {
    return null;
  }
}

export const TRANSCRIBE_MAX_SECONDS = 60;
export const TRANSCRIBE_RATE = 16000;

/** Push-to-talk: 16 kHz mono s16le (`audio/pcm;rate=16000`), 60 s cap. */
export async function transcribe(
  characterId: string,
  pcm: Int16Array,
  { fetchImpl = globalThis.fetch, signal }: FetchOpts = {},
): Promise<{ ok: true; text: string; durationMs: number } | VoiceUnavailable> {
  if (pcm.length === 0) return { ok: false, status: 400, code: "voice_audio_invalid", reason: null, message: "Nothing was recorded." };
  const capped = pcm.length > TRANSCRIBE_RATE * TRANSCRIBE_MAX_SECONDS ? pcm.subarray(0, TRANSCRIBE_RATE * TRANSCRIBE_MAX_SECONDS) : pcm;
  // s16le regardless of platform endianness.
  const bytes = new Uint8Array(capped.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < capped.length; i++) view.setInt16(i * 2, capped[i], true);
  try {
    const res = await fetchImpl(apiUrl(`/voice/${encodeURIComponent(characterId)}/transcribe`), {
      method: "POST",
      headers: await headers({ "Content-Type": `audio/pcm;rate=${TRANSCRIBE_RATE}` }),
      credentials: "include",
      body: bytes,
      signal,
    });
    if (!res.ok) return unavailableFrom(res);
    const json = (await res.json().catch(() => ({}))) as { text?: unknown; durationMs?: unknown };
    return {
      ok: true,
      text: typeof json.text === "string" ? json.text.trim() : "",
      durationMs: typeof json.durationMs === "number" ? json.durationMs : 0,
    };
  } catch {
    return { ok: false, status: 0, code: "voice_offline", reason: "box_unreachable", message: offlineMessage("box_unreachable") };
  }
}
