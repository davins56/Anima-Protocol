/**
 * Home-box voice client (anima-voice/1). Talks to the bearer proxy on the
 * user's home box (scripts/llm/public-v1/openai-proxy.py):
 *   {base}/tts/*  → Kokoro-FastAPI   (GPU, :8880)
 *   {base}/stt/*  → speaches / faster-whisper (CPU, :8000)
 *
 * Never calls a cloud voice. When the box is down every caller gets a
 * LocalVoiceUnavailable with a reason; the routes turn that into a 503 with
 * cloudFallback:false.
 */
import type { LocalVoiceReason, LocalVoiceStatus, WordTiming } from "./localContract";
import { STT_MAX_SECONDS, STT_SAMPLE_RATE, TTS_SAMPLE_RATE, VOICE_CONTRACT } from "./localContract";

const OFF = new Set(["0", "false", "off", "no", "disabled"]);
export const DEFAULT_KOKORO_VOICE = "af_heart";
export const DEFAULT_STT_MODEL = "Systran/faster-distil-whisper-small.en";
const PROBE_TIMEOUT_MS = 2_500;
const PROBE_CACHE_MS = 10_000;
/** Time to response headers from Kokoro; generation itself streams after. */
const TTS_OPEN_TIMEOUT_MS = 8_000;
const STT_TIMEOUT_MS = 45_000;
const CLIP_TIMEOUT_MS = 30_000;
/** Kokoro voice names: `af_heart`, `am_michael`, `bf_emma`… (no blends). */
const KOKORO_VOICE_RE = /^[a-z]{2}_[a-z0-9]{2,24}$/;

export class LocalVoiceUnavailable extends Error {
  constructor(public reason: LocalVoiceReason, message?: string) {
    super(message || `local voice unavailable: ${reason}`);
    this.name = "LocalVoiceUnavailable";
  }
}

type Env = NodeJS.ProcessEnv;

export function localVoiceBaseUrl(env: Env = process.env): string {
  return String(env.ANIMA_LOCAL_VOICE_BASE_URL || "").trim().replace(/\/+$/, "");
}

/** Same bearer as the LLM proxy unless a separate voice key is set. */
function localVoiceKey(env: Env = process.env): string {
  return String(env.ANIMA_LOCAL_VOICE_API_KEY || env.ANIMA_LOCAL_LLM_API_KEY || "").trim();
}

/** Off when switched off by the owner (`ANIMA_LOCAL_VOICE=off`) or when no box URL is set. */
export function localVoiceEnabled(env: Env = process.env): boolean {
  if (OFF.has(String(env.ANIMA_LOCAL_VOICE ?? "").trim().toLowerCase())) return false;
  return Boolean(localVoiceBaseUrl(env));
}

export function kokoroVoiceFor(character: Record<string, unknown> | null, env: Env = process.env): string {
  const saved = String(character?.kokoro_voice_id ?? "").trim().toLowerCase();
  if (KOKORO_VOICE_RE.test(saved)) return saved;
  const fallback = String(env.ANIMA_LOCAL_VOICE_DEFAULT || "").trim().toLowerCase();
  return KOKORO_VOICE_RE.test(fallback) ? fallback : DEFAULT_KOKORO_VOICE;
}

export function isKokoroVoiceId(v: unknown): boolean {
  return typeof v === "string" && KOKORO_VOICE_RE.test(v);
}

function headers(extra: Record<string, string> = {}): Record<string, string> {
  const key = localVoiceKey();
  return { ...(key ? { Authorization: `Bearer ${key}` } : {}), ...extra };
}

function linkSignals(parent: AbortSignal | undefined, ms: number): { signal: AbortSignal; clear: () => void } {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error("timeout")), ms);
  const onAbort = () => ctrl.abort(parent?.reason);
  if (parent?.aborted) ctrl.abort(parent.reason);
  else parent?.addEventListener("abort", onAbort, { once: true });
  return {
    signal: ctrl.signal,
    clear: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", onAbort);
    },
  };
}

