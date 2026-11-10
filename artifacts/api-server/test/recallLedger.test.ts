/**
 * "Why she said that" recall ledger: GET /api/memory-core/:characterId/recalls.
 *
 * Runs against the real Postgres test schema (test/setup-db.ts). The memory
 * tables are created here from the migration DDL
 * (supabase/migrations/20261022160000/160100/160200 + 20261022200000 view),
 * with `embedding vector(768)` stored as text because the local scratch
 * Postgres has no pgvector. The ledger never reads `embedding`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

// Any embedding call from the ledger would be a side effect (Workers AI spend).
const embedSpy = vi.hoisted(() => ({ calls: 0 }));
vi.mock("../src/lib/memoryCore/embedder", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../src/lib/memoryCore/embedder")>();
  return {
    ...orig,
    embedMemoryTexts: async () => {
      embedSpy.calls += 1;
      throw new Error("recall ledger must not embed");
    },
  };
});

import memoryCoreRouter from "../src/routes/memoryCore";
import { ensureSchemaOnce, getPool } from "@workspace/db";
import { decodeRecallCursor, encodeRecallCursor } from "../src/lib/memoryCore/memoryCore";

const PREFIX = `recall_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const owner = `${PREFIX}owner`;
const other = `${PREFIX}other`;
const charA = `${PREFIX}aeland`;
const charB = `${PREFIX}scarlet`;
const charC = `${PREFIX}othersonly`;
const missing = `${PREFIX}nobody`;

const A_MEM_1 = "SENTINEL_A_TURN_51c";
const A_MEM_2 = "SENTINEL_A_NOTE_8e2";
const A_MEM_3 = "SENTINEL_A_BEAT_a07";
const A_RETRACTED = "SENTINEL_A_RETRACTED_3f9";
const A_CORRUPT = "SENTINEL_A_CORRUPT_d44";
const B_MEM = "SENTINEL_B_PRIVATE_77b";
const B_LEGACY = "SENTINEL_B_LEGACY_F01_c3d";
const OTHER_MEM = "SENTINEL_OTHER_USER_6aa";
const OTHER_C_MEM = "SENTINEL_OTHER_C_19e";
const FOREIGN = [B_MEM, B_LEGACY, OTHER_MEM, OTHER_C_MEM];

let server: Server;
let base = "";
const ids: Record<string, string> = {};

const DDL = [
  `CREATE OR REPLACE FUNCTION anima_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN RAISE EXCEPTION 'anima: % on % is forbidden (append-only memory table)', TG_OP, TG_TABLE_NAME
     USING ERRCODE = 'insufficient_privilege'; END $$`,
  `CREATE TABLE IF NOT EXISTS character_identity_core (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, character_id text NOT NULL,
     version integer NOT NULL CHECK (version >= 1), name text NOT NULL,
     personality_matrix jsonb NOT NULL DEFAULT '{}'::jsonb, voice jsonb NOT NULL DEFAULT '{}'::jsonb,
     core_traits jsonb NOT NULL DEFAULT '[]'::jsonb, relationships jsonb NOT NULL DEFAULT '{}'::jsonb,
     backstory text NOT NULL DEFAULT '', source text NOT NULL DEFAULT 'app', change_note text NOT NULL DEFAULT '',
     created_at timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT character_identity_core_version_uq UNIQUE (user_id, character_id, version))`,
  `CREATE TABLE IF NOT EXISTS memory_event_types (type text PRIMARY KEY, description text NOT NULL DEFAULT '')`,
  `INSERT INTO memory_event_types (type) VALUES ('turn'),('emotional_beat'),('decision'),('image_generated'),
     ('recall'),('identity_changed'),('milestone'),('note'),('retraction'),('memory_corrupted'),('memory_restored')
   ON CONFLICT (type) DO NOTHING`,
  `CREATE TABLE IF NOT EXISTS memory_events (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, character_id text NOT NULL,
     conversation_id text, message_id text,
     event_type text NOT NULL REFERENCES memory_event_types(type), content text NOT NULL,
     payload jsonb NOT NULL DEFAULT '{}'::jsonb,
     emotional_weight real NOT NULL DEFAULT 0.5 CHECK (emotional_weight >= 0 AND emotional_weight <= 1),
     identity_version integer, embedding text, embedding_model text, dedupe_key text,
     source text NOT NULL DEFAULT 'api', occurred_at timestamptz NOT NULL DEFAULT now(),
     inserted_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TRIGGER memory_events_immutable BEFORE UPDATE OR DELETE ON memory_events
     FOR EACH ROW EXECUTE FUNCTION anima_forbid_mutation()`,
  `CREATE TABLE IF NOT EXISTS memory_recalls (
     id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event_id uuid NOT NULL REFERENCES memory_events(id),
     user_id text NOT NULL, character_id text NOT NULL, session_id text,
     score real NOT NULL, similarity real, recency real,
     event_age_s double precision NOT NULL, recalled_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TRIGGER memory_recalls_immutable BEFORE UPDATE OR DELETE ON memory_recalls
     FOR EACH ROW EXECUTE FUNCTION anima_forbid_mutation()`,
  `CREATE OR REPLACE VIEW memory_corruption_active AS
   SELECT DISTINCT ON (c.user_id, c.payload ->> 'target_event_id')
          c.user_id, c.character_id, (c.payload ->> 'target_event_id')::uuid AS target_event_id,
          c.id AS corruption_event_id,
          LEAST(GREATEST(COALESCE((c.payload ->> 'severity')::real, 0.5), 0.05), 1)::real AS severity,
          c.payload ->> 'band' AS band, c.occurred_at AS corrupted_at,
          COALESCE((c.payload ->> 'expires_at')::timestamptz, c.occurred_at + interval '7 days') AS expires_at
   FROM memory_events c
   WHERE c.event_type = 'memory_corrupted' AND c.payload ? 'target_event_id'
     AND COALESCE((c.payload ->> 'expires_at')::timestamptz, c.occurred_at + interval '7 days') > now()
     AND NOT EXISTS (SELECT 1 FROM memory_events r WHERE r.event_type = 'memory_restored'
       AND r.user_id = c.user_id AND r.payload ->> 'target_event_id' = c.payload ->> 'target_event_id'
       AND r.occurred_at >= c.occurred_at)
   ORDER BY c.user_id, c.payload ->> 'target_event_id', c.occurred_at DESC`,
];

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows as T[];
}

async function event(key: string, userId: string, characterId: string, type: string, content: string, extra: {
  payload?: Record<string, unknown>;
  weight?: number;
  occurredAt?: string;
} = {}): Promise<string> {
  const [row] = await q<{ id: string }>(
    `INSERT INTO memory_events (user_id, character_id, conversation_id, event_type, content, payload, emotional_weight, occurred_at, embedding)
     VALUES ($1, $2, 'sess-src', $3, $4, $5::jsonb, $6, COALESCE($7::timestamptz, now()), '[0.1,0.2]') RETURNING id`,
    [userId, characterId, type, content, JSON.stringify(extra.payload ?? {}), extra.weight ?? 0.5, extra.occurredAt ?? null],
  );
  ids[key] = row.id;
  return row.id;
}

/** One recall batch, written exactly like recall_memories' INSERT (one statement). */
async function recallBatch(userId: string, characterId: string, sessionId: string | null, at: string | null, hits: Array<[string, number, number | null, number | null]>) {
  const values: string[] = [];
  const params: unknown[] = [userId, characterId, sessionId, at];
  for (const [eventKey, score, sim, rec] of hits) {
    params.push(ids[eventKey], score, sim, rec);
    const n = params.length;
    values.push(`($${n - 3}::uuid, $1, $2, $3, $${n - 2}::real, $${n - 1}::real, $${n}::real, 86400 * 30)`);
  }
  await q(
    `INSERT INTO memory_recalls (event_id, user_id, character_id, session_id, score, similarity, recency, event_age_s, recalled_at)
     SELECT v.e, v.u, v.c, v.s, v.sc, v.si, v.re, v.age, COALESCE($4::timestamptz, now())
       FROM (VALUES ${values.join(",")}) AS v(e, u, c, s, sc, si, re, age)`,
    params,
  );
}

