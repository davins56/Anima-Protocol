import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { vi } from "vitest";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import dreamsRouter from "../src/routes/dreams";
import { db, ensureSchemaOnce, getPool, userEntities } from "@workspace/db";
import { dreamingEnabledFor } from "../src/lib/dreams/dreamLayer";

const PREFIX = `dreams_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const owner = `${PREFIX}owner`;
const other = `${PREFIX}other`;
const aelyndra = `${PREFIX}aelyndra`;
const otherChar = `${PREFIX}other_char`;

let server: Server;
let baseUrl = "";
const ids: string[] = [];
let foreignDreamId = "";
let siblingDreamId = "";

function call(path: string, user: string | null, init: { method?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

async function insertDream(userId: string, characterId: string, summary: string, at: string): Promise<string> {
  const { rows } = await getPool().query<{ id: string }>(
    `INSERT INTO dreams (user_id, character_id, themes, mood, summary, fragment, source_event_ids, model, created_at)
     VALUES ($1,$2,ARRAY['lantern'],'dreamy',$3,$4,'{}','secret-model',$5) RETURNING id`,
    [userId, characterId, summary, `fragment ${summary}`, at],
  );
  return rows[0].id;
}

beforeAll(async () => {
  await ensureSchemaOnce();
  const pool = getPool();
  // Mirrors supabase/migrations/20261022270000_dream_layer.sql + 20261111030000_dream_journal.sql,
  // including the append-only triggers, inside the disposable test schema.
  await pool.query(`
    CREATE FUNCTION anima_forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'append-only'; END $$;
    CREATE TABLE dreams (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id text NOT NULL, character_id text NOT NULL,
      identity_core_id uuid, identity_version integer, source_event_ids uuid[] NOT NULL DEFAULT '{}',
      cluster_size integer NOT NULL DEFAULT 0, cohesion real, themes text[] NOT NULL DEFAULT '{}', mood text,
      summary text NOT NULL, fragment text NOT NULL, window_start timestamptz, window_end timestamptz,
      synthesizer text NOT NULL DEFAULT 'llm', model text, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE dream_surfacings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dream_id uuid NOT NULL REFERENCES dreams(id),
      user_id text NOT NULL, character_id text NOT NULL, surface text NOT NULL DEFAULT 'proactive',
      session_id text, surfaced_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE dream_reads (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dream_id uuid NOT NULL REFERENCES dreams(id),
      user_id text NOT NULL, character_id text NOT NULL, read_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (user_id, dream_id));
    CREATE TABLE dream_settings (
      user_id text NOT NULL, character_id text NOT NULL, dreaming_enabled boolean NOT NULL DEFAULT true,
      updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (user_id, character_id));
    CREATE TRIGGER dreams_immutable BEFORE UPDATE OR DELETE ON dreams FOR EACH ROW EXECUTE FUNCTION anima_forbid_mutation();
    CREATE TRIGGER dream_reads_immutable BEFORE UPDATE OR DELETE ON dream_reads FOR EACH ROW EXECUTE FUNCTION anima_forbid_mutation();
  `);

  await db.insert(userEntities).values([
    { userId: owner, entityName: "Anima", entityId: aelyndra, data: { name: "Aelyndra" } },
    { userId: other, entityName: "Anima", entityId: otherChar, data: { name: "Other" } },
  ]);

  for (let i = 0; i < 5; i += 1) {
    ids.push(await insertDream(owner, aelyndra, `Aelyndra dream ${i}`, `2026-11-0${i + 1}T12:00:00.123456Z`));
  }
  foreignDreamId = await insertDream(other, otherChar, "someone else's dream", "2026-11-05T12:00:00Z");
  siblingDreamId = await insertDream(owner, `${PREFIX}unowned`, "unowned companion dream", "2026-11-05T12:00:00Z");
  await getPool().query(`INSERT INTO dream_surfacings (dream_id, user_id, character_id) VALUES ($1,$2,$3)`, [ids[0], owner, aelyndra]);

  const app = express();
  app.use(express.json());
  app.use("/dreams", dreamsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("dream journal API", () => {
  it("requires authentication", async () => {
    expect((await call(`/dreams/${aelyndra}`, null)).status).toBe(401);
    expect((await call(`/dreams/${aelyndra}/settings`, null)).status).toBe(401);
  });

  it("returns the owner's recorded dreams newest first, without internals", async () => {
    const res = await call(`/dreams/${aelyndra}`, owner);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body.character_id).toBe(aelyndra);
    expect(body.dreaming_enabled).toBe(true);
    expect(body.unread_count).toBe(5);
    expect(body.next_cursor).toBeNull();
    expect(body.dreams.map((d: { summary: string }) => d.summary)).toEqual([4, 3, 2, 1, 0].map((i) => `Aelyndra dream ${i}`));
    const first = body.dreams[4];
    expect(first).toMatchObject({ id: ids[0], mood: "dreamy", themes: ["lantern"], read: false, surfaced_count: 1 });
    expect(JSON.stringify(body)).not.toContain("secret-model");
    expect(body.dreams[0]).not.toHaveProperty("source_event_ids");
  });

  it("paginates with an opaque cursor and rejects a bad one", async () => {
    const p1 = await (await call(`/dreams/${aelyndra}?limit=2`, owner)).json();
    expect(p1.dreams).toHaveLength(2);
    expect(p1.next_cursor).toEqual(expect.any(String));
    const p2 = await (await call(`/dreams/${aelyndra}?limit=2&cursor=${encodeURIComponent(p1.next_cursor)}`, owner)).json();
    const p3 = await (await call(`/dreams/${aelyndra}?limit=2&cursor=${encodeURIComponent(p2.next_cursor)}`, owner)).json();
    const all = [...p1.dreams, ...p2.dreams, ...p3.dreams].map((d: { id: string }) => d.id);
    expect(all).toEqual([...ids].reverse());
    expect(p3.next_cursor).toBeNull();
    expect((await call(`/dreams/${aelyndra}?cursor=garbage`, owner)).status).toBe(400);
    const clamped = await (await call(`/dreams/${aelyndra}?limit=9999`, owner)).json();
    expect(clamped.dreams).toHaveLength(5);
  });

  it("keeps dreams private to the owning user and companion", async () => {
    for (const path of [`/dreams/${aelyndra}`, `/dreams/${aelyndra}/settings`, `/dreams/${aelyndra}/${ids[0]}`]) {
      const res = await call(path, other);
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("companion_not_found");
    }
    expect((await call(`/dreams/${otherChar}`, owner)).status).toBe(404);
    // A dream id from another user or another companion is never readable or markable.
    for (const id of [foreignDreamId, siblingDreamId, "not-a-uuid"]) {
      const detail = await call(`/dreams/${aelyndra}/${id}`, owner);
      expect(detail.status).toBe(404);
      expect((await detail.json()).code).toBe("dream_not_found");
      expect((await call(`/dreams/${aelyndra}/${id}/read`, owner, { method: "POST" })).status).toBe(404);
    }
    expect((await call(`/dreams/${aelyndra}/${ids[0]}/read`, other, { method: "POST" })).status).toBe(404);
  });

  it("serves detail and persists reads without mutating dreams", async () => {
    const before = await getPool().query(`SELECT * FROM dreams ORDER BY id`);
    const detail = await (await call(`/dreams/${aelyndra}/${ids[4]}`, owner)).json();
    expect(detail).toMatchObject({ id: ids[4], summary: "Aelyndra dream 4", read: false });

    const marked = await call(`/dreams/${aelyndra}/${ids[4]}/read`, owner, { method: "POST" });
    expect(await marked.json()).toEqual({ ok: true, unread_count: 4 });
    // Idempotent.
    expect(await (await call(`/dreams/${aelyndra}/${ids[4]}/read`, owner, { method: "POST" })).json()).toEqual({ ok: true, unread_count: 4 });

    const list = await (await call(`/dreams/${aelyndra}`, owner)).json();
    expect(list.unread_count).toBe(4);
    expect(list.dreams[0]).toMatchObject({ id: ids[4], read: true });
    const surf = await getPool().query(`SELECT count(*)::int AS n FROM dream_surfacings`);
    expect(surf.rows[0].n).toBe(1);
    const after = await getPool().query(`SELECT * FROM dreams ORDER BY id`);
    expect(after.rows).toEqual(before.rows);
  });

  it("controls dreaming per companion", async () => {
    expect(await (await call(`/dreams/${aelyndra}/settings`, owner)).json()).toEqual({ character_id: aelyndra, dreaming_enabled: true });
    expect((await call(`/dreams/${aelyndra}/settings`, owner, { method: "PUT", body: { dreaming_enabled: "no" } })).status).toBe(400);
    expect((await call(`/dreams/${aelyndra}/settings`, other, { method: "PUT", body: { dreaming_enabled: false } })).status).toBe(404);

    const put = await call(`/dreams/${aelyndra}/settings`, owner, { method: "PUT", body: { dreaming_enabled: false } });
    expect(await put.json()).toEqual({ character_id: aelyndra, dreaming_enabled: false });
    expect(await dreamingEnabledFor(owner, aelyndra)).toBe(false);
    expect(await dreamingEnabledFor(other, otherChar)).toBe(true);
    const list = await (await call(`/dreams/${aelyndra}`, owner)).json();
    expect(list.dreaming_enabled).toBe(false);
    expect(list.dreams).toHaveLength(5); // existing dreams stay readable

    await call(`/dreams/${aelyndra}/settings`, owner, { method: "PUT", body: { dreaming_enabled: true } });
    expect(await dreamingEnabledFor(owner, aelyndra)).toBe(true);
  });
});
