import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async (extra) => ({ Authorization: "Bearer t", ...extra })),
}));

import { fetchMediaCapabilities, requestVoiceClip, resetMediaCapabilitiesForTests } from "./chatVoiceClips";

// apiUrl() already prefixes "/api". apiUrl("/api/media/...") produced
// /api/api/media/..., which Express answers with 404, so voice notes and the
// server chat-photo capability were silently off. Pin the exact paths.
const pathOf = (url) => new URL(String(url), "http://localhost").pathname;

describe("chatVoiceClips: API paths", () => {
  beforeEach(() => resetMediaCapabilitiesForTests());

  it("GETs /api/media/capabilities", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ voice_clip: true, chat_photos: true }) }));
    expect(await fetchMediaCapabilities({ fetchImpl, prefs: {} })).toEqual({ voice_clip: true, chat_photos: true });
    const url = fetchImpl.mock.calls[0][0];
    expect(pathOf(url)).toBe("/api/media/capabilities");
    expect(String(url)).not.toContain("/api/api/");
  });

  it("POSTs /api/media/voice-clip", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ ok: true }) }));
    await requestVoiceClip({ characterId: "c1", text: "hi", fetchImpl, prefs: {} });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(pathOf(url)).toBe("/api/media/voice-clip");
    expect(String(url)).not.toContain("/api/api/");
    expect(init.method).toBe("POST");
  });
});
