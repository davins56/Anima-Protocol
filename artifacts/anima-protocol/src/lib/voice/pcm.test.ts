import { describe, expect, it } from "vitest";
import { base64ToBytes, bytesToBase64, floatToPcm16, pcm16ToFloat, resampleLinear } from "./pcm";

describe("pcm helpers", () => {
  it("round-trips float ↔ pcm16 ↔ base64", () => {
    const f = new Float32Array([0, 0.5, -0.5, 1, -1]);
    const p = floatToPcm16(f);
    const back = pcm16ToFloat(new Int16Array(base64ToBytes(bytesToBase64(new Uint8Array(p.buffer))).buffer));
    back.forEach((v, i) => expect(v).toBeCloseTo(f[i], 3));
  });
  it("resamples 48k → 24k by half", () => {
    expect(resampleLinear(new Float32Array(4800), 48000, 24000).length).toBe(2400);
  });
});
