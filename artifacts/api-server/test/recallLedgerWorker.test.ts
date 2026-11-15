import { beforeEach, describe, expect, it, vi } from "vitest";

const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ getPool: () => ({ query }) }));
import { decodeRecallCursor, listRecallLedger } from "../src/lib/memoryCore/recallLedger";

const t = "2026-11-15T19:34:45.123456Z";
const older = "2026-11-14T19:34:45.123456Z";

beforeEach(() => { query.mockReset(); });

describe("recall ledger Worker scalar bindings", () => {
  it("loads nonempty recall batches without binding JS arrays", async () => {
    const batches = [{ t, session_id: null }, { t, session_id: "session'quoted" }];
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      // Reproduce the Worker constraint: raw arrays are not serialized as PG arrays.
      if (params.some(Array.isArray)) throw new Error("22P02: malformed array literal");
      if (!sql.includes("WITH page")) return { rows: batches };
      expect(sql).toContain("VALUES ($3::timestamptz, $4::text), ($5::timestamptz, $6::text)");
      expect(sql).toContain("e.event_type NOT IN ($7::text, $8::text, $9::text, $10::text)");
      expect(params).toEqual(["owner", "companion", t, null, t, "session'quoted", "recall", "retraction", "memory_corrupted", "memory_restored"]);
      expect(sql).not.toContain("session'quoted");
      expect(sql).toContain("p.session_id IS NOT DISTINCT FROM r.session_id");
      expect(sql).toContain("r.user_id = $1 AND r.character_id = $2");
      expect(sql).toContain("e.user_id = $1");
      expect(sql).toContain("e.character_id = $2");
      return { rows: [{
        t, session_id: "session'quoted", recall_id: "recall-1", score: 0.9,
        similarity: null, recency: 1, event_age_s: 60, event_id: "event-1", ev_id: "event-1",
        event_type: "note", content: "A remembered detail", occurred_at: older,
        conversation_id: null, emotional_weight: 0.5, source_turn_id: null,
        retracted: false, corrupt_severity: null,
      }] };
    });
    const page = await listRecallLedger({ userId: "owner", characterId: "companion" });
    expect(page.batches).toHaveLength(2);
    expect(page.batches[1].recalls[0].memory.content_preview).toBe("A remembered detail");
    expect(page.next_cursor).toBeNull();
  });

  it("keeps pagination and session filters scalar, with microsecond cursors", async () => {
    query.mockResolvedValueOnce({ rows: [{ t, session_id: "session" }, { t: older, session_id: null }] })
      .mockResolvedValueOnce({ rows: [] });
    const page = await listRecallLedger({ userId: "owner", characterId: "companion", limit: 1, sessionId: "session" });
    const cursor = decodeRecallCursor(page.next_cursor!);
    expect(cursor).toEqual({ t, s: "session" });
    query.mockResolvedValueOnce({ rows: [] });
    await listRecallLedger({ userId: "owner", characterId: "companion", limit: 1, sessionId: "session", cursor: page.next_cursor });
    expect(query.mock.calls[2][1]).toEqual(["owner", "companion", "session", t, "session", 2]);
  });

  it("returns an empty ledger without issuing an empty VALUES query", async () => {
    query.mockResolvedValueOnce({ rows: [] });
    const page = await listRecallLedger({ userId: "owner", characterId: "companion" });
    expect(page.batches).toEqual([]);
    expect(query).toHaveBeenCalledTimes(1);
  });
});
