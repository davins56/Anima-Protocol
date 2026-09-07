import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isCloudTtsConfigured, resetCloudTtsProbe, useSacredSpaceVoice } from "./useSacredSpaceVoice";

const speakToAnima = vi.fn();
const speakNaturally = vi.fn();

vi.mock("@/components/voice/speakToAnima", () => ({
  speakToAnima: (...args) => speakToAnima(...args),
}));

vi.mock("@/lib/naturalSpeech", () => ({
  speakNaturally: (...args) => speakNaturally(...args),
}));

vi.mock("@/lib/apiOrigin", () => ({
  apiUrl: (path) => `https://app.test/api${path}`,
}));

vi.mock("@/api/authBridge", () => ({
  authHeaders: async () => ({ Authorization: "Bearer test" }),
}));

describe("isCloudTtsConfigured", () => {
  beforeEach(() => {
    resetCloudTtsProbe();
  });

  it("returns true only when the existing TTS secret is configured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true }),
    });
    await expect(isCloudTtsConfigured(fetchImpl)).resolves.toBe(true);
    await expect(isCloudTtsConfigured(fetchImpl)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a missing or failing probe as unconfigured", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    });
    await expect(isCloudTtsConfigured(fetchImpl)).resolves.toBe(false);
  });
});

describe("useSacredSpaceVoice", () => {
  beforeEach(() => {
    resetCloudTtsProbe();
    speakToAnima.mockReset();
    speakNaturally.mockReset();
    speakNaturally.mockReturnValue({ cancel: vi.fn(), chunks: ["Hello."], voice: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: false }),
    }));
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: { cancel: vi.fn(), speak: vi.fn(), getVoices: () => [] },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("speaks on the natural Web Speech path when cloud TTS is not configured", async () => {
    const { result } = renderHook(() =>
      useSacredSpaceVoice({ companion: { name: "Serenity", id: "s1" } }),
    );

    await act(async () => {
      await result.current.speak("Welcome. Breathe with me.");
    });

    expect(speakToAnima).not.toHaveBeenCalled();
    expect(speakNaturally).toHaveBeenCalledWith(
      "Welcome. Breathe with me.",
      expect.objectContaining({
        companion: { name: "Serenity", id: "s1" },
      }),
    );
  });

  it("prefers ElevenLabs when /api/tts is configured and falls back if it fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ configured: true }),
    }));
    speakToAnima.mockRejectedValue(new Error("TTS failed: 503"));

    const { result } = renderHook(() =>
      useSacredSpaceVoice({ companion: { id: "c1", elevenlabs_voice_id: "voice_1" } }),
    );

    await act(async () => {
      await result.current.speak("You are safe here.");
    });

    expect(speakToAnima).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "You are safe here.",
        voiceId: "voice_1",
        emotion: "tender",
        intensity: 3,
      }),
    );
    expect(speakNaturally).toHaveBeenCalled();
  });

  it("does not speak when the operator has muted Sacred Space", async () => {
    const { result } = renderHook(() => useSacredSpaceVoice());

    act(() => {
      result.current.toggle();
    });

    await act(async () => {
      await result.current.speak("Stay.");
    });

    expect(speakNaturally).not.toHaveBeenCalled();
    expect(speakToAnima).not.toHaveBeenCalled();
  });
});
