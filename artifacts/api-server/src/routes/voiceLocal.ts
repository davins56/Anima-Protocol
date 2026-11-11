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
import { acquireVoiceSlot, releaseVoiceSlot, VOICE_SLOT_HEARTBEAT_MS, VoiceSlotBusyError } from "../lib/voice/voiceSlot";

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

function countWords(text: string): number {
  return (text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;
}

router.post("/:characterId/speak", rateLimit, speakLimit, async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  const b = (req.body || {}) as Record<string, unknown>;
  const text = cleanSpokenText(b.text, SPEAK_MAX_CHARS);
  const utteranceId = typeof b.utteranceId === "string" && ID_RE.test(b.utteranceId) ? b.utteranceId : "";
  const sentenceIndex = Number.isInteger(b.sentenceIndex) && Number(b.sentenceIndex) >= 0 ? Number(b.sentenceIndex) : 0;
  const rawOffset = Number(b.sentenceOffsetMs ?? 0);
  if (!utteranceId || !text || !Number.isFinite(rawOffset) || rawOffset < 0) {
    res.status(400).json({ error: "utteranceId, text and a non-negative sentenceOffsetMs are required.", code: "voice_bad_request" });
    return;
  }
  const sentenceOffsetMs = Math.round(rawOffset);
  const character = await ownedCharacter(req, res, userId);
  if (!character) return;

  const status = await localVoiceStatus();
  if (status.state === "disabled" || status.state === "offline") return unavailable(res, status.reason ?? "box_unreachable");

  const voice = kokoroVoiceFor(character);
  const streamId = `vs_${userTag(userId)}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const abort = new AbortController();
  let finished = false;
  let stoppedSent = false;
  let emittedMs = 0; // sentence-relative audio already sent

  res.status(200);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Accel-Buffering", "no");
  if (typeof res.flushHeaders === "function") res.flushHeaders();
  const send = (event: string, data: unknown) => {
    if (res.writableEnded) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };
  const cum = (ms: number) => sentenceOffsetMs + ms;
  const done = (reason: "completed" | "stopped" | "error") => {
    if (finished) return;
    finished = true;
    send("done", { streamId, utteranceId, sentenceIndex, reason, durationMs: emittedMs, totalMs: cum(emittedMs) });
    res.end();
  };

  // meta first, before the slot or Kokoro, so an instant barge-in can stop it.
  send("meta", {
    contract: VOICE_CONTRACT,
    streamId,
    utteranceId,
    sentenceIndex,
    sentenceOffsetMs,
    offsetMs: sentenceOffsetMs,
    sampleOffset: sampleOffsetFor(sentenceOffsetMs),
    sampleRate: TTS_SAMPLE_RATE,
    format: "pcm16",
    channels: 1,
    voice: { id: voice, engine: "kokoro" },
  });

  const key = wordsKey(userId, utteranceId);
  pruneUtterances();
  const record = utteranceWords.get(key) ?? { at: Date.now(), words: [] };
  if (sentenceIndex === 0) record.words = [];
  record.at = Date.now();
  utteranceWords.set(key, record);

  const stop = (heardMs: number | null) => {
    if (!stoppedSent && !finished) {
      stoppedSent = true;
      const ms = heardMs == null ? null : Math.max(0, Math.round(heardMs));
      send("stopped", { streamId, utteranceId, heardMs: ms, offsetMs: ms, sampleOffset: ms == null ? null : sampleOffsetFor(ms) });
    }
    abort.abort(new Error("stopped"));
    done("stopped");
  };
  activeStreams.set(streamId, { userId, utteranceId, stop });
  res.on("close", () => {
    if (!finished) abort.abort(new Error("client left"));
  });

  let grant: Awaited<ReturnType<typeof acquireVoiceSlot>> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  try {
    const waitEnv = Number(process.env.ANIMA_VOICE_SLOT_WAIT_MS);
    grant = await acquireVoiceSlot(streamId, {
      signal: abort.signal,
      waitMs: Number.isFinite(waitEnv) && waitEnv >= 0 ? Math.min(waitEnv, 30_000) : undefined,
    });
    if (abort.signal.aborted) return;
    heartbeat = setInterval(() => {
      void grant?.stillHeld().then((held) => {
        if (!held && !finished) stop(null); // released by /stop in another isolate
      });
    }, VOICE_SLOT_HEARTBEAT_MS);
    heartbeat.unref?.();

    const ipaPromise = phonemize(text, abort.signal);
    let ipaWords: string[] | null | undefined;
    let ipaCursor = 0;
    let lastCueEnd = 0;
    let seq = 0;
    let carry = new Uint8Array(0);

    for await (const chunk of streamKokoro({ text, voice, signal: abort.signal })) {
      if (abort.signal.aborted) break;
      if (ipaWords === undefined) {
        const ipa = await ipaPromise;
        const list = ipa ? ipa.split(/\s+/).filter((w) => /[\p{L}\u0250-\u02AF]/u.test(w)) : [];
        ipaWords = list.length && list.length === countWords(text) ? list : null;
      }
      // Whole samples only; an odd trailing byte waits for the next chunk.
      const joined = new Uint8Array(carry.length + chunk.pcm.length);
      joined.set(carry);
      joined.set(chunk.pcm, carry.length);
      const usable = joined.length - (joined.length % 2);
      const pcm = joined.subarray(0, usable);
      carry = joined.slice(usable);
      const chunkStart = emittedMs;
      const chunkMs = (pcm.length / 2 / TTS_SAMPLE_RATE) * 1000;
      const chunkEnd = chunkStart + chunkMs;

      // Kokoro's timings are normally sentence-relative; tolerate chunk-relative ones.
      let words = chunk.words;
      if (words.length && chunkStart > 0 && words[0].startMs + 50 < chunkStart) {
        words = words.map((w) => ({ ...w, startMs: w.startMs + chunkStart, endMs: w.endMs + chunkStart }));
      }
      const ipaForChunk = words.map((w) => (ipaWords && /[\p{L}\p{N}]/u.test(w.word) ? ipaWords[ipaCursor++] ?? null : null));
      const cues: VisemeCue[] = wordsToVisemeCues(words, ipaForChunk, lastCueEnd);
      const lastEnd = cues.length ? cues[cues.length - 1].endMs : Math.max(lastCueEnd, Math.round(chunkStart));
      const tail = tailSilence(lastEnd, chunkEnd);
      if (tail) cues.push(tail);
      if (cues.length) lastCueEnd = cues[cues.length - 1].endMs;

      // Ordering: this window's visemes and words go out before its audio.
      if (cues.length) {
        send("visemes", {
          seq,
          offsetMs: cum(Math.round(chunkStart)),
          sampleOffset: sampleOffsetFor(cum(chunkStart)),
          cues: cues.map((c) => ({ ...c, startMs: cum(c.startMs), endMs: cum(c.endMs) })),
        });
      }
      for (const w of words) {
        const cw = { word: w.word, startMs: cum(w.startMs), endMs: cum(w.endMs) };
        record.words.push(cw);
        send("word", { seq, ...cw, offsetMs: cw.startMs, sampleOffset: sampleOffsetFor(cw.startMs) });
      }
      for (let off = 0; off < pcm.length; off += AUDIO_FRAME_BYTES) {
        if (abort.signal.aborted) break;
        const frame = pcm.subarray(off, Math.min(pcm.length, off + AUDIO_FRAME_BYTES));
        const frameStart = chunkStart + (off / 2 / TTS_SAMPLE_RATE) * 1000;
        const samples = frame.length / 2;
        send("audio", {
          seq: seq++,
          offsetMs: cum(Math.round(frameStart)),
          sampleOffset: sampleOffsetFor(cum(frameStart)),
          samples,
          durationMs: Math.round((samples / TTS_SAMPLE_RATE) * 1000),
          pcm: Buffer.from(frame).toString("base64"),
        });
        emittedMs = frameStart + (samples / TTS_SAMPLE_RATE) * 1000;
      }
      emittedMs = Math.max(emittedMs, chunkEnd);
    }
    emittedMs = Math.round(emittedMs);
    if (!abort.signal.aborted) done("completed");
  } catch (err) {
    if (finished || stoppedSent) return;
    if (abort.signal.aborted) return; // client left: nobody to tell
    const reason: LocalVoiceReason =
      err instanceof VoiceSlotBusyError ? "busy" : err instanceof LocalVoiceUnavailable ? err.reason : "box_unreachable";
    const body = unavailableBody(reason);
    send("error", { code: body.code, reason: body.reason, retryable: body.retryable, cloudFallback: false, error: body.error });
    done("error");
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    activeStreams.delete(streamId);
    await grant?.release();
    if (!finished && !res.writableEnded) res.end();
  }
});

router.post("/:characterId/speak/:streamId/stop", rateLimit, async (req, res) => {
  const userId = uid(req, res);
  if (!userId) return;
  if (!(await ownedCharacter(req, res, userId))) return;
  const streamId = String(req.params.streamId || "");
  if (!streamId.startsWith(`vs_${userTag(userId)}_`) || !ID_RE.test(streamId)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const b = (req.body || {}) as Record<string, unknown>;
  const heardRaw = Number(b.heardMs);
  const heardMs = Number.isFinite(heardRaw) && heardRaw >= 0 ? Math.round(heardRaw) : null;
  const reason = ["barge_in", "user_stop", "navigation"].includes(String(b.reason)) ? String(b.reason) : "user_stop";
  const local = activeStreams.get(streamId);
  const utteranceId = local?.utteranceId ?? (typeof b.utteranceId === "string" && ID_RE.test(b.utteranceId) ? b.utteranceId : null);
  local?.stop(heardMs);
  await releaseVoiceSlot(streamId); // reaches a stream held by another isolate
  const words = utteranceId ? utteranceWords.get(wordsKey(userId, utteranceId))?.words : undefined;
  const heardText = words && heardMs != null ? heardTextFor(words, heardMs) : null;
  res.setHeader("Cache-Control", "no-store");
  res.json({
    event: "final",
    streamId,
    utteranceId,
    reason: "stopped",
    stopReason: reason,
    heardMs,
    heardText,
    heardTextSource: heardText == null ? "unavailable" : "server",
    cancelled: { tts: true },
  });
});

export default router;