async function boxFetch(path: string, init: RequestInit, timeoutMs: number, parent?: AbortSignal): Promise<Response> {
  const base = localVoiceBaseUrl();
  if (!localVoiceEnabled() || !base) throw new LocalVoiceUnavailable("disabled_by_user");
  const { signal, clear } = linkSignals(parent, timeoutMs);
  try {
    return await fetch(`${base}${path}`, { ...init, signal });
  } catch (err) {
    if (parent?.aborted) throw err;
    throw new LocalVoiceUnavailable("box_unreachable", (err as Error)?.message);
  } finally {
    clear();
  }
}

/** Non-2xx from the box: 502/504 from the tunnel = unreachable; 503 = model still loading. */
function reasonForStatus(status: number): LocalVoiceReason {
  return status === 503 ? "model_loading" : "box_unreachable";
}

type Probe = { ok: boolean; reason?: LocalVoiceReason };

async function probeOne(path: string): Promise<Probe> {
  try {
    const res = await boxFetch(path, { headers: headers() }, PROBE_TIMEOUT_MS);
    if (!res.ok) return { ok: false, reason: reasonForStatus(res.status) };
    const body = (await res.json().catch(() => ({}))) as { status?: string };
    const s = String(body?.status ?? "").toLowerCase();
    if (/load|init|start|warm/.test(s)) return { ok: false, reason: "model_loading" };
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof LocalVoiceUnavailable ? err.reason : "box_unreachable" };
  }
}

let probeCache: { at: number; status: LocalVoiceStatus } | null = null;

export function resetLocalVoiceProbeForTests(): void {
  probeCache = null;
}

/**
 * Health of the home box. `busyNow` lets the route report a live stream held
 * by this isolate. Cached for 10 s so status polling never hammers the tunnel.
 */
export async function localVoiceStatus(opts: { fresh?: boolean; busyNow?: boolean } = {}): Promise<LocalVoiceStatus> {
  const base = (tts: boolean, stt: boolean): LocalVoiceStatus => ({
    contract: VOICE_CONTRACT,
    state: "online",
    tts: { engine: "kokoro", sampleRate: TTS_SAMPLE_RATE, formats: ["pcm16"], visemes: true, ok: tts },
    stt: { engine: "faster-whisper", sampleRate: STT_SAMPLE_RATE, partials: false, maxSeconds: STT_MAX_SECONDS, ok: stt },
    cloudFallback: false,
  });
  if (!localVoiceEnabled()) return { ...base(false, false), state: "disabled", reason: "disabled_by_user" };
  let status: LocalVoiceStatus;
  if (!opts.fresh && probeCache && Date.now() - probeCache.at < PROBE_CACHE_MS) {
    status = probeCache.status;
  } else {
    const [tts, stt] = await Promise.all([probeOne("/tts/health"), probeOne("/stt/health")]);
    status = base(tts.ok, stt.ok);
    if (!tts.ok) {
      status.state = "offline";
      status.reason = tts.reason ?? "box_unreachable";
    }
    probeCache = { at: Date.now(), status };
  }
  if (status.state === "online" && opts.busyNow) return { ...status, state: "busy", reason: "busy" };
  return status;
}

/** Kokoro's built-in voices (proxied for the Builder voice picker). */
export async function listKokoroVoices(): Promise<string[]> {
  const res = await boxFetch("/tts/v1/audio/voices", { headers: headers() }, PROBE_TIMEOUT_MS * 2);
  if (!res.ok) throw new LocalVoiceUnavailable(reasonForStatus(res.status));
  const body = (await res.json()) as { voices?: unknown[] };
  return (body.voices || []).map(String).filter((v) => KOKORO_VOICE_RE.test(v));
}

/** IPA for the sentence (misaki). Null on any failure; visemes fall back to spelling. */
export async function phonemize(text: string, signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await boxFetch(
      "/tts/dev/phonemize",
      { method: "POST", headers: headers({ "Content-Type": "application/json" }), body: JSON.stringify({ text, language: "a" }) },
      2_000,
      signal,
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { phonemes?: string };
    return typeof body.phonemes === "string" ? body.phonemes : null;
  } catch {
    return null;
  }
}

export type KokoroChunk = { pcm: Uint8Array; words: WordTiming[] };

/**
 * Stream Kokoro's captioned speech as raw 24 kHz PCM16 chunks with their
 * word timings (ms). Kokoro-FastAPI sends newline-delimited JSON
 * `{audio: base64, audio_format, timestamps: [{word, start_time, end_time}]}`.
 */