async function counts() {
  const [row] = await q<Record<string, string>>(
    `SELECT (SELECT count(*) FROM memory_events) AS events,
            (SELECT count(*) FROM memory_recalls) AS recalls,
            (SELECT count(*) FROM character_identity_core) AS identity,
            (SELECT count(*) FROM user_entities) AS entities,
            (SELECT count(*) FROM companion_memories) AS legacy,
            (SELECT max(recalled_at)::text FROM memory_recalls) AS last_recall`,
  );
  return row;
}

async function get(path: string, userId: string | null) {
  const res = await fetch(`${base}/api/memory-core${path}`, { headers: userId ? { "x-test-user": userId } : {} });
  const text = await res.text();
  return { status: res.status, cache: res.headers.get("cache-control"), text, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await ensureSchemaOnce();
  for (const sql of DDL) await q(sql);
  const entity = (userId: string, id: string, name: string) =>
    q(`INSERT INTO user_entities (user_id, entity_name, entity_id, data) VALUES ($1, 'Character', $2, $3::jsonb)`, [
      userId,
      id,
      JSON.stringify({ id, name }),
    ]);
  await entity(owner, charA, "Aeland");
  await entity(owner, charB, "Scarlet");
  await entity(other, charC, "Theirs");
  // The other user also owns a character with the SAME id as the owner's A.
  await entity(other, charA, "Collision");

  await event("a1", owner, charA, "turn", `User: hi\nMe: ${A_MEM_1}`, { payload: { turn_id: "turn-src-1" }, weight: 0.9, occurredAt: "2026-04-01T10:00:00Z" });
  await event("a2", owner, charA, "note", `A note ${A_MEM_2}`, { weight: 0.4 });
  await event("a3", owner, charA, "emotional_beat", `A beat ${A_MEM_3}`, { weight: 0.7 });
  await event("aRet", owner, charA, "note", `Forget this ${A_RETRACTED}`);
  await event("aCor", owner, charA, "note", `Corrupt this ${A_CORRUPT} with more words to glitch`);
  await event("ret", owner, charA, "retraction", "Retracted", { payload: { target_event_id: ids.aRet } });
  await event("cor", owner, charA, "memory_corrupted", "Corrupted", { payload: { target_event_id: ids.aCor, severity: 0.8 } });
  await event("b1", owner, charB, "note", `B private ${B_MEM}`);
  await event("o1", other, charA, "note", `Other user ${OTHER_MEM}`);
  await event("c1", other, charC, "note", `Other C ${OTHER_C_MEM}`);

  // Legacy F-01 contamination: B's reply copied into A's companion_memories facts.
  await q(
    `INSERT INTO companion_memories (user_id, character_id, summary, facts) VALUES ($1, $2, $3, $4::jsonb)`,
    [owner, charA, `Companion: ${B_LEGACY}`, JSON.stringify([{ type: "factual", text: `Companion: ${B_LEGACY}` }])],
  );

  // Owner / A: four batches at fixed times in two sessions, plus one batch at now().
  await recallBatch(owner, charA, "sess-1", "2026-11-01T10:00:00.000001Z", [["a1", 0.71, 0.82, 0.12], ["a2", 0.52, null, 0.3]]);
  await recallBatch(owner, charA, "sess-1", "2026-11-02T10:00:00Z", [["a3", 0.66, 0.7, 0.4], ["aRet", 0.6, 0.6, 0.5], ["aCor", 0.4, 0.5, 0.2]]);
  // Unattributable rows: A's log pointing at B's event and at another user's event.
  await recallBatch(owner, charA, "sess-2", "2026-11-03T10:00:00Z", [["a2", 0.5, 0.5, 0.5], ["b1", 0.9, 0.9, 0.9], ["o1", 0.95, 0.9, 0.9]]);
  await recallBatch(owner, charA, null, "2026-11-04T10:00:00Z", [["a1", 0.3, null, 0.12]]);
  await recallBatch(owner, charA, "sess-now", null, [["a1", 0.61, 0.6, 0.12], ["a3", 0.55, 0.5, 0.4]]);
  // Owner / B and other user's rows (must never surface for owner / A).
  await recallBatch(owner, charB, "sess-1", "2026-11-02T10:00:00Z", [["b1", 0.8, 0.8, 0.8]]);
  await recallBatch(other, charA, "sess-1", "2026-11-02T10:00:00Z", [["o1", 0.8, 0.8, 0.8]]);
  await recallBatch(other, charC, "sess-x", "2026-11-02T10:00:00Z", [["c1", 0.8, 0.8, 0.8]]);

  const app: Express = express();
  app.use(express.json());
  app.use("/api/memory-core", memoryCoreRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("recall ledger: owner happy path", () => {
  it("returns the owner's batches newest first with scores, no-store, and no internals", async () => {
    const r = await get(`/${charA}/recalls`, owner);
    expect(r.status).toBe(200);
    expect(r.cache).toBe("no-store");
    expect(r.body.character_id).toBe(charA);
    expect(r.body.meta).toEqual({ limit: 10, max_limit: 25, turn_linkage: "none", grouping: "session_id+recalled_at" });
    expect(r.body.next_cursor).toBeNull();
    const batches = r.body.batches as Array<Record<string, any>>;
    expect(batches.map((b) => b.session_id)).toEqual(["sess-now", null, "sess-2", "sess-1", "sess-1"]);
    for (const b of batches) expect(b.turn_id).toBeNull();

    // The default-now() batch stays one batch (one statement -> one recalled_at).
    expect(batches[0].recalls.map((x: any) => x.memory.event_id)).toEqual([ids.a1, ids.a3]);

    const oldest = batches[4];
    expect(oldest.recalled_at).toBe("2026-11-01T10:00:00.000001Z");
    expect(oldest.recalls).toHaveLength(2);
    const [first, second] = oldest.recalls;
    expect(first).toMatchObject({
      rank: 1,
      score: 0.71,
      similarity: 0.82,
      recency: 0.12,
      emotional_weight: 0.9,
      memory_age_s: 2592000,
      memory: {
        event_id: ids.a1,
        event_type: "turn",
        occurred_at: "2026-04-01T10:00:00.000000Z",
        conversation_id: "sess-src",
        source_turn_id: "turn-src-1",
        corrupted: false,
      },
    });
    expect(first.memory.content_preview).toContain(A_MEM_1);
    expect(second).toMatchObject({ rank: 2, similarity: null, memory: { event_id: ids.a2, source_turn_id: null } });

    expect(r.text).not.toMatch(/embedding|payload|\[0\.1,0\.2\]|dedupe_key|"prompt"/);
  });

  it("withholds retracted memories and obscures corrupted ones", async () => {
    const r = await get(`/${charA}/recalls`, owner);
    const b = (r.body.batches as any[]).find((x) => x.recalled_at === "2026-11-02T10:00:00.000000Z");
    expect(b.withheld).toEqual({ retracted: 1, unattributable: 0 });
    expect(b.recalls.map((x: any) => x.memory.event_id)).toEqual([ids.a3, ids.aCor]);
    expect(r.text).not.toContain(A_RETRACTED);
    const cor = b.recalls[1];
    expect(cor.memory.corrupted).toBe(true);
    expect(cor.memory.content_preview.startsWith("[signal corrupted · 80%]")).toBe(true);
  });

  it("401 without a signed-in user", async () => {
    const r = await get(`/${charA}/recalls`, null);
    expect(r.status).toBe(401);
    expect(r.cache).toBe("no-store");
  });
});

describe("recall ledger: owner-only", () => {
  it("another user's character is 404, identical to a nonexistent id", async () => {
    const theirs = await get(`/${charC}/recalls`, owner);
    const none = await get(`/${missing}/recalls`, owner);
    expect(theirs.status).toBe(404);
    expect(none.status).toBe(404);
    expect(theirs.text).toBe(none.text);
    expect(theirs.body).toEqual({ error: "Companion not found", code: "companion_not_found" });
    expect(theirs.text).not.toContain(OTHER_C_MEM);
  });

  it("a colliding character id under another user sees only that user's rows", async () => {
    const r = await get(`/${charA}/recalls`, other);
    expect(r.status).toBe(200);
    expect(r.body.batches).toHaveLength(1);
    expect(r.text).toContain(OTHER_MEM);
    for (const s of [A_MEM_1, A_MEM_2, A_MEM_3, A_CORRUPT, B_MEM]) expect(r.text).not.toContain(s);
    const mine = await get(`/${charA}/recalls`, owner);
    expect(mine.text).not.toContain(OTHER_MEM);
  });

  it("404 checks run before cursor/limit parsing (no oracle)", async () => {
    const r = await get(`/${charC}/recalls?cursor=not-a-cursor&limit=abc`, owner);
    expect(r.status).toBe(404);
  });
});

describe("recall ledger: cross-character isolation and F-01", () => {
  it("character B's sentinels never appear for A, and A's never for B", async () => {
    const a = await get(`/${charA}/recalls`, owner);
    for (const s of FOREIGN) expect(a.text).not.toContain(s);
    const b = await get(`/${charB}/recalls`, owner);
    expect(b.status).toBe(200);
    expect(b.text).toContain(B_MEM);
    for (const s of [A_MEM_1, A_MEM_2, A_MEM_3, A_CORRUPT, A_RETRACTED, OTHER_MEM]) expect(b.text).not.toContain(s);
  });

  it("A's log rows pointing at B's or another user's memory are withheld and counted, never shown", async () => {
    const a = await get(`/${charA}/recalls`, owner);
    const b = (a.body.batches as any[]).find((x) => x.session_id === "sess-2");
    expect(b.withheld).toEqual({ retracted: 0, unattributable: 2 });
    expect(b.recalls.map((x: any) => x.memory.event_id)).toEqual([ids.a2]);
    expect(b.recalls[0].rank).toBe(1);
  });

  it("legacy companion_memories (F-01, unattributed) are never read", async () => {
    const [legacy] = await q<{ n: string }>(`SELECT count(*) AS n FROM companion_memories WHERE user_id = $1 AND character_id = $2`, [owner, charA]);
    expect(Number(legacy.n)).toBe(1);
    const a = await get(`/${charA}/recalls`, owner);
    expect(a.text).not.toContain(B_LEGACY);
    expect(a.text).not.toContain("Companion:");
  });
});

describe("recall ledger: pagination", () => {
  it("walks every batch exactly once with a cursor", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r = await get(`/${charA}/recalls?limit=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, owner);
      expect(r.status).toBe(200);
      expect(r.body.batches.length).toBeLessThanOrEqual(2);
      for (const b of r.body.batches) seen.push(b.batch_id);
      cursor = r.body.next_cursor;
      pages += 1;
    } while (cursor && pages < 10);
    expect(pages).toBe(3);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    const all = await get(`/${charA}/recalls`, owner);
    expect(seen).toEqual(all.body.batches.map((b: any) => b.batch_id));
  });

  it("caps limit at 25 and defaults bad values to 10", async () => {
    expect((await get(`/${charA}/recalls?limit=999`, owner)).body.meta.limit).toBe(25);
    expect((await get(`/${charA}/recalls?limit=0`, owner)).body.meta.limit).toBe(1);
    expect((await get(`/${charA}/recalls?limit=abc`, owner)).body.meta.limit).toBe(10);
  });

  it("filters by session_id", async () => {
    const r = await get(`/${charA}/recalls?session_id=sess-1`, owner);
    expect(r.body.batches.map((b: any) => b.session_id)).toEqual(["sess-1", "sess-1"]);
  });

  it("rejects malformed cursors and session ids with 400", async () => {
    expect((await get(`/${charA}/recalls?cursor=garbage`, owner)).body).toEqual({ error: "Invalid cursor", code: "invalid_cursor" });
    const forged = Buffer.from(JSON.stringify({ v: 1, t: "'; DROP TABLE x; --", s: null })).toString("base64url");
    expect((await get(`/${charA}/recalls?cursor=${forged}`, owner)).status).toBe(400);
    expect((await get(`/${charA}/recalls?session_id=${"x".repeat(201)}`, owner)).status).toBe(400);
  });

  it("cursor round-trips microsecond timestamps", () => {
    const c = encodeRecallCursor({ t: "2026-11-01T10:00:00.000001Z", s: null });
    expect(decodeRecallCursor(c)).toEqual({ t: "2026-11-01T10:00:00.000001Z", s: null });
  });
});

describe("recall ledger: read-only", () => {
  it("leaves every memory table unchanged and never embeds", async () => {
    const before = await counts();
    for (let i = 0; i < 5; i++) {
      await get(`/${charA}/recalls`, owner);
      await get(`/${charA}/recalls?limit=1`, owner);
      await get(`/${charB}/recalls`, owner);
      await get(`/${charC}/recalls`, owner);
    }
    const after = await counts();
    expect(after).toEqual(before);
    expect(Number(after.identity)).toBe(0);
    expect(embedSpy.calls).toBe(0);
  });
});
