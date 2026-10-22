/**
 * pgvector integration: applies supabase/migrations/20261022210000_pdf_pipeline.sql
 * into this run's disposable schema and exercises the real SQL repo, the
 * match_pdf_chunks RPC, and hybrid retrieval. Skips when the database has no
 * pgvector (e.g. a plain postgres CI image).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Resolve `vector` / `<=>` from public while tables land in the test schema.
if (process.env.PGOPTIONS && !process.env.PGOPTIONS.includes(",public")) {
  process.env.PGOPTIONS = `${process.env.PGOPTIONS},public`;
}
process.env.ANIMA_PDF_EMBED_PROVIDER = "local";
process.env.ANIMA_LOCAL_LLM_BASE_URL = "https://embedder.test/v1";
process.env.ANIMA_MEMORY_CORE = "off";

const TOPICS = [
  ["dragon", "wyrm", "drake"],
  ["harbor", "port", "dock"],
  ["recipe", "bake", "flour"],
] as const;

/** Toy semantic embedder: one dimension per topic, synonyms share a dimension. */
function topicVector(text: string): number[] {
  const v = new Array(768).fill(0.001);
  const lower = text.toLowerCase();
  TOPICS.forEach((words, i) => {
    if (words.some((w) => lower.includes(w))) v[i] = 1;
  });
  return v;
}

vi.mock("../src/lib/memoryCore/embedder", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/memoryCore/embedder")>();
  const embed = async (texts: string[]) => texts.map((t) => ({ vector: topicVector(t), model: "local:toy" }));
  return {
    ...actual,
    embedMemoryTexts: vi.fn(embed),
    embedQueryCached: vi.fn(async (text: string) => (await embed([text]))[0]),
  };
});

const { getPool } = await import("@workspace/db");
const store = await import("../src/lib/pdf/store");
const { buildTextPdf } = await import("./pdfFixture");

const PREFIX = `pdfvec_${Date.now()}_`;
let available = false;

beforeAll(async () => {
  const pool = getPool();
  const ext = await pool.query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS ok`,
  );
  if (!ext.rows[0]?.ok) return;
  const schema = (await pool.query<{ s: string }>(`SELECT current_schema() AS s`)).rows[0]!.s;
  if (!schema.startsWith("test_run_")) return; // never touch a real schema
  const sql = readFileSync(
    join(__dirname, "../../../supabase/migrations/20261022210000_pdf_pipeline.sql"),
    "utf8",
  ).replace(/\bpublic\./g, `"${schema}".`);
  await pool.query(
    `CREATE TABLE IF NOT EXISTS "${schema}".memory_event_types (type text PRIMARY KEY, description text NOT NULL DEFAULT '')`,
  );
  await pool.query(sql);
  available = true;
});

afterAll(async () => {
  if (!available) return;
  await getPool().query(`DELETE FROM pdf_documents WHERE user_id LIKE $1`, [`${PREFIX}%`]).catch(() => {});
});

async function seed(userId: string, sessionId: string) {
  await getPool().query(
    `INSERT INTO user_entities (user_id, entity_name, entity_id, data) VALUES ($1, 'ChatSession', $2, '{}'::jsonb)`,
    [userId, sessionId],
  );
}

async function upload(userId: string, sessionId: string, pages: string[]) {
  const pending: Promise<unknown>[] = [];
  const doc = await store.createPdfDocument({
    userId,
    scope: "chat",
    sessionId,
    filename: "bestiary.pdf",
    bytes: buildTextPdf(pages),
    contentType: "application/pdf",
    background: (p) => pending.push(p),
  });
  await Promise.all(pending);
  return doc;
}

describe("pgvector PDF recall", () => {
  it("embeds every chunk and recalls by meaning where full-text search misses", async (ctx) => {
    if (!available) ctx.skip();
    const owner = `${PREFIX}owner`;
    const sessionId = `${PREFIX}sess`;
    await seed(owner, sessionId);
    // Short lines (the fixture draws one line per page), enough pages for several chunks.
    const doc = await upload(owner, sessionId, [
      // Bread first, so the keyword path's "first chunk" fallback would be the wrong answer.
      ...Array.from({ length: 20 }, (_, i) => `Fresh flour makes the festival bread ${i}.`),
      ...Array.from({ length: 20 }, (_, i) => `The old dragon guards the ember crown ${i}.`),
    ]);
    expect(doc.status).toBe("embedding"); // response returned before vectors
    const ready = await store.getPdfDocument({ userId: owner, documentId: doc.id });
    expect(ready).toMatchObject({ status: "ready", vectorsPending: false });
    expect(ready!.embeddedChunkCount).toBe(ready!.chunkCount);

    // "wyrm" never appears in the PDF, so full-text alone finds nothing.
    const context = await store.retrievePdfContext({
      userId: owner,
      sessionId,
      characterIds: [],
      query: "what does the wyrm protect",
    });
    expect(ready!.chunkCount).toBeGreaterThan(1);
    expect(context).toContain("ember crown");
    const excerpts = context.split("From bestiary.pdf").slice(1);
    expect(excerpts.length).toBeGreaterThan(0);
    // Only chunks about the dragon clear the similarity floor; the bread-only chunk does not.
    for (const excerpt of excerpts) expect(excerpt).toContain("dragon");
  });

  it("never returns another user's chunks and drops vectors with the document", async (ctx) => {
    if (!available) ctx.skip();
    const owner = `${PREFIX}a`;
    const other = `${PREFIX}b`;
    await seed(owner, `${PREFIX}sa`);
    await seed(other, `${PREFIX}sb`);
    const mine = await upload(owner, `${PREFIX}sa`, ["The harbor master keeps the dock ledger."]);
    await upload(other, `${PREFIX}sb`, ["Secret harbor smuggling routes."]);

    const q = topicVector("port");
    const literal = `[${q.join(",")}]`;
    const rows = await getPool().query<{ user_id: string; content: string }>(
      `SELECT c.user_id, m.content FROM match_pdf_chunks($1, $2::vector, $3, '{}'::text[], 10, 0.1, 'local:toy') m
       JOIN pdf_chunks c ON c.id = m.chunk_id`,
      [owner, literal, `${PREFIX}sb`], // even naming the other user's session
    );
    expect(rows.rows).toHaveLength(0);
    const own = await getPool().query(
      `SELECT * FROM match_pdf_chunks($1, $2::vector, $3, '{}'::text[], 10, 0.1, 'local:toy')`,
      [owner, literal, `${PREFIX}sa`],
    );
    expect(own.rows).toHaveLength(1);
    const otherModel = await getPool().query(
      `SELECT * FROM match_pdf_chunks($1, $2::vector, $3, '{}'::text[], 10, 0.1, 'workersai:bge')`,
      [owner, literal, `${PREFIX}sa`],
    );
    expect(otherModel.rows).toHaveLength(0); // never compare across embedding spaces

    expect(await store.deletePdfDocument({ userId: owner, documentId: mine.id })).toBe(true);
    const left = await getPool().query(
      `SELECT count(*)::int AS n FROM pdf_chunk_embeddings WHERE document_id = $1`,
      [mine.id],
    );
    expect(left.rows[0]!.n).toBe(0);
  });
});
