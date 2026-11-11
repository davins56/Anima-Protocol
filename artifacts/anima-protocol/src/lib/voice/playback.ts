/** Streamed PCM16 playback through the anima-player worklet, with barge-in flush. */
import { pcm16ToFloat, resampleLinear } from "./pcm";

export class StreamPlayer {
  private node: AudioWorkletNode;
  /** Frames played (at ctx rate) since the current assistant item started. */
  private playedAtItemStart = 0;
  private played = 0;
  playing = false;
  onFirstAudible?: () => void;
  onDrained?: () => void;
  private drainWaiters: Array<() => void> = [];
  private awaitingFirst = false;

  constructor(
    private ctx: AudioContext,
    private sourceRate: number,
  ) {
    this.node = new AudioWorkletNode(ctx, "anima-player", { outputChannelCount: [1] });
    this.node.connect(ctx.destination);
    this.node.port.onmessage = (e) => {
      const m = e.data as { type: string; played: number };
      this.played = m.played;
      if (m.type === "playing") {
        this.playing = true;
        if (this.awaitingFirst) {
          this.awaitingFirst = false;
          this.onFirstAudible?.();
        }
      } else if (m.type === "drained" || m.type === "flushed") {
        this.playing = false;
        this.onDrained?.();
        this.drainWaiters.splice(0).forEach((f) => f());
      }
    };
  }

  /** Call when a new assistant audio item begins. */
  beginItem() {
    this.playedAtItemStart = this.played;
    this.awaitingFirst = true;
  }

  push(pcm: Int16Array) {
    const f = resampleLinear(pcm16ToFloat(pcm), this.sourceRate, this.ctx.sampleRate);
    this.node.port.postMessage({ type: "push", samples: f }, [f.buffer]);
  }

  /** Milliseconds of the current item the user actually heard. */
  playedMsForItem(): number {
    return Math.max(0, Math.round(((this.played - this.playedAtItemStart) / this.ctx.sampleRate) * 1000));
  }

  flush() {
    this.node.port.postMessage({ type: "flush" });
  }

  waitForDrain(timeoutMs = 8000): Promise<void> {
    if (!this.playing) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, timeoutMs);
      this.drainWaiters.push(() => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  close() {
    this.node.disconnect();
  }
}
