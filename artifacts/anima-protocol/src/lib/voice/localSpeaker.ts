/**
 * V6: speak a companion reply with her home-box voice (Kokoro via
 * `anima-voice/1`), one /speak request per sentence on one utterance clock,
 * played through StreamPlayer. Barge-in/stop: flush playback, emit the bus
 * `stop` immediately, POST stop with heardMs, abort the fetch.
 *
 * Fail closed: an offline/disabled/busy answer ends with `offline` and the
 * reply stays text only. There is no cloud fallback here.
 */
import { StreamPlayer } from "./playback";
import { loadWorklets } from "./worklets";
import { base64ToBytes } from "./pcm";
import { splitSentences } from "./sentences";
import {
  speakSentence as defaultSpeakSentence,
  stopSpeaking as defaultStopSpeaking,
  isUnavailable,
  type SpeakEvent,
  type VoiceUnavailable,
} from "./localVoiceApi";
import { voiceBusControl } from "./voiceBus";

export const KOKORO_RATE = 24000;

export type SpeakOutcome =
  | { kind: "completed"; totalMs: number }
  | { kind: "stopped"; heardMs: number }
  | { kind: "offline"; unavailable: VoiceUnavailable }
  | { kind: "error"; message: string }
  | { kind: "empty" };

export function pcmFromBase64(b64: string): Int16Array {
  const bytes = base64ToBytes(b64);
  const out = new Int16Array(Math.floor(bytes.length / 2));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  for (let i = 0; i < out.length; i++) out[i] = view.getInt16(i * 2, true);
  return out;
}

function newUtteranceId() {
  const r = globalThis.crypto?.randomUUID?.().replace(/-/g, "").slice(0, 16) || Math.random().toString(36).slice(2, 18);
  return `u_${r}`;
}

interface PlayerLike {
  analyser: AnalyserNode | null;
  beginItem(): void;
  push(pcm: Int16Array): void;
  flush(): void;
  playedMsForItem(): number;
  waitForDrain(timeoutMs?: number): Promise<void>;
  close(): void;
}

export interface LocalSpeakerDeps {
  createContext?: () => AudioContext;
  createPlayer?: (ctx: AudioContext) => Promise<PlayerLike>;
  speakSentence?: typeof defaultSpeakSentence;
  stopSpeaking?: typeof defaultStopSpeaking;
}

export class LocalSpeaker {
  private ctx: AudioContext | null = null;
  private player: PlayerLike | null = null;
  private abort: AbortController | null = null;
  private current: { characterId: string; utteranceId: string; streamId: string | null; stopped: boolean } | null = null;
  private deps: Required<LocalSpeakerDeps>;

  constructor(deps: LocalSpeakerDeps = {}) {
    this.deps = {
      createContext: deps.createContext ?? (() => new AudioContext({ latencyHint: "interactive" })),
      createPlayer:
        deps.createPlayer ??
        (async (ctx) => {
          await loadWorklets(ctx);
          return new StreamPlayer(ctx, KOKORO_RATE, { analyser: true });
        }),
      speakSentence: deps.speakSentence ?? defaultSpeakSentence,
      stopSpeaking: deps.stopSpeaking ?? defaultStopSpeaking,
    };
  }

  get speaking(): boolean {
    return Boolean(this.current && !this.current.stopped);
  }

  /** Playback clock for the current utterance (ms heard). */
  clockMs(): number {
    return this.player ? this.player.playedMsForItem() : 0;
  }

  private async ensurePlayer(): Promise<PlayerLike> {
    if (!this.ctx) this.ctx = this.deps.createContext();
    if (this.ctx.state === "suspended") await this.ctx.resume().catch(() => {});
    if (!this.player) this.player = await this.deps.createPlayer(this.ctx);
    return this.player;
  }

  async speak(characterId: string, text: string): Promise<SpeakOutcome> {
    const sentences = splitSentences(text);
    if (sentences.length === 0) return { kind: "empty" };
    if (this.current) this.stop("user_stop");
    const player = await this.ensurePlayer();
    const utteranceId = newUtteranceId();
    const cur = { characterId, utteranceId, streamId: null as string | null, stopped: false };
    this.current = cur;
    const abort = new AbortController();
    this.abort = abort;
    player.beginItem();
    voiceBusControl.start(characterId, utteranceId, () => player.playedMsForItem(), player.analyser);

    let offset = 0;
    let errorMessage = "";
    for (let i = 0; i < sentences.length; i++) {
      if (cur.stopped) break;
      let sentenceDoneMs: number | null = null;
      const onEvent = (e: SpeakEvent) => {
        if (cur.stopped) return;
        switch (e.type) {
          case "meta":
            cur.streamId = e.streamId;
            break;
          case "visemes":
            voiceBusControl.visemes(utteranceId, Array.isArray(e.cues) ? e.cues : []);
            break;
          case "word":
            voiceBusControl.word(utteranceId, e.word, e.startMs, e.endMs);
            break;
          case "audio":
            if (typeof e.pcm === "string" && e.pcm) player.push(pcmFromBase64(e.pcm));
            break;
          case "error":
            errorMessage = e.error || e.code || "voice error";
            break;
          case "done":
            if (typeof e.totalMs === "number") sentenceDoneMs = e.totalMs;
            break;
          default:
            break;
        }
      };
      const res = await this.deps.speakSentence(
        characterId,
        { utteranceId, sentenceIndex: i, sentenceOffsetMs: offset, text: sentences[i] },
        onEvent,
        { signal: abort.signal },
      );
      if (cur.stopped) break;
      if (isUnavailable(res)) {
        player.flush();
        this.finish(cur, "offline");
        return { kind: "offline", unavailable: res };
      }
      if (errorMessage) {
        player.flush();
        this.finish(cur, "error");
        return { kind: "error", message: errorMessage };
      }
      offset = sentenceDoneMs ?? offset;
    }
    if (cur.stopped) return { kind: "stopped", heardMs: player.playedMsForItem() };
    await player.waitForDrain(Math.max(8000, offset + 4000));
    if (cur.stopped) return { kind: "stopped", heardMs: player.playedMsForItem() };
    this.finish(cur, "completed");
    return { kind: "completed", totalMs: offset };
  }

  /**
   * Cut playback now. Order (docs/voice-local.md §6): flush local audio and
   * tell 3D Visual (synchronously), then POST stop and abort the fetch.
   */
  stop(reason: "barge_in" | "user_stop" | "navigation" = "user_stop"): number {
    const cur = this.current;
    if (!cur || cur.stopped) return 0;
    const heardMs = this.player ? this.player.playedMsForItem() : 0;
    cur.stopped = true;
    this.player?.flush();
    voiceBusControl.stop(cur.utteranceId, heardMs, reason);
    if (cur.streamId) {
      void this.deps.stopSpeaking(cur.characterId, cur.streamId, { utteranceId: cur.utteranceId, heardMs, reason });
    }
    this.abort?.abort();
    this.finish(cur, "stopped");
    return heardMs;
  }

  private finish(cur: { utteranceId: string }, reason: "completed" | "stopped" | "error" | "offline") {
    voiceBusControl.end(cur.utteranceId, reason);
    if (this.current === cur) {
      this.current = null;
      this.abort = null;
    }
  }

  async dispose() {
    this.stop("navigation");
    this.player?.close();
    this.player = null;
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
