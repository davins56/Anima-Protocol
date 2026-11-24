import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/api/animaApi", () => ({
  requireChatAuthHeaders: vi.fn(async (extra = {}) => ({ ...extra, Authorization: "Bearer default" })),
}));
import {
  checkHomeModel,
  homeModelNextCheckInMs,
  homeStateFromMind,
  markHomeModelOffline,
  pollDelayMs,
  describePresence,
  homeModelState,
  isHomeOfflineKind,
  resetHomeModelForTests,
  richPresenceEnabled,
} from "./richPresence";

const user = { role: "user", content: "hey" };

describe("richPresence", () => {
  beforeEach(() => resetHomeModelForTests());

  it("is off unless the flag says on", () => {
    expect(richPresenceEnabled({})).toBe(false);
    expect(richPresenceEnabled({ VITE_ANIMA_RICH_PRESENCE: "true" })).toBe(true);
  });

  it("says Online by default", () => {
    expect(describePresence({ messages: [user], name: "Lyra" })).toMatchObject({ kind: "here", label: "Online", tone: "ok" });
  });

  it("reads thinking, waiting, typing and photo from the live rows", () => {
    const think = describePresence({ messages: [user, { role: "assistant", character_name: "__thinking__", content: "..." }], name: "Lyra" });
    expect(think).toMatchObject({ kind: "thinking", label: "Lyra is thinking…" });
    const wait = describePresence({ messages: [user, { role: "assistant", character_name: "__thinking__", content: "Waiting for a free moment" }], name: "Lyra" });
    expect(wait).toMatchObject({ kind: "waiting", detail: "Waiting for a free moment" });
    const typing = describePresence({ messages: [user, { role: "assistant", character_name: "__typing__", content: "..." }], name: "Lyra" });
    expect(typing.kind).toBe("typing");
    const streaming = describePresence({ messages: [user, { role: "assistant", character_name: "Mira", content: "Hel", is_streaming: true }], name: "Someone" });
    expect(streaming).toMatchObject({ kind: "typing", label: "Mira is typing…" });
    const photo = describePresence({ messages: [user, { role: "assistant", character_name: "__typing__", photo_pending: true }], name: "Lyra" });
    expect(photo.kind).toBe("photo");
  });

  it("shows the home model offline state, and resting after a queued message", () => {
    const off = describePresence({ messages: [user], homeModel: "offline", name: "Lyra" });
    expect(off).toMatchObject({ kind: "home_offline", label: "Home mind offline", tone: "warn" });
    expect(isHomeOfflineKind(off.kind)).toBe(true);
    const resting = describePresence({ messages: [user, { role: "system", type: "resting_notice", content: "Lyra is resting" }], homeModel: "online", name: "Lyra" });
    expect(resting.kind).toBe("resting");
    expect(isHomeOfflineKind(resting.kind)).toBe(true);
    // Her queued reply arriving clears it.
    const back = describePresence({
      messages: [user, { role: "system", type: "resting_notice" }, { role: "assistant", character_name: "Lyra", content: "I'm here" }],
      homeModel: "online",
      name: "Lyra",
    });
    expect(back.kind).toBe("here");
  });

  it("puts the user's own connection first and never claims a reply is coming", () => {
    expect(describePresence({ messages: [user], deviceOnline: false, homeModel: "offline" }).kind).toBe("device_offline");
    expect(describePresence({ messages: [user], homeModel: "unreachable" }).kind).toBe("unreachable");
    expect(describePresence({ messages: [user], replying: true, homeModel: "offline", name: "Lyra" }).kind).toBe("thinking");
  });

  const auth = async (extra = {}) => ({ ...extra, Authorization: "Bearer t" });
  const respond = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });

  it("asks GET /api/chat/mind-status with auth and maps home_mind", async () => {
    let seen = null;
    const fetchImpl = async (url, init) => {
      seen = { url: String(url), init };
      return { ok: true, status: 200, json: async () => ({ v: 1, home_mind: "online", retry_after_s: 15, queued: 0 }) };
    };
    expect(await checkHomeModel({ force: true, fetchImpl, authHeaders: auth })).toBe("online");
    expect(seen.url).toContain("/chat/mind-status?fresh=1");
    expect(seen.url).not.toContain("healthz");
    expect(seen.init.headers.Authorization).toBe("Bearer t");
    expect(await checkHomeModel({ force: true, fetchImpl: respond(200, { home_mind: "offline", retry_after_s: 30 }), authHeaders: auth })).toBe("offline");
    expect(await checkHomeModel({ force: true, fetchImpl: respond(200, { home_mind: "not_used", retry_after_s: 300 }), authHeaders: auth })).toBe("online");
    expect(await checkHomeModel({ force: true, fetchImpl: respond(200, { home_mind: "unknown", retry_after_s: 5 }), authHeaders: auth })).toBe("unknown");
  });

  it("maps 401, 409 mind_status_disabled and other errors to unknown, a network error to unreachable", async () => {
    expect(await checkHomeModel({ force: true, fetchImpl: respond(401, { error: "unauthorized" }), authHeaders: auth })).toBe("unknown");
    expect(await checkHomeModel({ force: true, fetchImpl: respond(409, { error: "mind_status_disabled" }), authHeaders: auth })).toBe("unknown");
    expect(await checkHomeModel({ force: true, fetchImpl: respond(500, null), authHeaders: auth })).toBe("unknown");
    const down = async () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await checkHomeModel({ force: true, fetchImpl: down, authHeaders: auth })).toBe("unreachable");
    const signedOut = async () => {
      throw new Error("auth required");
    };
    let called = false;
    const spy = async () => {
      called = true;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    expect(await checkHomeModel({ force: true, fetchImpl: spy, authHeaders: signedOut })).toBe("unknown");
    expect(called).toBe(false);
  });

  it("polls at clamp(retry_after_s, 15, 60)", async () => {
    expect(pollDelayMs(5)).toBe(15_000);
    expect(pollDelayMs(30)).toBe(30_000);
    expect(pollDelayMs(300)).toBe(60_000);
    expect(pollDelayMs(undefined)).toBe(60_000);
    const t0 = Date.now();
    await checkHomeModel({ force: true, fetchImpl: respond(200, { home_mind: "online", retry_after_s: 300 }), authHeaders: auth });
    const wait = homeModelNextCheckInMs(t0);
    expect(wait).toBeGreaterThan(55_000);
    expect(wait).toBeLessThanOrEqual(61_000);
  });

  it("honours 429 retry_after and keeps the last state", async () => {
    await checkHomeModel({ force: true, fetchImpl: respond(200, { home_mind: "offline", retry_after_s: 20 }), authHeaders: auth });
    const t0 = Date.now();
    expect(await checkHomeModel({ force: true, fetchImpl: respond(429, { error: "rate_limited", retry_after: 90 }), authHeaders: auth })).toBe("offline");
    expect(homeModelNextCheckInMs(t0)).toBeGreaterThan(85_000);
    let calls = 0;
    const counting = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ home_mind: "online" }) };
    };
    expect(await checkHomeModel({ fetchImpl: counting, authHeaders: auth })).toBe("offline");
    expect(calls).toBe(0);
  });

  it("caches until the next poll is due unless forced", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({ home_mind: "online", retry_after_s: 15 }) };
    };
    await checkHomeModel({ fetchImpl, authHeaders: auth });
    await checkHomeModel({ fetchImpl, authHeaders: auth });
    expect(calls).toBe(1);
    await checkHomeModel({ fetchImpl, authHeaders: auth, force: true });
    expect(calls).toBe(2);
  });

  it("goes offline at once on an SSE resting:true, and the strip shows", () => {
    expect(homeModelState()).toBe("unknown");
    markHomeModelOffline();
    expect(homeModelState()).toBe("offline");
    expect(isHomeOfflineKind(describePresence({ messages: [user], homeModel: homeModelState() }).kind)).toBe(true);
  });

  it("maps home_mind values", () => {
    expect(homeStateFromMind("online")).toBe("online");
    expect(homeStateFromMind("not_used")).toBe("online");
    expect(homeStateFromMind("offline")).toBe("offline");
    expect(homeStateFromMind("unknown")).toBe("unknown");
    expect(homeStateFromMind(undefined)).toBe("unknown");
  });
});
