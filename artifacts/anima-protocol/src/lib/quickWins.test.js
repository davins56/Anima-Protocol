import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/analytics", () => ({ track: vi.fn() }));
vi.mock("@/api/authBridge", () => ({ authHeaders: async () => ({ Authorization: "Bearer t" }) }));

import { track } from "@/lib/analytics";
import { explainCompanionAffect } from "@/lib/companionAffect";
import { exploreModules, PRIMARY_TABS } from "@/lib/mobileNav";
import { trackFirstReplyReceived, trackOnboardingCompleted } from "@/lib/funnelEvents";
import { PAID_OFFERS, joinWaitlist, waitlistedOffers } from "@/lib/plans";
import { synthesizeCloneTest } from "@/lib/voiceCloneTts";

function memStore() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

beforeEach(() => vi.mocked(track).mockClear());

describe("explainCompanionAffect", () => {
  const snap = {
    primary: "joy",
    mood: "warm",
    intensity: 80,
    intent: "comfort",
    focus: "steward",
    energy: 70,
    synchro_strength: 62,
    updated_at: "2026-10-22T10:00:00Z",
  };
  it("builds plain reasons from the snapshot", () => {
    const lines = explainCompanionAffect(snap, "Aeland", Date.parse("2026-10-22T10:05:00Z"));
    expect(lines[0]).toBe('Aeland feels strongly joy — "warm".');
    expect(lines).toContain("Right now she wants to comfort you.");
    expect(lines).toContain("Her energy is high (70/100).");
    expect(lines.some((l) => l.includes("62%"))).toBe(true);
    expect(lines.at(-1)).toBe("This shifted 5 min ago.");
  });
  it("returns nothing without a snapshot", () => {
    expect(explainCompanionAffect(null)).toEqual([]);
  });
});

describe("exploreModules", () => {
  const modules = [
    { path: "/chat" },
    { path: "/worlds" },
    { path: "/codespace" },
    { path: "/repo-codespace" },
    { path: "/", signOut: true },
  ];
  it("puts the five primary tabs first and hides them from Explore", () => {
    expect(PRIMARY_TABS.map((t) => t.label)).toEqual(["Chat", "Companions", "Memories", "Home", "Settings"]);
    expect(exploreModules(modules).map((m) => m.path)).toEqual(["/worlds", "/"]);
  });
  it("shows Codespace entries only to the steward", () => {
    expect(exploreModules(modules, { isSteward: true }).map((m) => m.path)).toContain("/repo-codespace");
  });
});

describe("funnel events", () => {
  it("tracks onboarding_completed without PII", () => {
    trackOnboardingCompleted({ voiceTone: "soft", hasAesthetic: true });
    expect(track).toHaveBeenCalledWith("onboarding_completed", { voice_tone: "soft", has_aesthetic: true, is_saved: true });
  });
  it("tracks first_reply_received once per device", () => {
    const store = memStore();
    expect(trackFirstReplyReceived({ isAnima: true, firstWordMs: 812.4 }, store)).toBe(true);
    expect(trackFirstReplyReceived({ isAnima: true }, store)).toBe(false);
    expect(track).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith("first_reply_received", { session_mode: "solo", is_anima: true, first_word_ms: 812 });
  });
});

describe("plans waitlist", () => {
  it("keeps text chat free and records waitlist intent", () => {
    expect(PAID_OFFERS.map((o) => o.id)).toEqual(["photo_credits", "voice_minutes", "deep_mode"]);
    const store = memStore();
    joinWaitlist("deep_mode", store);
    joinWaitlist("deep_mode", store);
    expect(waitlistedOffers(store)).toEqual(["deep_mode"]);
  });
});

describe("voice clone TTS", () => {
  it("calls the server proxy, never ElevenLabs with a client key", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, blob: async () => new Blob(["x"]) }));
    await synthesizeCloneTest("voice-1", fetchImpl);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/\/tts$/);
    expect(String(url)).not.toContain("elevenlabs.io");
    expect(JSON.stringify(init.headers)).not.toContain("xi-api-key");
    expect(JSON.parse(init.body).voice_id).toBe("voice-1");
  });
  it("reports not configured on 503", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 503 }));
    await expect(synthesizeCloneTest("v", fetchImpl)).rejects.toThrow(/not configured/);
  });
});
