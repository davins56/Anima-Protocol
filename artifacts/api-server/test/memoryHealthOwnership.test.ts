/**
 * Owner gate for GET /api/memory-core/:characterId/health.
 *
 * The health SQL (memory_health in supabase/migrations/20261022200000_immersive_sim.sql)
 * filters counts by (p_user_id, p_character_id) but was reachable for any
 * signed-in user who knew a character id, and its oldest_recent_recall join
 * matches memory_events on id only. This route must refuse a non-owned or
 * nonexistent character with an identical 404 *before* calling memory_health.
 *
 * Runs against the disposable per-run Postgres schema (test/setup-db.ts).
 * Memory tables and a call-logging memory_health are created here; local
 * scratch Postgres has no pgvector, and this test never reads embeddings.
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

import * as memoryCoreLib from "../src/lib/memoryCore/memoryCore";
import memoryCoreRouter from "../src/routes/memoryCore";
import { ensureSchemaOnce, getPool } from "@workspace/db";

const PREFIX = `mhealth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const owner = `${PREFIX}owner`;
const other = `${PREFIX}other`;
const charA = `${PREFIX}aeland`;
const charAnima = `${PREFIX}serenity`;
const charC = `${PREFIX}othersonly`;
const charSession = `${PREFIX}notachar`;
const missing = `${PREFIX}nobody`;
const A_NOTE = "SENTINEL_OWNER_A_NOTE_e91";
const C_NOTE = "SENTINEL_OTHER_C_NOTE_7b2";
const FOREIGN_CONTENT = "SENTINEL_FOREIGN_EVENT_CONTENT_c4d";

const NOT_FOUND_BODY = { error: "Companion not found", code: "companion_not_found" };
const NOT_FOUND_TEXT = JSON.stringify(NOT_FOUND_BODY);

let server: Server;
let base = "";
const ids: Record<string, string> = {};

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const { rows } = await getPool().query(sql, params);
  return rows as T[];
}

async function get(path: string, userId: string | null) {
  const res = await fetch(`${base}/api/memory-core${path}`, { headers: userId ? { "x-test-user": userId } : {} });
  const text = await res.text();
  return { status: res.status, cache: res.headers.get("cache-control"), text, body: text ? JSON.parse(text) : null };
}

beforeAll(async () => {
  await ensureSchemaOnce();

  await q(`CREATE TABLE IF NOT EXISTS memory_health_calls (
    user_id text NOT NULL,
    character_id text NOT NULL,
    called_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS character_identity_core (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    character_id text NOT NULL,
    version integer NOT NULL CHECK (version >= 1),
    name text NOT NULL,
    personality_matrix jsonb NOT NULL DEFAULT '{}'::jsonb,
    voice jsonb NOT NULL DEFAULT '{}'::jsonb,
    core_traits jsonb NOT NULL DEFAULT '[]'::jsonb,
    relationships jsonb NOT NULL DEFAULT '{}'::jsonb,
    backstory text NOT NULL DEFAULT '',
    source text NOT NULL DEFAULT 'app',
    change_note text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS memory_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id text NOT NULL,
    character_id text NOT NULL,
    conversation_id text,
    message_id text,
    event_type text NOT NULL,
    content text NOT NULL,
    payload jsonb NOT NULL DEFAULT '{}'::jsonb,
    emotional_weight real NOT NULL DEFAULT 0.5,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    inserted_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE TABLE IF NOT EXISTS memory_recalls (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id uuid NOT NULL,
    user_id text NOT NULL,
    character_id text NOT NULL,
    session_id text,
    score real NOT NULL DEFAULT 0.5,
    similarity real,
    recency real,
    event_age_s double precision NOT NULL DEFAULT 0,
    recalled_at timestamptz NOT NULL DEFAULT now()
  )`);
  await q(`CREATE OR REPLACE VIEW memory_corruption_active AS
    SELECT NULL::text AS user_id, NULL::text AS character_id WHERE false`);

  // Same signature and join as immersive_sim.sql memory_health (~228-251),
  // plus a call log so tests can prove the function did or did not run.
  await q(`CREATE OR REPLACE FUNCTION memory_health(p_user_id text, p_character_id text)
    RETURNS jsonb LANGUAGE plpgsql AS $$
    BEGIN
      INSERT INTO memory_health_calls (user_id, character_id) VALUES (p_user_id, p_character_id);
      RETURN jsonb_build_object(
        'memory_count', (SELECT count(*) FROM memory_events
                          WHERE user_id = p_user_id AND character_id = p_character_id
                            AND event_type NOT IN ('recall','retraction','memory_corrupted','memory_restored')),
        'first_memory_at', (SELECT min(occurred_at) FROM memory_events
                             WHERE user_id = p_user_id AND character_id = p_character_id),
        'last_memory_at', (SELECT max(occurred_at) FROM memory_events
                            WHERE user_id = p_user_id AND character_id = p_character_id),
        'identity_version', (SELECT max(version) FROM character_identity_core
                              WHERE user_id = p_user_id AND character_id = p_character_id),
        'last_recall_at', (SELECT max(recalled_at) FROM memory_recalls
                            WHERE user_id = p_user_id AND character_id = p_character_id),
        'corrupted_count', (SELECT count(*) FROM memory_corruption_active
                             WHERE user_id = p_user_id AND character_id = p_character_id),
        'oldest_recent_recall', (
          SELECT jsonb_build_object('event_id', mr.event_id, 'age_s', mr.event_age_s,
                                    'recalled_at', mr.recalled_at, 'content', left(me.content, 140))
          FROM memory_recalls mr JOIN memory_events me ON me.id = mr.event_id
          WHERE mr.user_id = p_user_id AND mr.character_id = p_character_id
            AND mr.recalled_at > now() - interval '7 days'
          ORDER BY mr.event_age_s DESC LIMIT 1)
      );
    END $$`);

  const entity = (userId: string, id: string, name: string, entityName = "Character") =>
    q(
      `INSERT INTO user_entities (user_id, entity_name, entity_id, data) VALUES ($1, $2, $3, $4::jsonb)`,
      [userId, entityName, id, JSON.stringify({ id, name })],
    );
  await entity(owner, charA, "Aeland", "Character");
  await entity(owner, charAnima, "Serenity", "Anima");
  await entity(other, charC, "Theirs", "Character");
  // Same character id under the other user (collision), and a non-companion row.
  await entity(other, charA, "Collision", "Character");
  await entity(owner, charSession, "Not a companion", "ChatSession");

  const insertEvent = async (key: string, userId: string, characterId: string, content: string) => {
    const [row] = await q<{ id: string }>(
      `INSERT INTO memory_events (user_id, character_id, event_type, content, occurred_at)
       VALUES ($1, $2, 'note', $3, '2026-11-01T10:00:00Z') RETURNING id`,
      [userId, characterId, content],
    );
    ids[key] = row.id;
  };
  await insertEvent("a1", owner, charA, A_NOTE);
  await insertEvent("c1", other, charC, C_NOTE);
  await insertEvent("foreign", other, charC, FOREIGN_CONTENT);

  await q(
    `INSERT INTO character_identity_core (user_id, character_id, version, name)
     VALUES ($1, $2, 3, 'Aeland')`,
    [owner, charA],
  );
  await q(
    `INSERT INTO memory_recalls (event_id, user_id, character_id, score, event_age_s, recalled_at)
     VALUES ($1::uuid, $2, $3, 0.7, 86400, now())`,
    [ids.a1, owner, charA],
  );

  const app: Express = express();
  app.use(express.json());
  app.use("/api/memory-core", memoryCoreRouter);
  server = app.listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("GET /api/memory-core/:characterId/health ownership", () => {
  it("returns 200 with health for the owner of a Character row, and does not cache it", async () => {
    const before = await q<{ n: string }>(`SELECT count(*)::text AS n FROM memory_health_calls`);
    const r = await get(`/${charA}/health`, owner);
    expect(r.status).toBe(200);
    expect(r.cache).toBe("private, no-store");
    expect(r.body.health).toMatchObject({
      memory_count: 1,
      identity_version: 3,
    });
    expect(r.body.health.last_recall_at).toBeTruthy();
    expect(r.body.health.first_memory_at).toBeTruthy();
    expect(r.body.health.oldest_recent_recall).toMatchObject({
      event_id: ids.a1,
      age_s: 86400,
    });
    expect(r.body.health.oldest_recent_recall.content).toContain(A_NOTE);
    expect(r.text).not.toContain(C_NOTE);
    expect(r.text).not.toContain(FOREIGN_CONTENT);
    const after = await q<{ n: string }>(`SELECT count(*)::text AS n FROM memory_health_calls`);
    expect(Number(after[0].n)).toBe(Number(before[0].n) + 1);
  });

  it("returns 200 for an Anima row the caller owns", async () => {
    const r = await get(`/${charAnima}/health`, owner);
    expect(r.status).toBe(200);
    expect(r.cache).toBe("private, no-store");
    expect(r.body.health.memory_count).toBe(0);
    expect(r.body.health.identity_version).toBeNull();
  });

  it("another user's character is 404, byte-identical to a missing id, and does not run memory_health", async () => {
    const before = await q<{ n: string }>(`SELECT count(*)::text AS n FROM memory_health_calls`);
    const spy = vi.spyOn(memoryCoreLib, "memoryHealth");
    const theirs = await get(`/${charC}/health`, owner);
    const none = await get(`/${missing}/health`, owner);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(theirs.status).toBe(404);
    expect(none.status).toBe(404);
    expect(theirs.text).toBe(none.text);
    expect(theirs.text).toBe(NOT_FOUND_TEXT);
    expect(theirs.body).toEqual(NOT_FOUND_BODY);
    expect(none.body).toEqual(NOT_FOUND_BODY);
    expect(theirs.cache).toBe("private, no-store");
    expect(none.cache).toBe("private, no-store");
    expect(theirs.text).not.toContain(C_NOTE);
    expect(theirs.text).not.toContain(FOREIGN_CONTENT);
    const after = await q<{ n: string }>(
      `SELECT count(*)::text AS n FROM memory_health_calls
        WHERE user_id = $1 AND character_id IN ($2, $3)`,
      [owner, charC, missing],
    );
    expect(Number(after[0].n)).toBe(0);
    const total = await q<{ n: string }>(`SELECT count(*)::text AS n FROM memory_health_calls`);
    expect(Number(total[0].n)).toBe(Number(before[0].n));
  });

  it("a ChatSession row with the same id is not a companion (404, no health query)", async () => {
    const before = await q<{ n: string }>(`SELECT count(*)::text AS n FROM memory_health_calls`);
    const r = await get(`/${charSession}/health`, owner);
    expect(r.status).toBe(404);
    expect(r.text).toBe(NOT_FOUND_TEXT);
    const after = await q<{ n: string }>(`SELECT count(*)::text AS n FROM memory_health_calls`);
    expect(Number(after[0].n)).toBe(Number(before[0].n));
  });

  it("a colliding character id is still owner-gated per user", async () => {
    const mine = await get(`/${charA}/health`, owner);
    const theirs = await get(`/${charA}/health`, other);
    expect(mine.status).toBe(200);
    expect(theirs.status).toBe(200);
    expect(mine.body.health.memory_count).toBe(1);
    expect(theirs.body.health.memory_count).toBe(0);
    expect(theirs.text).not.toContain(A_NOTE);
  });

  it("401 without a signed-in user, and does not run memory_health", async () => {
    const before = await q<{ n: string }>(`SELECT count(*)::text AS n FROM memory_health_calls`);
    const r = await get(`/${charA}/health`, null);
    expect(r.status).toBe(401);
    expect(r.cache).toBe("private, no-store");
    const after = await q<{ n: string }>(`SELECT count(*)::text AS n FROM memory_health_calls`);
    expect(Number(after[0].n)).toBe(Number(before[0].n));
  });
});
