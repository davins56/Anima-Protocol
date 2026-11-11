import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/api/authBridge", () => ({ authHeaders: async () => ({}) }));
vi.mock("@/lib/apiOrigin", () => ({ apiUrl: (path: string) => `/api${path}` }));
import {
  WHAT_DID_YOU_DREAM_PROMPT,
  consumeComposePrefill,
  dreamJournalChatPath,
  dreamJournalListPath,
  dreamJournalPagePath,
  DreamJournalError,
  DreamJournalPageSchema,
  fetchDreamJournal,
  formatDreamDate,
  isDreamingPresence,
  isDreamJournalUnavailable,
  markDreamsReadLocally,
  moodTag,
  readDreamIds,
  unreadDreamsFromContinuity,
} from "./dreamJournal";

describe("dream journal helpers", () => {
  it("builds journal and compose paths without auto-send flags", () => {
    expect(dreamJournalPagePath("c1", "Aeland")).toBe("/dreams/c1?name=Aeland");
    expect(dreamJournalListPath("c1", { limit: 20, cursor: "abc" })).toBe("/dreams/c1?limit=20&cursor=abc");
    const path = dreamJournalChatPath({ sessionId: "s1", characterId: "c1" });
    expect(path.startsWith("/chat/s1?")).toBe(true);
    const params = new URLSearchParams(path.split("?")[1]);
    expect(params.get("compose")).toBe(WHAT_DID_YOU_DREAM_PROMPT);
    expect(params.get("character")).toBe("c1");
    expect(path).not.toMatch(/send=|auto=/);
  });

  it("takes the compose prefill out of the search string and leaves other params", () => {
    const taken = consumeComposePrefill(`?compose=${encodeURIComponent("What did you dream?")}&character=c1&voice=1`);
    expect(taken).toEqual({
      text: "What did you dream?",
      characterId: "c1",
      nextSearch: "?character=c1&voice=1",
    });
    expect(consumeComposePrefill("?voice=1")).toBeNull();
    expect(consumeComposePrefill("?compose=%20")).toBeNull();
  });

  it("treats only presence === dreaming as isDreaming", () => {
    expect(isDreamingPresence("dreaming")).toBe(true);
    expect(isDreamingPresence("drifting")).toBe(false);
    expect(isDreamingPresence(null)).toBe(false);
  });

  it("formats dates and mood tags", () => {
    const now = Date.parse("2026-11-10T18:00:00.000Z");
    expect(formatDreamDate("2026-11-10T17:10:00.000Z", now)).toBe("50m ago");
    expect(formatDreamDate("2026-11-10T12:00:00.000Z", now)).toBe("6h ago");
    expect(formatDreamDate("2026-11-01T18:00:00.000Z", now)).toBe("Nov 1, 2026");
    expect(moodTag("  wistful  ")).toBe("wistful");
    expect(moodTag("")).toBeNull();
    expect(moodTag(null)).toBeNull();
  });

  it("tracks locally read dreams for the unread hint", () => {
    const mem = (() => {
      const m = new Map<string, string>();
      return { getItem: (k: string) => (m.has(k) ? m.get(k)! : null), setItem: (k: string, v: string) => m.set(k, v) };
    })();
    expect(readDreamIds("c1", mem)).toEqual([]);
    markDreamsReadLocally("c1", ["d1", "d2"], mem);
    markDreamsReadLocally("c1", ["d2", "d3"], mem);
    expect(readDreamIds("c1", mem)).toEqual(["d1", "d2", "d3"]);
    expect(readDreamIds("c2", mem)).toEqual([]);
    const unread = unreadDreamsFromContinuity(
      [
        { id: "d1", fragment: "old" },
        { id: "d4", fragment: "new" },
        { fragment: "no id" },
      ],
      readDreamIds("c1", mem),
    );
    expect(unread.map((d) => d.id)).toEqual(["d4"]);
  });
});

describe("dream journal client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("parses a valid page and sorts callers can rely on newest-first shape", () => {
    const page = DreamJournalPageSchema.parse({
      character_id: "c1",
      dreaming_enabled: true,
      unread_count: 1,
      is_dreaming: true,
      dreams: [
        {
          id: "d1",
          created_at: "2026-11-10T12:00:00.000Z",
          mood: "dreamy",
          themes: ["lantern"],
          summary: "A hall of glass.",
          fragment: "I kept a lantern.",
          read: false,
        },
      ],
      next_cursor: null,
    });
    expect(page.dreams[0].fragment).toBe("I kept a lantern.");
  });

  it("maps a bare 404 to unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => "text/html" },
        text: async () => "<html>not found</html>",
        json: async () => null,
      }),
    );
    try {
      await fetchDreamJournal("c1");
      throw new Error("expected failure");
    } catch (err) {
      expect(err).toBeInstanceOf(DreamJournalError);
      expect((err as DreamJournalError).code).toBe("unavailable");
      expect(isDreamJournalUnavailable(err)).toBe(true);
    }
  });

  it("maps companion_not_found and schema-missing codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        headers: { get: () => "application/json" },
        json: async () => ({ error: "Companion not found", code: "companion_not_found" }),
        text: async () => "",
      }),
    );
    await expect(fetchDreamJournal("missing")).rejects.toMatchObject({ code: "companion_not_found", status: 404 });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        headers: { get: () => "application/json" },
        json: async () => ({ error: "Dream journal is not set up yet.", code: "dream_schema_missing" }),
        text: async () => "",
      }),
    );
    const err = await fetchDreamJournal("c1").catch((e) => e);
    expect(err.code).toBe("dream_schema_missing");
    expect(isDreamJournalUnavailable(err)).toBe(true);
  });
});
