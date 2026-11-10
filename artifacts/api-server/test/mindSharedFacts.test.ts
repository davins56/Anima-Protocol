import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.fn();
const appended: Array<Record<string, unknown>> = [];

vi.mock("@workspace/db", () => ({ getPool: () => ({ query }) }));
vi.mock("../src/lib/memoryCore/memoryCore", () => ({
  appendMemoryEvent: vi.fn(async (event: Record<string, unknown>) => {
    appended.push(event);
    return `evt-${appended.length}`;
  }),
}));

const { loadUserFacts, storeUserFacts } = await import("../src/lib/mind/userFacts");

beforeEach(() => {
  query.mockReset();
  appended.length = 0;
});

describe("chat mind shared user facts", () => {
  it("loads the user's shared facts plus this companion's private ones, always keyed by user", async () => {
    query.mockResolvedValue({
      rows: [
        { id: "a", content: "Sam has a beagle named Biscuit.", payload: { kind: "user_fact", scope: "user" }, emotional_weight: 0.8, occurred_at: "2026-11-01T00:00:00Z" },
        { id: "b", content: "Sam is working through grief.", payload: { kind: "user_fact", scope: "companion" }, emotional_weight: 0.9, occurred_at: "2026-11-02T00:00:00Z" },
      ],
    });
    const facts = await loadUserFacts("user-1", "ava", 10);
    const [sql, params] = query.mock.calls[0]!;
    expect(sql).toMatch(/WHERE e\.user_id = \$1/);
    expect(sql).toMatch(/COALESCE\(e\.payload ->> 'scope', 'user'\) = 'user' OR e\.character_id = \$2/);
    // Retractions are matched within the same user only.
    expect(sql).toMatch(/r\.user_id = e\.user_id/);
    expect(params).toEqual(["user-1", "ava", "user_fact", 10]);
    expect(facts.map((f) => [f.id, f.scope])).toEqual([
      ["a", "user"],
      ["b", "companion"],
    ]);
  });

  it("stores shared facts with a per-user key and records which companion learned it", async () => {
    await storeUserFacts({
      userId: "user-1",
      characterId: "ava",
      sessionId: "s1",
      facts: [{ fact: "Sam plays cello.", category: "preference", importance: 0.6 }],
      known: [],
    });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({
      userId: "user-1",
      characterId: "ava",
      eventType: "note",
      payload: { kind: "user_fact", scope: "user", learned_from_character_id: "ava" },
    });
    expect(String(appended[0]!.dedupeKey)).toMatch(/^fact:user:/);
  });

  it("a private turn adds a private fact but never retracts a shared one", async () => {
    await storeUserFacts({
      userId: "user-1",
      characterId: "ava",
      sessionId: "s1",
      scope: "companion",
      facts: [{ fact: "Sam moved to Vancouver.", category: "identity", importance: 0.7, replaces: "Sam lives in Toronto." }],
      known: [{ id: "shared-1", fact: "Sam lives in Toronto.", category: "identity", importance: 0.7, scope: "user" }],
    });
    expect(appended).toHaveLength(1);
    expect(appended[0]).toMatchObject({ payload: { scope: "companion" } });
    expect(String(appended[0]!.dedupeKey)).toMatch(/^fact:ava:/);
  });

  it("a shared update supersedes the old shared fact with a retraction", async () => {
    await storeUserFacts({
      userId: "user-1",
      characterId: "kai",
      sessionId: "s2",
      facts: [{ fact: "Sam moved to Vancouver.", category: "identity", importance: 0.7, replaces: "Sam lives in Toronto." }],
      known: [{ id: "shared-1", fact: "Sam lives in Toronto.", category: "identity", importance: 0.7, scope: "user" }],
    });
    expect(appended.map((e) => e.eventType)).toEqual(["note", "retraction"]);
    expect(appended[1]).toMatchObject({ userId: "user-1", payload: { target_event_id: "shared-1" } });
  });
});
