/**
 * anima-voice/1: the self-hosted voice contract (docs/voice-local.md).
 * Shared by the /api/voice/local routes, the home-box client and the tests.
 * Builder (voice UI) and 3D Visual (lip-sync) consume these shapes.
 */

export const VOICE_CONTRACT = "anima-voice/1" as const;

/** Kokoro's native output rate. Every offset below is on this clock. */
export const TTS_SAMPLE_RATE = 24_000;
/** STT input: 16 kHz mono PCM16 (push-to-talk). */
export const STT_SAMPLE_RATE = 16_000;
export const STT_MAX_SECONDS = 60;
/** 60 s of 16 kHz mono PCM16 is 1,920,000 bytes; a WAV header adds 44. */
export const STT_MAX_PCM_BYTES = STT_SAMPLE_RATE * 2 * STT_MAX_SECONDS;
export const STT_MAX_BODY_BYTES = 2 * 1024 * 1024;
/** One sentence per /speak call; a reply is several segments. */
export const SPEAK_MAX_CHARS = 1_000;

export type Viseme = "aa" | "ih" | "ou" | "ee" | "oh" | "sil";
export const VISEMES: readonly Viseme[] = ["aa", "ih", "ou", "ee", "oh", "sil"];

export type VisemeCue = { viseme: Viseme; startMs: number; endMs: number; weight?: number };
export type WordTiming = { word: string; startMs: number; endMs: number };

export type LocalVoiceState = "online" | "offline" | "disabled" | "busy";
export type LocalVoiceReason = "box_unreachable" | "model_loading" | "disabled_by_user" | "busy";

export type LocalVoiceStatus = {
  contract: typeof VOICE_CONTRACT;
  state: LocalVoiceState;
  /** Present whenever state !== "online". */
  reason?: LocalVoiceReason;
  tts: { engine: "kokoro"; sampleRate: number; formats: ["pcm16"]; visemes: true; ok: boolean };
  stt: { engine: "faster-whisper"; sampleRate: number; partials: false; maxSeconds: number; ok: boolean };
  /** The server never falls back to a cloud voice on its own. */
  cloudFallback: false;
};

/** Body of every 503 the local voice routes return. */
export type VoiceUnavailableBody = {
  error: string;
  code: "voice_offline" | "voice_disabled" | "voice_busy";
  reason: LocalVoiceReason;
  retryable: boolean;
  cloudFallback: false;
};

/** ms on the 24 kHz timeline → sample index. */
export function sampleOffsetFor(offsetMs: number, rate = TTS_SAMPLE_RATE): number {
  return Math.max(0, Math.round((offsetMs * rate) / 1000));
}

export function unavailableBody(reason: LocalVoiceReason): VoiceUnavailableBody {
  switch (reason) {
    case "disabled_by_user":
      return {
        error: "Self-hosted voice is switched off on this server.",
        code: "voice_disabled",
        reason,
        retryable: false,
        cloudFallback: false,
      };
    case "busy":
      return {
        error: "Her voice is busy finishing another line. Try again in a moment.",
        code: "voice_busy",
        reason,
        retryable: true,
        cloudFallback: false,
      };
    case "model_loading":
      return {
        error: "Her voice is waking up on your home voice server. Try again in a moment.",
        code: "voice_offline",
        reason,
        retryable: true,
        cloudFallback: false,
      };
    default:
      return {
        error: "Her voice is offline — your home voice server isn't reachable.",
        code: "voice_offline",
        reason: "box_unreachable",
        retryable: true,
        cloudFallback: false,
      };
  }
}
