import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/authBridge", () => ({ authHeaders: async () => ({ "Content-Type": "application/json" }) }));

import {
  buildVoiceAgentVariables,
  fetchVoiceAgentSignedUrl,
  isVoiceAgentAvailable,
  resetVoiceAgentAvailability,
} from "./voiceAgentSession";

function jsonResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe("isVoiceAgentAvailable", () => {
  beforeEach(() => resetVoiceAgentAvailability());

  it("reads the server status once and caches it", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ configured: true }));
    expect(await isVoiceAgentAvailable(fetchImpl)).toBe(true);
    expect(await isVoiceAgentAvailable(fetchImpl)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0][0])).toContain("/voice-agent/status");
  });

  it("treats network failures as unavailable", async () => {
    expect(await isVoiceAgentAvailable(async () => { throw new Error("offline"); })).toBe(false);
  });
});

describe("fetchVoiceAgentSignedUrl", () => {
  it("returns the signed URL from the server", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ signedUrl: "wss://example.test/s" }));
    await expect(fetchVoiceAgentSignedUrl(fetchImpl)).resolves.toBe("wss://example.test/s");
    expect(fetchImpl.mock.calls[0][1].method).toBe("POST");
  });

  it("throws the server error when the session cannot start", async () => {
    const fetchImpl = async () => jsonResponse({ error: "ElevenLabs API key not configured." }, false, 503);
    await expect(fetchVoiceAgentSignedUrl(fetchImpl)).rejects.toThrow("not configured");
  });
});

describe("buildVoiceAgentVariables", () => {
  it("passes the companion and ritual focus into the agent prompt", () => {
    expect(
      buildVoiceAgentVariables(
        { name: "Korra", universe: "Avatar", personality: "Bold  and\nwarm", speaking_style: "Direct" },
        "strength",
      ),
    ).toEqual({
      companion_name: "Korra",
      companion_universe: "from Avatar",
      companion_personality: "Bold and warm",
      companion_speaking_style: "Direct",
      ritual_focus: "strength",
    });
  });

  it("falls back to gentle defaults", () => {
    const vars = buildVoiceAgentVariables(null, null);
    expect(vars.companion_name).toBe("Serenity");
    expect(vars.companion_universe).toBe("");
    expect(vars.ritual_focus).toBe("awakening");
  });
});
