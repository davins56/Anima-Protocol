/**
 * Voice notes, runtime half. Speaks short text on the steward's home box
 * (Kokoro-FastAPI, her `kokoro_voice_id`, docs/voice-local.md) and stores the
 * MP3 in the uploads blob table so the chat bubble can play it from
 * /api/storage/objects/uploads/:id.
 *
 * Cloud voices are opt-in per request (`cloudOptIn`, off by default): xAI in
 * her saved character_voice, or ElevenLabs. When opted in they are tried only
 * if the box cannot speak; when not, a down box is a 503 voice_offline with
 * cloudFallback:false. Only the words being spoken are ever sent to a cloud
 * voice, never memories or the persona.
 */
import { storeUploadedAudio, UPLOADS_PATH_PREFIX } from "../imageUploads";
import { unavailableBody, type LocalVoiceReason } from "../voice/localContract";
import { kokoroVoiceFor, localVoiceEnabled, LocalVoiceUnavailable, synthesizeKokoroClip } from "../voice/localVoiceClient";
import { currentVoice, DEFAULT_VOICE_ID, loadCharacterRecord } from "../voice/voiceStore";
import { XAI_API_BASE, xaiKey } from "../voice/xaiVoiceClient";
import {
  cleanSpokenText,
  pickVoiceProvider,
  voiceProviderPlan,
  xaiTtsBody,
  type CloudVoiceOptIn,
  type VoiceClipProvider,
} from "./voiceClipCore";

const TTS_TIMEOUT_MS = 30_000;
const ELEVENLABS_DEFAULT_VOICE = "21m00Tcm4TlvDq8ikWAM";

export type VoiceClip = {
  url: string;
  contentType: string;
  byteSize: number;
  provider: VoiceClipProvider;
  transcript: string;
};

export function voiceClipKeys(env: NodeJS.ProcessEnv = process.env): { local: boolean; xai: boolean; elevenlabs: boolean } {
  return {
    local: localVoiceEnabled(env),
    xai: Boolean(xaiKey(env)),
    elevenlabs: Boolean(String(env.ELEVENLABS_API_KEY || "").trim()),
  };
}

/**
 * Who would speak a voice note with no opt-in: "local" when the home box is
 * configured, else null. Server-initiated notes (outreach) never use a cloud
 * voice because there is no steward request carrying an opt-in.
 */
export function voiceClipProvider(env: NodeJS.ProcessEnv = process.env, optIn: CloudVoiceOptIn = null): VoiceClipProvider | null {
  return pickVoiceProvider(voiceClipKeys(env), optIn);
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

function statusError(message: string, status: number, extra: Record<string, unknown> = {}): Error {
  return Object.assign(new Error(message), { status, ...extra });
}

function offlineError(reason: LocalVoiceReason): Error {
  const body = unavailableBody(reason);
  return statusError(body.error, 503, { code: body.code, reason: body.reason, cloudFallback: false });
}

async function speakWithLocal(userId: string, characterId: string, text: string, signal: AbortSignal): Promise<Response> {
  const character = await loadCharacterRecord(userId, characterId).catch(() => null);
  const clip = await synthesizeKokoroClip(text, kokoroVoiceFor(character), signal);
  return new Response(clip.bytes as BodyInit, { status: 200, headers: { "content-type": clip.contentType } });
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
  /** Explicit, per-request cloud opt-in. Default null: home box only. */
  cloudOptIn?: CloudVoiceOptIn;
}): Promise<VoiceClip> {
  const transcript = cleanSpokenText(args.text);
  if (!transcript) throw statusError("Nothing to say.", 400);
  const plan = voiceProviderPlan(voiceClipKeys(), args.cloudOptIn ?? null);
  if (!plan.length) throw offlineError(localVoiceEnabled() ? "box_unreachable" : "disabled_by_user");

  const signal = withTimeout(args.signal, TTS_TIMEOUT_MS);
  let res: Response | null = null;
  let provider: VoiceClipProvider = plan[0];
  for (let i = 0; i < plan.length; i++) {
    provider = plan[i];
    if (provider === "local") {
      try {
        res = await speakWithLocal(args.userId, args.characterId, transcript, signal);
        break;
      } catch (err) {
        const reason: LocalVoiceReason = err instanceof LocalVoiceUnavailable ? err.reason : "box_unreachable";
        // Only a provider the steward opted into may follow.
        if (i === plan.length - 1) throw offlineError(reason);
        continue;
      }
    }
    res =
      provider === "xai"
        ? await speakWithXai(args.userId, args.characterId, transcript, signal)
        : await speakWithElevenLabs(transcript, signal);
    break;
  }
  if (!res) throw offlineError("box_unreachable");
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
