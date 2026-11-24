import { describe, it, expect, beforeEach } from "vitest";
import {
  checkHomeModel,
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

  it("maps /healthz/llm: 200 online, 503 offline, other or network error unreachable", async () => {
    const respond = (status) => async () => ({ ok: status >= 200 && status < 300, status });
    expect(await checkHomeModel({ force: true, fetchImpl: respond(200) })).toBe("online");
    expect(homeModelState()).toBe("online");
    expect(await checkHomeModel({ force: true, fetchImpl: respond(503) })).toBe("offline");
    expect(await checkHomeModel({ force: true, fetchImpl: respond(500) })).toBe("unreachable");
    expect(
      await checkHomeModel({
        force: true,
        fetchImpl: async () => {
          throw new TypeError("Failed to fetch");
        },
      }),
    ).toBe("unreachable");
  });

  it("caches a fresh result unless forced", async () => {
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return { ok: true, status: 200 };
    };
    await checkHomeModel({ fetchImpl });
    await checkHomeModel({ fetchImpl });
    expect(calls).toBe(1);
    await checkHomeModel({ fetchImpl, force: true });
    expect(calls).toBe(2);
  });
});
