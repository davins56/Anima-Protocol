/**
 * Mic → AudioWorklet → 24 kHz PCM16 chunks (~100 ms), buffered before the
 * socket opens (docs best practice: start mic and WS in parallel).
 */
import { floatToPcm16, resampleLinear } from "./pcm";

export class MicCapture {
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private pending: Float32Array[] = [];
  private pendingLen = 0;
  muted = false;
  /** Rough local energy for UI + local end-of-speech estimate. */
  level = 0;

  constructor(
    private ctx: AudioContext,
    private targetRate: number,
    private onChunk: (pcm: Int16Array) => void,
    private chunkMs = 100,
  ) {}

  async start() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.source = this.ctx.createMediaStreamSource(this.stream);
    this.node = new AudioWorkletNode(this.ctx, "anima-mic");
    this.node.port.onmessage = (e: MessageEvent<Float32Array>) => this.push(e.data);
    this.source.connect(this.node);
  }

  private push(frame: Float32Array) {
    let sum = 0;
    for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
    this.level = Math.sqrt(sum / frame.length);
    if (this.muted) return;
    this.pending.push(frame);
    this.pendingLen += frame.length;
    if (this.pendingLen >= (this.ctx.sampleRate * this.chunkMs) / 1000) {
      const joined = new Float32Array(this.pendingLen);
      let o = 0;
      for (const p of this.pending) {
        joined.set(p, o);
        o += p.length;
      }
      this.pending = [];
      this.pendingLen = 0;
      this.onChunk(floatToPcm16(resampleLinear(joined, this.ctx.sampleRate, this.targetRate)));
    }
  }

  stop() {
    this.node?.disconnect();
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.node = null;
    this.source = null;
    this.stream = null;
  }
}
