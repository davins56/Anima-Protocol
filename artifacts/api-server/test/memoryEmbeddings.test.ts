import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, ensureSchemaOnce, memoryEmbeddings } from "@workspace/db";
import {
  attachStoredEmbeddings,
  factIdFor,
  searchMemoriesSemantically,
  upsertMemoryEmbeddings,
} from "../src/lib/memoryEmbeddings";

const PREFIX = `mememb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;

beforeAll(async () => {
  // Disposable test schema only clones user_entities/user_profiles; create the
  // rest (including memory_embeddings) the same way production self-heals.
  await ensureSchemaOnce();
});

afterEach(async () => {
  await db
    .delete(memoryEmbeddings)
    .where(eq(memoryEmbeddings.userId, `${PREFIX}user`));
});

describe("memoryEmbeddings write + search", () => {
  it("upserts turn facts and returns them via semantic search", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}char`;
    const text =
      "User: I love rainy nights in Neo-Kyoto | Companion: Then we watch the neon melt together.";

    const written = await upsertMemoryEmbeddings({
      userId,
      characterId,
      facts: [
        {
          type: "turn",
          session_id: `${PREFIX}session`,
          text,
          created_at: new Date().toISOString(),
        },
      ],
    });
    expect(written).toBe(1);

    const rows = await db
      .select()
      .from(memoryEmbeddings)
      .where(
        and(
          eq(memoryEmbeddings.userId, userId),
          eq(memoryEmbeddings.characterId, characterId),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.factId).toBe(factIdFor(text));
    expect(Array.isArray(rows[0]!.embedding)).toBe(true);
    expect(rows[0]!.embedding.length).toBeGreaterThan(0);

    const enriched = await attachStoredEmbeddings(userId, [
      {
        characterId,
        facts: [{ type: "turn", text }],
      },
    ]);
    const fact = enriched[0]!.facts?.[0] as { embedding?: number[] };
    expect(Array.isArray(fact.embedding)).toBe(true);
    expect(fact.embedding!.length).toBeGreaterThan(0);

    const hits = await searchMemoriesSemantically({
      userId,
      characterId,
      query: "rainy nights in Neo-Kyoto",
      topK: 5,
    });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.text).toContain("Neo-Kyoto");
  });

  it("updates the same fact_id on re-upsert", async () => {
    const userId = `${PREFIX}user`;
    const characterId = `${PREFIX}char2`;
    const text = "User: remember my callsign is Ash | Companion: Ash it is.";

    await upsertMemoryEmbeddings({
      userId,
      characterId,
      facts: [{ type: "turn", text }],
    });
    await upsertMemoryEmbeddings({
      userId,
      characterId,
      facts: [{ type: "turn", text }],
    });

    const rows = await db
      .select()
      .from(memoryEmbeddings)
      .where(
        and(
          eq(memoryEmbeddings.userId, userId),
          eq(memoryEmbeddings.characterId, characterId),
        ),
      );
    expect(rows).toHaveLength(1);
  });
});
