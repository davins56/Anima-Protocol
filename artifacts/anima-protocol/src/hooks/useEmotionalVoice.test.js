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
});
