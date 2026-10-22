/**
 * AudioWorklet processors, loaded from Blob URLs (no extra build config).
 *  - anima-mic: posts Float32 frames from the mic at the context rate.
 *  - anima-player: plays queued Float32 PCM; reports played frames so barge-in
 *    can send an accurate `audio_end_ms` with conversation.item.truncate.
 */
const MIC = `
class AnimaMic extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor("anima-mic", AnimaMic);
`;

const PLAYER = `
class AnimaPlayer extends AudioWorkletProcessor {
  constructor() {
    super();
    this.queue = []; this.offset = 0; this.played = 0; this.idle = true;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m.type === "push") { this.queue.push(m.samples); }
      else if (m.type === "flush") { this.queue = []; this.offset = 0; this.port.postMessage({ type: "flushed", played: this.played }); }
      else if (m.type === "reset") { this.played = 0; }
    };
  }
  process(_inputs, outputs) {
    const out = outputs[0][0];
    let i = 0;
    while (i < out.length && this.queue.length) {
      const buf = this.queue[0];
      const n = Math.min(out.length - i, buf.length - this.offset);
      out.set(buf.subarray(this.offset, this.offset + n), i);
      i += n; this.offset += n; this.played += n;
      if (this.offset >= buf.length) { this.queue.shift(); this.offset = 0; }
    }
    for (; i < out.length; i++) out[i] = 0;
    const idle = this.queue.length === 0;
    if (idle !== this.idle) { this.idle = idle; this.port.postMessage({ type: idle ? "drained" : "playing", played: this.played }); }
    return true;
  }
}
registerProcessor("anima-player", AnimaPlayer);
`;

const urls = new Map<string, string>();
function urlFor(name: string, src: string) {
  let u = urls.get(name);
  if (!u) {
    u = URL.createObjectURL(new Blob([src], { type: "application/javascript" }));
    urls.set(name, u);
  }
  return u;
}

export async function loadWorklets(ctx: AudioContext) {
  await ctx.audioWorklet.addModule(urlFor("mic", MIC));
  await ctx.audioWorklet.addModule(urlFor("player", PLAYER));
}
