import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { speakToAnima, TTS_TIMEOUT_MS } from "./speakToAnima";

vi.mock("@/lib/apiOrigin", () => ({
  apiUrl: (path) => `https://app.test/api${path}`,
}));

vi.mock("@/api/authBridge", () => ({
  authHeaders: async () => ({ "Content-Type": "application/json", Authorization: "Bearer t" }),
}));

const listCharacters = vi.fn();
const invokeFn = vi.fn();

vi.mock("@/api/base44Client", () => ({
  base44: {
    entities: {
      Character: { list: (...args) => listCharacters(...args) },
    },
    functions: { invoke: (...args) => invokeFn(...args) },
  },
}));

describe("speakToAnima", () => {
  const originalFetch = globalThis.fetch;
  const originalCreateObjectURL = globalThis.URL.createObjectURL;

  beforeEach(() => {
    listCharacters.mockReset();
    invokeFn.mockReset();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:tts-audio");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.URL.createObjectURL = originalCreateObjectURL;
  });

  it("returns empty when there is no speakable text", async () => {
    globalThis.fetch = vi.fn();
    await expect(speakToAnima({ text: "   " })).resolves.toEqual({});
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("posts to /api/tts and never calls ElevenLabs or the LLM dispatcher", async () => {
    globalThis.fetch = vi.fn(async (url) => {
      expect(String(url)).toBe("https://app.test/api/tts");
      expect(String(url)).not.toMatch(/elevenlabs/i);
      return {
        ok: true,
        arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer,
      };
    });

    const result = await speakToAnima({
      text: "Hello there",
      voiceId: "voice_1",
      emotion: "calm",
      intensity: 7,
    });

    expect(result).toEqual({ audioUrl: "blob:tts-audio" });
    expect(invokeFn).not.toHaveBeenCalled();
    expect(listCharacters).not.toHaveBeenCalled();
    const [, init] = globalThis.fetch.mock.calls[0];
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({
      text: "Hello there",
      voice_id: "voice_1",
      emotion: "calm",
      intensity: 7,
    });
    expect(init.signal).toBeDefined();
  });

  it("falls back to the server default voice without hanging on Character.list", async () => {
    listCharacters.mockRejectedValue(new Error("store down"));
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      arrayBuffer: async () => new ArrayBuffer(2),
    }));

    const result = await speakToAnima({
      text: "Missed you",
      characterId: "anima-1",
    });

    expect(result.audioUrl).toBe("blob:tts-audio");
    expect(JSON.parse(globalThis.fetch.mock.calls[0][1].body).voice_id).toBe(null);
  });

  it("rejects so callers can clear loading when TTS fails", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => ({ error: "ElevenLabs API key not configured." }),
    }));

    await expect(speakToAnima({ text: "Hello" })).rejects.toThrow(/TTS failed/);
  });

  it("rejects on abort/timeout instead of hanging", async () => {
    expect(TTS_TIMEOUT_MS).toBeGreaterThan(0);
    globalThis.fetch = vi.fn(async () => {
      const err = new Error("aborted");
      err.name = "AbortError";
      throw err;
    });

    await expect(speakToAnima({ text: "Hello" })).rejects.toThrow(/timed out/);
  });
});
