import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useEmotionalVoice } from "./useEmotionalVoice";

const speakToAnima = vi.fn();

vi.mock("@/components/voice/speakToAnima", () => ({
  speakToAnima: (...args) => speakToAnima(...args),
}));

describe("useEmotionalVoice", () => {
  beforeEach(() => {
    speakToAnima.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("clears loading when TTS fails so replay does not hang", async () => {
    speakToAnima.mockRejectedValue(new Error("TTS failed: 503"));
    const { result } = renderHook(() => useEmotionalVoice());

    await act(async () => {
      await result.current.speakWithEmotion("hello", "voice_1", "char_1");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPlaying).toBe(false);
    expect(result.current.error).toMatch(/TTS failed/);
  });

  it("plays returned audio and marks playback complete on ended", async () => {
    speakToAnima.mockResolvedValue({ audioUrl: "blob:tts" });
    const listeners = {};
    class FakeAudio {
      constructor() {
        this.src = "";
      }
      addEventListener() {}
      play() {
        return Promise.resolve();
      }
      pause() {}
      set onended(fn) {
        listeners.ended = fn;
      }
      set onerror(fn) {
        listeners.error = fn;
      }
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: vi.fn() });

    const { result } = renderHook(() => useEmotionalVoice());
    await act(async () => {
      await result.current.speakWithEmotion("hello", null, "anima-1");
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isPlaying).toBe(true);

    act(() => {
      listeners.ended?.();
    });
    expect(result.current.isPlaying).toBe(false);
  });

  it("unlocks the audio element inside the tap, before the TTS request resolves", async () => {
    let resolveTts;
    speakToAnima.mockImplementation(() => new Promise((r) => { resolveTts = r; }));
    const created = [];
    class FakeAudio {
      constructor() {
        this.src = "";
        this.plays = [];
        created.push(this);
      }
      play() {
        this.plays.push(this.src);
        return Promise.resolve();
      }
      pause() {}
    }
    vi.stubGlobal("Audio", FakeAudio);
    vi.stubGlobal("URL", { ...URL, revokeObjectURL: vi.fn() });

    const { result } = renderHook(() => useEmotionalVoice());
    let pending;
    act(() => {
      pending = result.current.speakWithEmotion("hello", null, "anima-1");
    });
    // Synchronous part of the tap: one element, already played (silent unlock).
    expect(created).toHaveLength(1);
    expect(created[0].plays[0]).toMatch(/^data:audio\/wav/);

    await act(async () => {
      resolveTts({ audioUrl: "blob:tts" });
      await pending;
    });
    // The same unlocked element plays the real clip.
    expect(created).toHaveLength(1);
    expect(created[0].plays[1]).toBe("blob:tts");
    expect(result.current.isPlaying).toBe(true);
  });

  it("reads the line with the device voice when the server voice fails", async () => {
    speakToAnima.mockRejectedValue(new Error("TTS failed: ElevenLabs API key not configured."));
    const spoken = [];
    const synth = {
      speak: vi.fn((u) => spoken.push(u)),
      cancel: vi.fn(),
    };
    class FakeUtterance {
      constructor(text) {
        this.text = text;
      }
    }
    vi.stubGlobal("speechSynthesis", synth);
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    const { result } = renderHook(() => useEmotionalVoice());
    await act(async () => {
      await result.current.speakWithEmotion("*smiles* Hello [beat] there", null, "anima-1");
    });

    // First utterance is the empty in-tap unlock; the last is the real line.
    expect(spoken[0].text).toBe("");
    const last = spoken[spoken.length - 1];
    expect(last.text).toBe("Hello there");
    expect(result.current.isPlaying).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.isLoading).toBe(false);

    act(() => {
      last.onend?.();
    });
    expect(result.current.isPlaying).toBe(false);
  });
});
