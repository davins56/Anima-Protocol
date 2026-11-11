import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: async (extra = {}) => ({ Authorization: "Bearer test", ...extra }),
}));

import {
  chooseSpeechRoute,
  chooseStoryRoute,
  cloudOptInForClip,
  DEFAULT_VOICE_PREFS,
  getVoicePrefs,
  normalizeVoicePrefs,
  setVoicePrefs,
  subscribeVoicePrefs,
  VOICE_PREFS_KEY,
} from "./voicePrefs";
import { fetchMediaCapabilities, requestVoiceClip, resetMediaCapabilitiesForTests } from "./chatVoiceClips";

afterEach(() => {
  localStorage.clear();
  resetMediaCapabilitiesForTests();
});

const ALL_TOGGLES_ON = { isNative: true, emotionalEnabled: true, elevenEnabled: true, webEnabled: true };

describe("voicePrefs: every cloud/device voice is off by default", () => {
  it("defaults to all false and only a literal true opts in", () => {
    expect(getVoicePrefs()).toEqual({ elevenlabs: false, xai: false, webSpeech: false, nativeSpeech: false });
    expect(normalizeVoicePrefs({ elevenlabs: "true", xai: 1, webSpeech: true })).toEqual({
      ...DEFAULT_VOICE_PREFS,
      webSpeech: true,
    });
    localStorage.setItem(VOICE_PREFS_KEY, "{not json");
    expect(getVoicePrefs()).toEqual(DEFAULT_VOICE_PREFS);
  });

  it("persists and notifies", () => {
    const seen = [];
    const off = subscribeVoicePrefs((p) => seen.push(p));
    setVoicePrefs({ nativeSpeech: true });
    off();
    setVoicePrefs({ xai: true });
    expect(getVoicePrefs()).toMatchObject({ nativeSpeech: true, xai: true });
    expect(seen).toHaveLength(1);
    expect(seen[0].nativeSpeech).toBe(true);
  });
});

describe("chat auto-speak cascade (V5)", () => {
  it("no engine speaks by default even with every in-chat toggle on and inside the iOS shell", () => {
    expect(chooseSpeechRoute({ prefs: getVoicePrefs(), ...ALL_TOGGLES_ON })).toBeNull();
    expect(chooseStoryRoute({ prefs: getVoicePrefs(), voiceId: "v1", elevenEnabled: true, webEnabled: true })).toBeNull();
  });

  it("native iOS speech only when opted in, and only inside the app shell", () => {
    const prefs = { nativeSpeech: true };
    expect(chooseSpeechRoute({ prefs, ...ALL_TOGGLES_ON })).toBe("native");
    expect(chooseSpeechRoute({ prefs, ...ALL_TOGGLES_ON, isNative: false })).toBeNull();
  });

  it("ElevenLabs needs the opt-in AND its toggle; no fall-through to Web Speech without its own opt-in", () => {
    expect(chooseSpeechRoute({ prefs: { elevenlabs: true }, ...ALL_TOGGLES_ON })).toBe("emotional");
    expect(chooseSpeechRoute({ prefs: { elevenlabs: true }, elevenEnabled: true, webEnabled: true })).toBe("elevenlabs");
    expect(chooseSpeechRoute({ prefs: { elevenlabs: true }, webEnabled: true })).toBeNull();
  });

  it("Web Speech needs its opt-in AND its toggle", () => {
    expect(chooseSpeechRoute({ prefs: { webSpeech: true }, webEnabled: true })).toBe("webSpeech");
    expect(chooseSpeechRoute({ prefs: { webSpeech: true }, webEnabled: false })).toBeNull();
    expect(chooseStoryRoute({ prefs: { webSpeech: true }, webEnabled: true })).toBe("webSpeech");
    expect(chooseStoryRoute({ prefs: { elevenlabs: true }, voiceId: null, elevenEnabled: true })).toBeNull();
  });

  it("voice-note cloud opt-in: xAI before ElevenLabs, none by default", () => {
    expect(cloudOptInForClip(getVoicePrefs())).toBeNull();
    expect(cloudOptInForClip({ elevenlabs: true })).toBe("elevenlabs");
    expect(cloudOptInForClip({ elevenlabs: true, xai: true })).toBe("xai");
  });
});

describe("voice-note requests carry the opt-in", () => {
  const okFetch = (body) =>
    vi.fn(async () => ({ ok: true, json: async () => body }));

  it("sends no cloud_opt_in by default", async () => {
    const fetchImpl = okFetch({ url: "/x" });
    await requestVoiceClip({ characterId: "c1", text: "hi", fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ characterId: "c1", text: "hi" });
  });

  it("sends cloud_opt_in once the steward opts in", async () => {
    setVoicePrefs({ elevenlabs: true });
    const fetchImpl = okFetch({ url: "/x" });
    await requestVoiceClip({ characterId: "c1", text: "hi", fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({ characterId: "c1", text: "hi", cloud_opt_in: "elevenlabs" });
  });

  it("voice notes are offered when the box can speak, or a cloud key matches an opt-in", async () => {
    const body = { voice_clip: false, voice_clip_cloud: { xai: true, elevenlabs: false } };
    const fetchImpl = okFetch(body);
    expect(await fetchMediaCapabilities({ fetchImpl })).toEqual({ voice_clip: false });
    setVoicePrefs({ elevenlabs: true });
    expect(await fetchMediaCapabilities({ fetchImpl })).toEqual({ voice_clip: false });
    setVoicePrefs({ xai: true });
    expect(await fetchMediaCapabilities({ fetchImpl })).toEqual({ voice_clip: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    resetMediaCapabilitiesForTests();
    expect(await fetchMediaCapabilities({ fetchImpl: okFetch({ voice_clip: true }), prefs: DEFAULT_VOICE_PREFS })).toEqual({ voice_clip: true });
  });
});
