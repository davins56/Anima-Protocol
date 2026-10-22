import { describe, it, expect, vi } from "vitest";

vi.mock("@/api/authBridge", () => ({ authHeaders: async () => ({ Authorization: "Bearer t" }) }));

import { buildPhotoAlbum, pickResurfacing, resurfacingAllowed } from "./belonging";
import { getTimelineEvents, markJournalRead } from "./relationshipApi";

describe("belonging helpers", () => {
  it("resurfacing is opt-out", () => {
    expect(resurfacingAllowed({})).toBe(true);
    expect(resurfacingAllowed({ belonging: { allow_memory_resurfacing: false } })).toBe(false);
  });
  it("picks unread entries and the latest chapter/milestone", () => {
    const r = pickResurfacing({
      entries: [{ id: "a", isRead: false }, { id: "b", isRead: true }, { id: "c" }, { id: "d" }, { id: "e" }],
      events: [{ id: "x", eventType: "event" }, { id: "y", eventType: "chapter", title: "Ch 2" }],
    });
    expect(r.unread.map((e) => e.id)).toEqual(["a", "c", "d"]);
    expect(r.latest.id).toBe("y");
  });
  it("groups photos under the milestone they followed, newest first", () => {
    const events = [
      { id: "m1", eventType: "first", title: "First hello", occurredAt: "2026-10-01T00:00:00Z" },
      { id: "e1", eventType: "event", title: "ignored", occurredAt: "2026-10-05T00:00:00Z" },
      { id: "m2", eventType: "milestone", title: "Trust", occurredAt: "2026-10-10T00:00:00Z" },
    ];
    const photos = [
      { id: "p0", created_at: "2026-09-20T00:00:00Z" },
      { id: "p1", created_at: "2026-10-02T00:00:00Z" },
      { id: "p2", created_at: "2026-10-11T00:00:00Z" },
      { id: "p3", created_at: "2026-10-12T00:00:00Z" },
    ];
    const album = buildPhotoAlbum(photos, events);
    expect(album.map((s) => s.title)).toEqual(["Trust", "First hello", "Early days"]);
    expect(album[0].photos.map((p) => p.id)).toEqual(["p3", "p2"]);
    expect(album[2].photos.map((p) => p.id)).toEqual(["p0"]);
  });
});

describe("relationshipApi port", () => {
  it("uses the real /relationship-os mount with the bearer", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ events: [{ id: "1" }] }) }));
    await expect(getTimelineEvents("an 1", { limit: 5 }, fetchImpl)).resolves.toEqual([{ id: "1" }]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toMatch(/\/relationship-os\/timeline\/an%201\?limit=5$/);
    expect(init.headers.Authorization).toBe("Bearer t");
    await markJournalRead("a", "j", fetchImpl);
    expect(fetchImpl.mock.calls[1][1].method).toBe("POST");
  });
});
