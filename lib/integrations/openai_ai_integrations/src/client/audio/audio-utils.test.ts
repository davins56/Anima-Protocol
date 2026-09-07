import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodePCM16ToFloat32, createAudioPlaybackContext } from "./audio-utils";

function pcm16ToBase64(samples: number[]): string {
  const pcm16 = new Int16Array(samples);
  const bytes = new Uint8Array(pcm16.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

describe("audio-utils", () => {
  describe("decodePCM16ToFloat32", () => {
    it("returns an empty Float32Array when given an empty base64 string", () => {
      const result = decodePCM16ToFloat32("");
      expect(result).toBeInstanceOf(Float32Array);
      expect(result.length).toBe(0);
    });

    it("correctly decodes a single zero sample", () => {
      const base64 = pcm16ToBase64([0]);
      const result = decodePCM16ToFloat32(base64);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(0);
    });

    it("correctly decodes maximum positive 16-bit signed integer (32767)", () => {
      const base64 = pcm16ToBase64([32767]);
      const result = decodePCM16ToFloat32(base64);
      expect(result.length).toBe(1);
      expect(result[0]).toBeCloseTo(32767 / 32768, 5);
    });

    it("correctly decodes minimum negative 16-bit signed integer (-32768)", () => {
      const base64 = pcm16ToBase64([-32768]);
      const result = decodePCM16ToFloat32(base64);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(-1.0);
    });

    it("correctly decodes positive and negative mid-range samples", () => {
      const base64 = pcm16ToBase64([16384, -16384]);
      const result = decodePCM16ToFloat32(base64);
      expect(result.length).toBe(2);
      expect(result[0]).toBeCloseTo(0.5, 5);
      expect(result[1]).toBeCloseTo(-0.5, 5);
    });

    it("correctly decodes multiple PCM16 samples in sequence", () => {
      const base64 = pcm16ToBase64([0, 16384, -32768, 32767]);
      const result = decodePCM16ToFloat32(base64);
      expect(result.length).toBe(4);
      expect(result[0]).toBe(0);
      expect(result[1]).toBeCloseTo(0.5, 5);
      expect(result[2]).toBe(-1.0);
      expect(result[3]).toBeCloseTo(32767 / 32768, 5);
    });

    it("handles odd byte counts gracefully without throwing RangeError", () => {
      // 1 byte: [0x01] -> base64 "AQ=="
      const base64SingleByte = "AQ==";
      const resultSingle = decodePCM16ToFloat32(base64SingleByte);
      expect(resultSingle.length).toBe(0);

      // 3 bytes: 1 complete sample [0x00, 0x40] + 1 extra byte [0x01]
      const base64ThreeBytes = btoa(String.fromCharCode(0x00, 0x40, 0x01));
      const resultThree = decodePCM16ToFloat32(base64ThreeBytes);
      expect(resultThree.length).toBe(1);
      expect(resultThree[0]).toBeCloseTo(0.5, 5);
    });

    it("throws an error when provided with an invalid base64 string", () => {
      expect(() => decodePCM16ToFloat32("!!!invalid-base64!!!")).toThrow();
    });
  });

  describe("createAudioPlaybackContext", () => {
    let mockAddModule: ReturnType<typeof vi.fn>;
    let mockConnect: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      mockAddModule = vi.fn().mockResolvedValue(undefined);
      mockConnect = vi.fn();

      class MockAudioContext {
        sampleRate: number;
        destination = {};
        audioWorklet = {
          addModule: mockAddModule,
        };

        constructor(options?: { sampleRate?: number }) {
          this.sampleRate = options?.sampleRate ?? 44100;
        }
      }

      class MockAudioWorkletNode {
        connect = mockConnect;
        constructor(public context: any, public name: string) {}
      }

      vi.stubGlobal("AudioContext", MockAudioContext);
      vi.stubGlobal("AudioWorkletNode", MockAudioWorkletNode);
    });

    it("initializes AudioContext and AudioWorkletNode with default options", async () => {
      const res = await createAudioPlaybackContext();
      expect(res.ctx.sampleRate).toBe(24000);
      expect(mockAddModule).toHaveBeenCalledWith("/audio-playback-worklet.js");
      expect(mockConnect).toHaveBeenCalledWith(res.ctx.destination);
    });

    it("initializes AudioContext with custom workletPath and sampleRate", async () => {
      const res = await createAudioPlaybackContext("/custom-worklet.js", 48000);
      expect(res.ctx.sampleRate).toBe(48000);
      expect(mockAddModule).toHaveBeenCalledWith("/custom-worklet.js");
      expect(mockConnect).toHaveBeenCalledWith(res.ctx.destination);
    });
  });
});
