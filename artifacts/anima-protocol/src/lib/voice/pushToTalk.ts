/**
 * V6 push-to-talk: record 16 kHz mono PCM16 while held, capped at 60 s.
 * Audio stays in memory and goes only to /api/voice/:id/transcribe (the
 * home box). No Web Speech or other cloud STT.
 */
import { MicCapture } from "./micCapture";
import { loadWorklets } from "./worklets";
import { TRANSCRIBE_MAX_SECONDS, TRANSCRIBE_RATE } from "./localVoiceApi";

export function joinPcm(chunks: Int16Array[], maxSamples = TRANSCRIBE_RATE * TRANSCRIBE_MAX_SECONDS): Int16Array {
  let len = 0;
  for (const c of chunks) len += c.length;
  const out = new Int16Array(Math.min(len, maxSamples));
  let o = 0;
  for (const c of chunks) {
    if (o >= out.length) break;
    const n = Math.min(c.length, out.length - o);
    out.set(c.subarray(0, n), o);
    o += n;
  }
  return out;
}

export class PushToTalk {
  private ctx: AudioContext | null = null;
  private mic: MicCapture | null = null;
  private chunks: Int16Array[] = [];
  private samples = 0;
  private capTimer: ReturnType<typeof setTimeout> | null = null;
  recording = false;
  /** Called when the 60 s cap stops the recording by itself. */
  onCap?: () => void;

  async start() {
    if (this.recording) return;
    this.chunks = [];
    this.samples = 0;
    this.ctx = new AudioContext({ latencyHint: "interactive" });
    await loadWorklets(this.ctx);
    this.mic = new MicCapture(this.ctx, TRANSCRIBE_RATE, (pcm) => {
      if (this.samples >= TRANSCRIBE_RATE * TRANSCRIBE_MAX_SECONDS) return;
      this.chunks.push(pcm);
      this.samples += pcm.length;
    });
    await this.mic.start();
    this.recording = true;
    this.capTimer = setTimeout(() => this.onCap?.(), TRANSCRIBE_MAX_SECONDS * 1000);
  }

  /** Stop and return what was recorded. */
  async stop(): Promise<Int16Array> {
    const pcm = joinPcm(this.chunks);
    await this.teardown();
    return pcm;
  }

  async cancel() {
    await this.teardown();
  }

  level(): number {
    return this.mic?.level ?? 0;
  }

  private async teardown() {
    if (this.capTimer) clearTimeout(this.capTimer);
    this.capTimer = null;
    this.recording = false;
    this.mic?.stop();
    this.mic = null;
    this.chunks = [];
    this.samples = 0;
    await this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
