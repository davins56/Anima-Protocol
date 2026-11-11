/**
 * Procedural Web Audio for the cyberworld — no audio assets. A low detuned
 * synth pad through a slowly swept lowpass, a faint filtered-noise "data
 * hum", sparse random data chirps, plus one-shot SFX (footstep ticks,
 * proximity chime, UI blip, portal sweep). The AudioContext is only created
 * from a user gesture (autoplay policy), and muting suspends it entirely.
 */

export const MUTE_STORAGE_KEY = "anima.cyberworld.muted";

/** Stored "1"/"0" wins; with no stored choice, start muted when the user prefers reduced motion. */
export function initialMuted(stored: string | null | undefined, prefersReducedMotion: boolean): boolean {
  if (stored === "1") return true;
  if (stored === "0") return false;
  return prefersReducedMotion;
}

export function readInitialMuted(): boolean {
  let stored: string | null = null;
  try {
    stored = window.localStorage.getItem(MUTE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  return initialMuted(stored, reduced);
}

export function writeMuted(muted: boolean): void {
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    /* private mode / storage disabled: preference just won't persist */
  }
}

/** Seconds between footstep ticks for a given ground speed (units/s); stride ≈ 1.9 units. */
export function footstepInterval(speed: number): number {
  if (!(speed > 0.5)) return Infinity;
  return Math.max(0.18, 1.9 / speed);
}

type Ctx = AudioContext;

export class CyberworldAudio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private chirpTimer: ReturnType<typeof setTimeout> | null = null;
  private muted: boolean;

  constructor(muted: boolean) {
    this.muted = muted;
  }

  get isMuted() {
    return this.muted;
  }

  /** Call from a user gesture. Builds the graph once; no-op while muted. */
  unlock() {
    if (this.muted) return;
    if (!this.ctx) this.build();
    if (this.ctx?.state === "suspended") void this.ctx.resume();
    this.scheduleChirp();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) {
      if (this.chirpTimer) clearTimeout(this.chirpTimer);
      this.chirpTimer = null;
      const ctx = this.ctx;
      if (ctx && this.master) {
        this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
        setTimeout(() => this.muted && ctx.state === "running" && void ctx.suspend(), 250);
      }
    } else {
      this.unlock();
      if (this.ctx && this.master) this.master.gain.setTargetAtTime(1, this.ctx.currentTime, 0.4);
    }
  }

  dispose() {
    if (this.chirpTimer) clearTimeout(this.chirpTimer);
    this.chirpTimer = null;
    void this.ctx?.close();
    this.ctx = this.master = this.sfxBus = null;
  }

  private build() {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    master.gain.setTargetAtTime(1, ctx.currentTime, 0.8);

    // Pad: A1 / E2 / A2, slightly detuned saws + a triangle, through a swept lowpass.
    const padGain = ctx.createGain();
    padGain.gain.value = 0.045;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 380;
    lp.Q.value = 5;
    lp.connect(padGain).connect(master);
    const voices: Array<[OscillatorType, number, number]> = [
      ["sawtooth", 55, -6],
      ["sawtooth", 82.41, 7],
      ["triangle", 110, 0],
    ];
    for (const [type, f, detune] of voices) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.detune.value = detune;
      o.connect(lp);
      o.start();
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 220;
    lfo.connect(lfoDepth).connect(lp.frequency);
    lfo.start();

    // Data hum: looping noise through a narrow bandpass, barely there.
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1400;
    bp.Q.value = 1.2;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.006;
    noise.connect(bp).connect(humGain).connect(master);
    noise.start();

    const sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.5;
    sfxBus.connect(master);

    Object.assign(this, { ctx, master, sfxBus, noiseBuf: buf });
  }

  private scheduleChirp() {
    if (this.chirpTimer || this.muted) return;
    this.chirpTimer = setTimeout(() => {
      this.chirpTimer = null;
      if (this.muted) return;
      const notes = [880, 1174.7, 1318.5, 1760];
      const base = notes[Math.floor(Math.random() * notes.length)];
      this.tone(base, 0.06, 0.012, "sine");
      if (Math.random() < 0.5) setTimeout(() => this.tone(base * 1.5, 0.05, 0.008, "sine"), 90);
      this.scheduleChirp();
    }, 2500 + Math.random() * 4500);
  }

  private tone(freq: number, dur: number, gain: number, type: OscillatorType = "square", endFreq?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || this.muted || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private noiseBurst(dur: number, gain: number, freq: number, endFreq?: number) {
    const ctx = this.ctx;
    if (!ctx || !this.sfxBus || !this.noiseBuf || this.muted || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 2;
    f.frequency.setValueAtTime(freq, t);
    if (endFreq) f.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  /** Soft digital footstep tick. */
  step() {
    this.noiseBurst(0.05, 0.05, 2600 + Math.random() * 600);
  }

  /** Two-note rising chime when an Anima comes into range. */
  near() {
    this.tone(659.25, 0.18, 0.03, "triangle");
    setTimeout(() => this.tone(987.77, 0.24, 0.03, "triangle"), 90);
  }

  /** Short UI confirm blip. */
  blip() {
    this.tone(1320, 0.05, 0.02, "square");
  }

  /** Sonar ping for Scan. */
  scan() {
    this.tone(520, 0.5, 0.035, "sine", 1560);
    setTimeout(() => this.tone(1560, 0.25, 0.015, "sine"), 220);
  }

  /** Arpeggio when hacking a node open; brighter for rarer finds (0–4). */
  collect(tier = 0) {
    const base = [523.25, 587.33, 659.25, 783.99, 880][Math.max(0, Math.min(4, tier))];
    [1, 1.25, 1.5, 2].slice(0, 2 + Math.min(2, tier)).forEach((m, i) => setTimeout(() => this.tone(base * m, 0.12, 0.025, "square"), i * 60));
  }

  /** Rising sweep + whoosh when jumping through a portal. */
  portal() {
    this.tone(180, 0.6, 0.04, "sawtooth", 1400);
    this.noiseBurst(0.7, 0.08, 300, 4000);
  }
}
