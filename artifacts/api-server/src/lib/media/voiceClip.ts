/**
 * Voice notes, runtime half. Speaks short text in the Anima's saved voice
 * (character_voice → xAI /v1/tts, builtin or cloned), falling back to
 * ElevenLabs when only that key is set, and stores the MP3 in the uploads
 * blob table so the chat bubble can play it from
 * /api/storage/objects/uploads/:id.
 *
 * Like the realtime voice agent, this sends text to a third-party voice API;
 * only the words being spoken are sent, never memories or the persona.
 */
import { storeUploadedAudio, UPLOADS_PATH_PREFIX } from "../imageUploads";
import { currentVoice, DEFAULT_VOICE_ID } from "../voice/voiceStore";
import { XAI_API_BASE, xaiKey } from "../voice/xaiVoiceClient";
import { cleanSpokenText, pickVoiceProvider, xaiTtsBody } from "./voiceClipCore";

const TTS_TIMEOUT_MS = 30_000;
const ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

export type VoiceClip = {
  url: string;
  contentType: string;
  byteSize: number;
  provider: "xai" | "elevenlabs";
  transcript: string;
};

export function voiceClipProvider(env: NodeJS.ProcessEnv = process.env): "xai" | "elevenlabs" | null {
  return pickVoiceProvider({ xai: Boolean(xaiKey(env)), elevenlabs: Boolean(String(env.ELEVENLABS_API_KEY || "").trim()) });
}

/** Aborts when the caller's signal does, or after `ms`. */
export function withTimeout(parent: AbortSignal | undefined, ms: number): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("Timed out")), ms);
  const stop = () => {
    clearTimeout(timer);
    controller.abort(parent?.reason);
  };
  if (parent?.aborted) stop();
  else parent?.addEventListener("abort", stop, { once: true });
  controller.signal.addEventListener("abort", () => clearTimeout(timer), { once: true });
  return controller.signal;
}

function statusError(message: string, status: number): Error {
  return Object.assign(new Error(message), { status });
}

async function speakWithXai(userId: string, characterId: string, text: string, signal: AbortSignal): Promise<Response> {
  const voice = await currentVoice(userId, characterId).catch(() => null);
  return fetch(`${XAI_API_BASE}/tts`, {
    method: "POST",
    headers: { Authorization: `Bearer ${xaiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify(xaiTtsBody(voice, text, DEFAULT_VOICE_ID)),
    signal,
  });
}

async function speakWithElevenLabs(text: string, signal: AbortSignal): Promise<Response> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID || ELEVENLABS_DEFAULT_VOICE;
  return fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_22050_32`, {
    method: "POST",
    headers: { "xi-api-key": String(process.env.ELEVENLABS_API_KEY || ""), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    signal,
  });
}

export async function synthesizeVoiceClip(args: {
  userId: string;
  characterId: string;
  text: string;
  signal?: AbortSignal;
}): Promise<VoiceClip> {
  const transcript = cleanSpokenText(args.text);
  if (!transcript) throw statusError("Nothing to say.", 400);
  const provider = voiceClipProvider();
  if (!provider) throw statusError("No voice provider is configured.", 503);

  const signal = withTimeout(args.signal, TTS_TIMEOUT_MS);
  const res =
    provider === "xai"
      ? await speakWithXai(args.userId, args.characterId, transcript, signal)
      : await speakWithElevenLabs(transcript, signal);
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 200);
    throw statusError(`Voice provider ${provider} returned ${res.status}${detail ? `: ${detail}` : ""}`, 502);
  }
  const contentType = (res.headers.get("content-type") || "audio/mpeg").split(";")[0];
  const bytes = new Uint8Array(await res.arrayBuffer());
  const stored = await storeUploadedAudio(args.userId, bytes, contentType);
  return {
    url: `/api/storage${UPLOADS_PATH_PREFIX}${stored.id}`,
    contentType: stored.contentType,
    byteSize: stored.byteSize,
    provider,
    transcript,
  };
}
