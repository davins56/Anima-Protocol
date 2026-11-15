import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/apiOrigin", () => ({ apiUrl: (p: string) => `https://api.test/api${p}` }));
vi.mock("@/api/authBridge", () => ({ authHeaders: async () => ({ Authorization: "Bearer t" }) }));

import { fetchRecallLedger, recallLedgerPath, RecallLedgerError, RecallLedgerPageSchema } from "./useRecallLedger";

// Verbatim example from docs/recall-ledger.md.
const example = {
  character_id: "char_aeland_01",
  batches: [
    {
      batch_id: "eyJ2IjoxLCJ0IjoiMjAyNi0xMS0xMFQyMjoxNDowMy4xMjM0NTZaIiwicyI6InNlc3NfOWYyIn0",
      recalled_at: "2026-11-10T22:14:03.123456Z",
      session_id: "sess_9f2",
      turn_id: null,
      recalls: [
        {
          recall_id: "6c1e4c2a-6f0e-4f53-9d3f-0b8f0c1d2e3f",
          rank: 1,
          score: 0.7132,
          similarity: 0.8211,
          recency: 0.12,
          emotional_weight: 0.9,
          memory_age_s: 19353600,
          memory: {
            event_id: "0d4b1a7e-2c4f-4b8e-9a51-3f7e2d9c8b10",
            event_type: "turn",
            content_preview: "User: I finally called my dad back.\nMe: I'm proud of you. You said it felt like carrying a stone.",
            occurred_at: "2026-04-01T10:00:00.000000Z",
            conversation_id: "sess_41a",
            source_turn_id: "turn_41a_0007",
            corrupted: false,
          },
        },
      ],
      withheld: { retracted: 1, unattributable: 0 },
    },
  ],
  next_cursor: "eyJ2IjoxLCJ0IjoiMjAyNi0xMS0xMFQyMjoxNDowMy4xMjM0NTZaIiwicyI6InNlc3NfOWYyIn0",
  meta: { limit: 10, max_limit: 25, turn_linkage: "none", grouping: "session_id+recalled_at" },
};

afterEach(() => vi.unstubAllGlobals());

describe("recall ledger client", () => {
  it("builds the path with a clamped limit, cursor and session", () => {
    expect(recallLedgerPath("a/b", { limit: 500, cursor: "c1", sessionId: "s 1" })).toBe(
      "/memory-core/a%2Fb/recalls?limit=25&cursor=c1&session_id=s+1",
    );
    expect(recallLedgerPath("x")).toBe("/memory-core/x/recalls");
  });

  it("parses the documented example", async () => {
    expect(RecallLedgerPageSchema.safeParse(example).success).toBe(true);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(example), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const page = await fetchRecallLedger("char_aeland_01", { limit: 10 });
    expect(page.batches[0].recalls[0].memory.source_turn_id).toBe("turn_41a_0007");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/api/memory-core/char_aeland_01/recalls?limit=10");
    expect(init.cache).toBe("no-store");
  });

  it("maps 404 to companion_not_found and a bad body to invalid_response", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Companion not found", code: "companion_not_found" }), { status: 404 })));
    await expect(fetchRecallLedger("x")).rejects.toMatchObject({ code: "companion_not_found", status: 404 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ batches: "nope" }), { status: 200 })));
    const err = await fetchRecallLedger("x").catch((e) => e);
    expect(err).toBeInstanceOf(RecallLedgerError);
    expect(err.code).toBe("invalid_response");
  });
});

  it("accepts turn_linkage partial and full without depending on the unapproved migration", () => {
    expect(RecallLedgerPageSchema.safeParse({ ...example, meta: { ...example.meta, turn_linkage: "partial" } }).success).toBe(true);
    expect(RecallLedgerPageSchema.safeParse({ ...example, meta: { ...example.meta, turn_linkage: "full" } }).success).toBe(true);
    expect(RecallLedgerPageSchema.safeParse({ ...example, batches: [{ ...example.batches[0], turn_id: "turn_later" }] }).success).toBe(true);
  });
