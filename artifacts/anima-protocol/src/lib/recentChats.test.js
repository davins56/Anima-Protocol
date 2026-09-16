import { describe, expect, it } from "vitest";
import {
  relativeChatTime,
  sessionCompanion,
  sessionHref,
  sessionPreview,
  sortRecentSessions,
} from "./recentChats";

describe("recentChats helpers", () => {
  it("formats relative times", () => {
    const now = Date.parse("2026-09-16T20:00:00.000Z");
    expect(relativeChatTime("2026-09-16T19:59:30.000Z", now)).toBe("just now");
    expect(relativeChatTime("2026-09-16T19:40:00.000Z", now)).toBe("20m ago");
    expect(relativeChatTime("2026-09-16T17:00:00.000Z", now)).toBe("3h ago");
    expect(relativeChatTime("2026-09-14T20:00:00.000Z", now)).toBe("2d ago");
    expect(relativeChatTime("", now)).toBe("");
  });

  it("prefers last_message metadata over hydrating the transcript", () => {
    expect(
      sessionPreview({
        last_message: "Kept the lantern lit.",
        messages: [{ role: "user", content: "older" }],
      }),
    ).toBe("Kept the lantern lit.");
  });

  it("falls back to the last real message and strips markup", () => {
    expect(
      sessionPreview({
        messages: [
          { role: "user", content: "hi" },
          { role: "assistant", character_name: "__thinking__", content: "..." },
          { role: "assistant", content: "[EMOTION] *hello* world" },
        ],
      }),
    ).toBe("hello world");
  });

  it("resolves solo companion name and avatar from the roster", () => {
    const companion = sessionCompanion(
      { mode: "solo", character_id: "c1", title: "Fallback" },
      [{ id: "c1", name: "Lumen", avatar_url: "/api/storage/lumen.webp" }],
    );
    expect(companion).toEqual({
      name: "Lumen",
      avatarUrl: "/api/storage/lumen.webp",
      isGroup: false,
    });
  });

  it("uses the session title when the roster has no match", () => {
    const companion = sessionCompanion({ title: "Serenity", mode: "solo" });
    expect(companion.name).toBe("Serenity");
    expect(companion.avatarUrl).toBeNull();
  });

  it("labels group sessions from title", () => {
    const companion = sessionCompanion({
      mode: "group",
      title: "Lumen, Korra +1",
      group_character_ids: ["a", "b"],
    });
    expect(companion.name).toBe("Lumen, Korra +1");
    expect(companion.isGroup).toBe(true);
  });

  it("sorts by updated_date and drops rows without ids", () => {
    const rows = sortRecentSessions(
      [
        { id: "old", updated_date: "2026-01-01T00:00:00.000Z" },
        { title: "no id" },
        { id: "new", updated_date: "2026-09-16T00:00:00.000Z" },
      ],
      8,
    );
    expect(rows.map((s) => s.id)).toEqual(["new", "old"]);
  });

  it("builds a resume href only for usable ids", () => {
    expect(sessionHref({ id: "sess-9" })).toBe("/chat/sess-9");
    expect(sessionHref({ id: "undefined" })).toBeNull();
    expect(sessionHref({})).toBeNull();
  });
});
