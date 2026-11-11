/**
 * Self-hosted voice on the user's home box (anima-voice/1, docs/voice-local.md).
 * Mounted under /api/voice before the xAI voice router.
 *
 *   GET  /local/status                          box health + reason (never a cloud call)
 *   GET  /local/voices                          Kokoro built-in voices (picker)
 *   POST /:characterId/speak                    SSE: meta → (visemes, word…, audio…)* → done
 *   POST /:characterId/speak/:streamId/stop     barge-in; `stopped` on the stream, heardText here
 *   POST /:characterId/transcribe               push-to-talk, 16 kHz mono PCM16, ≤ 60 s
 *
 * Fail-closed: when the box is down these return 503 with cloudFallback:false.
 * Nothing here calls ElevenLabs, xAI or any other cloud voice.
 * Owner-only: a character the caller doesn't own is a 404, same as a missing one.
 */
import { createHash, randomUUID } from "node:crypto";
import express, { Router, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { createRateLimit, rateLimit } from "../lib/rateLimit";
import { loadCharacterRecord } from "../lib/voice/voiceStore";
import { cleanSpokenText } from "../lib/media/voiceClipCore";
import {
  kokoroVoiceFor,
  listKokoroVoices,
  LocalVoiceUnavailable,
  localVoiceStatus,
  phonemize,
  streamKokoro,
  transcribeOnBox,
} from "../lib/voice/localVoiceClient";
import {
  SPEAK_MAX_CHARS,
  STT_MAX_BODY_BYTES,
  STT_MAX_PCM_BYTES,
  STT_MAX_SECONDS,
  STT_SAMPLE_RATE,
  TTS_SAMPLE_RATE,
  VOICE_CONTRACT,
  sampleOffsetFor,
  unavailableBody,
  type LocalVoiceReason,
  type VisemeCue,
  type WordTiming,
} from "../lib/voice/localContract";
import { heardTextFor, tailSilence, wordsToVisemeCues } from "../lib/voice/visemes";

const router = Router();
// Per-route limiter: a router-wide use() would also count requests that fall
// through to voice.ts, which runs its own rateLimit.
const speakLimit = createRateLimit({ windowMs: 60_000, max: 60, name: "voice-local-speak" });
const sttLimit = createRateLimit({ windowMs: 60_000, max: 20, name: "voice-local-stt" });

/** ~250 ms of 24 kHz PCM16 per audio event. */
const AUDIO_FRAME_BYTES = (TTS_SAMPLE_RATE / 4) * 2;
const UTTERANCE_TTL_MS = 10 * 60_000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

type ActiveStream = {
  userId: string;
  utteranceId: string;
  stop: (heardMs: number | null) => void;
};
/** Streams held by this isolate (cross-isolate stop goes through the voice slot). */
const activeStreams = new Map<string, ActiveStream>();
/** Cumulative word timings per `${userId}:${utteranceId}` (this isolate), for heardText. */
const utteranceWords = new Map<string, { at: number; words: WordTiming[] }>();

export function resetVoiceLocalStateForTests(): void {
  activeStreams.clear();
  utteranceWords.clear();
}

function uid(req: Request, res: Response): string | null {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return userId;
}

/** 404 for missing and for not-yours alike. */
async function ownedCharacter(req: Request, res: Response, userId: string): Promise<Record<string, unknown> | null> {
  const characterId = String(req.params.characterId || "").slice(0, 120);
  const character = characterId ? await loadCharacterRecord(userId, characterId).catch(() => null) : null;
  if (!character) {
    res.status(404).json({ error: "Not found" });
    return null;
  }
  return character;
}

function unavailable(res: Response, reason: LocalVoiceReason): void {
  res.setHeader("Cache-Control", "no-store");
  res.status(503).json(unavailableBody(reason));
}

function userTag(userId: string): string {
  return createHash("sha256").update(`anima-voice:${userId}`).digest("hex").slice(0, 16);
}

function wordsKey(userId: string, utteranceId: string): string {
  return `${userId}:${utteranceId}`;
}

function pruneUtterances(now = Date.now()): void {
  for (const [k, v] of utteranceWords) if (now - v.at > UTTERANCE_TTL_MS) utteranceWords.delete(k);
}

router.get("/local/status", rateLimit, async (req, res) => {
  if (!uid(req, res)) return;
  const busyNow = activeStreams.size > 0;
  res.setHeader("Cache-Control", "no-store");
  res.json(await localVoiceStatus({ busyNow, fresh: req.query.fresh === "1" }));
});

router.get("/local/voices", rateLimit, async (req, res) => {
  if (!uid(req, res)) return;
  try {
    res.setHeader("Cache-Control", "private, max-age=600");
    res.json({ voices: await listKokoroVoices() });
  } catch (err) {
    if (err instanceof LocalVoiceUnavailable) return unavailable(res, err.reason);
    res.status(500).json({ error: "Voice list failed" });
  }
});

export default router;