export async function* streamKokoro(args: {
  text: string;
  voice: string;
  speed?: number;
  signal: AbortSignal;
}): AsyncGenerator<KokoroChunk> {
  const res = await boxFetch(
    "/tts/dev/captioned_speech",
    {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        model: "kokoro",
        input: args.text,
        voice: args.voice,
        speed: args.speed ?? 1,
        response_format: "pcm",
        stream: true,
        return_timestamps: true,
      }),
    },
    TTS_OPEN_TIMEOUT_MS,
    args.signal,
  );
  if (!res.ok || !res.body) {
    await res.body?.cancel().catch(() => {});
    throw new LocalVoiceUnavailable(reasonForStatus(res.status), `kokoro ${res.status}`);
  }
  const reader = res.body.getReader();
  const onAbort = () => void reader.cancel().catch(() => {});
  args.signal.addEventListener("abort", onAbort, { once: true });
  const decoder = new TextDecoder();
  let buf = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        const chunk = parseKokoroLine(line);
        if (chunk) yield chunk;
      }
    }
    const tail = parseKokoroLine(buf.trim());
    if (tail) yield tail;
  } finally {
    args.signal.removeEventListener("abort", onAbort);
    reader.releaseLock?.();
  }
}

export function parseKokoroLine(line: string): KokoroChunk | null {
  if (!line) return null;
  let j: { audio?: string; timestamps?: Array<{ word?: string; start_time?: number; end_time?: number }> | null };
  try {
    j = JSON.parse(line);
  } catch {
    return null;
  }
  const pcm = j.audio ? new Uint8Array(Buffer.from(j.audio, "base64")) : new Uint8Array(0);
  const words = (j.timestamps || [])
    .filter((t) => typeof t?.word === "string" && Number.isFinite(t.start_time) && Number.isFinite(t.end_time))
    .map((t) => ({ word: String(t.word), startMs: Math.round(Number(t.start_time) * 1000), endMs: Math.round(Number(t.end_time) * 1000) }));
  if (!pcm.length && !words.length) return null;
  return { pcm, words };
}

/** Short voice note (MP3) in her Kokoro voice, for /api/media/voice-clip. */
export async function synthesizeKokoroClip(text: string, voice: string, signal?: AbortSignal): Promise<{ bytes: Uint8Array; contentType: string }> {
  const res = await boxFetch(
    "/tts/v1/audio/speech",
    {
      method: "POST",
      headers: headers({ "Content-Type": "application/json" }),
      body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "mp3" }),
    },
    CLIP_TIMEOUT_MS,
    signal,
  );
  if (!res.ok) throw new LocalVoiceUnavailable(reasonForStatus(res.status), `kokoro ${res.status}`);
  return { bytes: new Uint8Array(await res.arrayBuffer()), contentType: "audio/mpeg" };
}

export type Transcript = { text: string; language: string | null; durationMs: number; words: Array<{ w: string; startMs: number; endMs: number }> };

/** Push-to-talk transcription on the box (speaches, OpenAI-compatible). */
export async function transcribeOnBox(wav: Uint8Array, signal?: AbortSignal, env: Env = process.env): Promise<Transcript> {
  const form = new FormData();
  form.append("model", String(env.ANIMA_LOCAL_STT_MODEL || DEFAULT_STT_MODEL));
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");
  form.append("file", new Blob([wav as BlobPart], { type: "audio/wav" }), "speech.wav");
  const res = await boxFetch("/stt/v1/audio/transcriptions", { method: "POST", headers: headers(), body: form }, STT_TIMEOUT_MS, signal);
  if (!res.ok) throw new LocalVoiceUnavailable(reasonForStatus(res.status), `stt ${res.status}`);
  const body = (await res.json()) as {
    text?: string;
    language?: string;
    duration?: number;
    words?: Array<{ word?: string; start?: number; end?: number }>;
  };
  return {
    text: String(body.text || "").trim(),
    language: body.language ? String(body.language) : null,
    durationMs: Math.round(Number(body.duration || 0) * 1000),
    words: (body.words || [])
      .filter((w) => typeof w.word === "string")
      .map((w) => ({ w: String(w.word).trim(), startMs: Math.round(Number(w.start || 0) * 1000), endMs: Math.round(Number(w.end || 0) * 1000) })),
  };
}
