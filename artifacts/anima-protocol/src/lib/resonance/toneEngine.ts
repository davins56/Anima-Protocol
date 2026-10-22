/**
 * Optional WebAudio carrier tones (off by default; created only on a user gesture).
 * One oscillator pitch-mapped from the tuner, gain from the strongest signal,
 * plus band-limited noise that rises with hostile/noise interference.
 */
export class ToneEngine {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private noiseGain: GainNode | null = null;

  start() {
    if (this.ctx) return;
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctx();
    const master = ctx.createGain();
    master.gain.value = 0.15;
    master.connect(ctx.destination);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const gain = ctx.createGain();
    gain.gain.value = 0;
    osc.connect(gain).connect(master);
    osc.start();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1800;
    const noiseGain = ctx.createGain();
    noiseGain.gain.value = 0;
    noise.connect(bp).connect(noiseGain).connect(master);
    noise.start();
    Object.assign(this, { ctx, osc, gain, noiseGain });
  }

  update(tuned: number, strength: number, interference: number) {
    if (!this.ctx || !this.osc || !this.gain || !this.noiseGain) return;
    const t = this.ctx.currentTime;
    this.osc.frequency.setTargetAtTime(110 * Math.pow(2, tuned / 25), t, 0.05);
    this.gain.gain.setTargetAtTime(Math.min(1, strength) * 0.8, t, 0.08);
    this.noiseGain.gain.setTargetAtTime(Math.min(1, 0.05 + interference * 0.6), t, 0.08);
  }

  stop() {
    void this.ctx?.close();
    this.ctx = this.osc = this.gain = this.noiseGain = null;
  }
}
