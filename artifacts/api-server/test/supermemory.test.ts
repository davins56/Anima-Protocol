import { afterEach, describe, expect, it } from "vitest";
import {
  companionContainerTag,
  isSupermemoryEnabled,
  mergeRemoteFactsIntoMemories,
  searchCompanionFactsFromSupermemory,
  writeCompanionFactsToSupermemory,
} from "../src/lib/supermemory";

const SAVED = { ...process.env };

afterEach(() => {
  process.env = { ...SAVED };
});

describe("supermemory companion dual-write", () => {
  it("is off without SUPERMEMORY_API_KEY", () => {
    delete process.env.SUPERMEMORY_API_KEY;
    delete process.env.ANIMA_SUPERMEMORY_ENABLED;
    expect(isSupermemoryEnabled()).toBe(false);
  });

  it("can be disabled even when a key is present", () => {
    process.env.SUPERMEMORY_API_KEY = "sm_test";
    process.env.ANIMA_SUPERMEMORY_ENABLED = "false";
    expect(isSupermemoryEnabled()).toBe(false);
  });

  it("builds a containerTag that matches supermemory's charset", () => {
    const tag = companionContainerTag("user_abc:123", "char/lyra!");
    expect(tag).toMatch(/^[a-zA-Z0-9_:-]+$/);
    expect(tag.length).toBeLessThanOrEqual(100);
    expect(tag.startsWith("anima-")).toBe(true);
  });

  it("POSTs /v4/memories with Bearer auth and containerTag", async () => {
    process.env.SUPERMEMORY_API_KEY = "sm_test_key";
    delete process.env.ANIMA_SUPERMEMORY_ENABLED;
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = (async (url, init) => {
      calls.push({ url: String(url), init: init || {} });
      return new Response(JSON.stringify({ documentId: "doc_1" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const written = await writeCompanionFactsToSupermemory({
      userId: "user_1",
      characterId: "char_lyra",
      facts: [{ text: "User prefers chamomile tea at night", category: "preference" }],
      fetchImpl,
    });
    expect(written).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://api.supermemory.ai/v4/memories");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sm_test_key");
    const body = JSON.parse(String(calls[0]!.init.body));
    expect(body.containerTag).toBe(companionContainerTag("user_1", "char_lyra"));
    expect(body.memories[0].content).toMatch(/chamomile/);
    expect(body.memories[0].metadata.source).toBe("anima-character-memory");
  });

  it("returns 0 and skips the network when disabled", async () => {
    delete process.env.SUPERMEMORY_API_KEY;
    let called = 0;
    const fetchImpl = (async () => {
      called += 1;
      return new Response("no", { status: 500 });
    }) as typeof fetch;
    const written = await writeCompanionFactsToSupermemory({
      userId: "user_1",
      characterId: "char_lyra",
      facts: [{ text: "should not send" }],
      fetchImpl,
    });
    expect(written).toBe(0);
    expect(called).toBe(0);
  });

  it("parses /v4/search hits and merges without duplicating local facts", async () => {
    process.env.SUPERMEMORY_API_KEY = "sm_test_key";
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          results: [
            { memory: "User prefers chamomile tea at night", score: 0.91 },
            { content: "User's brother is named Eli", score: 0.8 },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      )) as typeof fetch;

    const hits = await searchCompanionFactsFromSupermemory({
      userId: "user_1",
      characterId: "char_lyra",
      query: "tea tonight",
      fetchImpl,
    });
    expect(hits.map((h) => h.text)).toEqual([
      "User prefers chamomile tea at night",
      "User's brother is named Eli",
    ]);

    const merged = mergeRemoteFactsIntoMemories(
      [
        {
          characterId: "char_lyra",
          facts: [{ text: "User prefers chamomile tea at night" }],
        },
      ],
      hits,
      "char_lyra",
    );
    expect(merged[0]!.facts).toHaveLength(2);
    expect(String((merged[0]!.facts![1] as { text: string }).text)).toMatch(/Eli/);
  });

  it("swallows a down supermemory host", async () => {
    process.env.SUPERMEMORY_API_KEY = "sm_test_key";
    const fetchImpl = (async () => {
      throw new Error("network down");
    }) as typeof fetch;
    await expect(
      writeCompanionFactsToSupermemory({
        userId: "user_1",
        characterId: "char_lyra",
        facts: [{ text: "anything" }],
        fetchImpl,
      }),
    ).resolves.toBe(0);
  });
});
