/**
 * End-of-speech → first-audio latency. Marks:
 *   speech_stopped (server VAD)  → first response.output_audio.delta (network)
 *                                → first audible frame (worklet "playing")
 */
export type LatencySample = { toFirstByte: number; toFirstAudible: number | null; at: number };

export class LatencyTracker {
  private eos: number | null = null;
  private firstByte: number | null = null;
  samples: LatencySample[] = [];
  onSample?: (s: LatencySample, stats: LatencyStats) => void;

  markEndOfSpeech(t = performance.now()) {
    this.eos = t;
    this.firstByte = null;
  }
  markFirstByte(t = performance.now()) {
    if (this.eos == null || this.firstByte != null) return;
    this.firstByte = t;
  }
  markFirstAudible(t = performance.now()) {
    if (this.eos == null || this.firstByte == null) return;
    const s = { toFirstByte: this.firstByte - this.eos, toFirstAudible: t - this.eos, at: Date.now() };
    this.eos = null;
    this.samples = [...this.samples.slice(-49), s];
    this.onSample?.(s, this.stats());
  }
  stats(): LatencyStats {
    return latencyStats(this.samples);
  }
}

export type LatencyStats = { count: number; p50: number | null; p95: number | null; last: number | null };

export function latencyStats(samples: LatencySample[]): LatencyStats {
  const xs = samples.map((s) => s.toFirstAudible ?? s.toFirstByte).sort((a, b) => a - b);
  const q = (p: number) => (xs.length ? Math.round(xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1) + 0.5))]) : null);
  return { count: xs.length, p50: q(0.5), p95: q(0.95), last: samples.length ? Math.round(samples[samples.length - 1].toFirstAudible ?? samples[samples.length - 1].toFirstByte) : null };
}
