/**
 * POST /api/memory/journey-events and GET /api/memory/journey-interests.
 * Runs against the disposable per-run Postgres schema (test/setup-db.ts).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import journeyMemoryRouter from "../src/routes/journeyMemory";
import { db, ensureSchemaOnce, getPool, userEntities } from "@workspace/db";

const PREFIX = `journey_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const owner = `${PREFIX}owner`;
const other = `${PREFIX}other`;
const echo = `${PREFIX}echo`;
const pulse = `${PREFIX}pulse`;
const otherChar = `${PREFIX}other_char`;

let server: Server;
let baseUrl = "";
const previousLimit = process.env.ANIMA_JOURNEY_EVENTS_DAILY_LIMIT;

function call(path: string, user: string | null, init: { method?: string; body?: unknown } = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: init.method ?? "GET",
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

function row(partial: Record<string, unknown> = {}) {
  const journeyEventId = String(partial.journey_event_id ?? `${echo}:1000`);
  const payloadIn = (partial.payload as Record<string, unknown> | undefined) ?? {};
  return {
    character_id: echo,
    event_type: "cyberworld_journey",
    content: "Echo went to the Landing Page signs because they were curious about the Landing Page signs.",
    payload: {
      kind: "journey",
      area_id: "landing",
      target_id: "title",
      activity: "read the new signs",
      reason: "curious about the Landing Page signs",
      motive: "curiosity",
      journey_event_id: journeyEventId,
      ...payloadIn,
    },
    emotional_weight: 0.2,
    dedupe_key: `journey:${(payloadIn.journey_event_id as string | undefined) ?? journeyEventId}`,
    source: "cyberworld",
    occurred_at: "2026-11-13T18:00:00.000Z",
    ...partial,
    payload: {
      kind: "journey",
      area_id: "landing",
      target_id: "title",
      activity: "read the new signs",
      reason: "curious about the Landing Page signs",
      motive: "curiosity",
      journey_event_id: journeyEventId,
      ...payloadIn,
    },
  };
}

beforeAll(async () => {
  process.env.ANIMA_JOURNEY_EVENTS_DAILY_LIMIT = "5";
  await ensureSchemaOnce();

  await getPool().query(`
    CREATE TABLE IF NOT EXISTS memory_event_types (
      type text PRIMARY KEY,
      description text NOT NULL DEFAULT ''
    )`);
  await getPool().query(
    `INSERT INTO memory_event_types (type, description) VALUES
       ('cyberworld_journey', 'a companion journey in the cyberworld'),
       ('note', 'user/companion note'),
       ('turn', 'one user/companion exchange')
     ON CONFLICT (type) DO NOTHING`,
  );
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS memory_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id text NOT NULL,
      character_id text NOT NULL,
      conversation_id text,
      message_id text,
      event_type text NOT NULL REFERENCES memory_event_types(type),
      content text NOT NULL,
      payload jsonb NOT NULL DEFAULT '{}'::jsonb,
      emotional_weight real NOT NULL DEFAULT 0.5,
      dedupe_key text,
      source text NOT NULL DEFAULT 'api',
      occurred_at timestamptz NOT NULL DEFAULT now(),
      inserted_at timestamptz NOT NULL DEFAULT now()
    )`);
  await getPool().query(
    `CREATE UNIQUE INDEX IF NOT EXISTS memory_events_dedupe_uq
        ON memory_events (user_id, dedupe_key) WHERE dedupe_key IS NOT NULL`,
  );
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id text PRIMARY KEY,
      session_id text NOT NULL,
      user_id text NOT NULL,
      role text NOT NULL,
      content text NOT NULL,
      character_id text,
      character_name text,
      is_crossover boolean DEFAULT false NOT NULL,
      metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
      created_at timestamp DEFAULT now() NOT NULL
    )`);

  await db.insert(userEntities).values([
    { userId: owner, entityName: "Anima", entityId: echo, data: { name: "Echo" } },
    { userId: owner, entityName: "Anima", entityId: pulse, data: { name: "Pulse" } },
    { userId: other, entityName: "Anima", entityId: otherChar, data: { name: "Other" } },
  ]);

  const app = express();
  app.use(express.json());
  app.use("/api/memory", journeyMemoryRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (previousLimit === undefined) delete process.env.ANIMA_JOURNEY_EVENTS_DAILY_LIMIT;
  else process.env.ANIMA_JOURNEY_EVENTS_DAILY_LIMIT = previousLimit;
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe("POST /api/memory/journey-events", () => {
  it("requires authentication", async () => {
    const res = await call("/api/memory/journey-events", null, { method: "POST", body: { events: [row()] } });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("rejects a missing events array", async () => {
    const res = await call("/api/memory/journey-events", owner, { method: "POST", body: { event: row() } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });

  it("rejects a batch larger than 20", async () => {
    const events = Array.from({ length: 21 }, (_, i) => row({ journey_event_id: `${echo}:${i}` }));
    const res = await call("/api/memory/journey-events", owner, { method: "POST", body: { events } });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("batch_too_large");
  });

  it("takes user_id from the session and ignores user_id in the body", async () => {
    const event = row({ journey_event_id: `${echo}:session-user`, user_id: other });
    const res = await call("/api/memory/journey-events", owner, {
      method: "POST",
      body: { user_id: other, events: [event] },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ inserted: 1, duplicates: 0, rejected: [] });
    const { rows } = await getPool().query(
      `SELECT user_id, character_id, event_type, source, dedupe_key, content
         FROM memory_events WHERE dedupe_key = $1`,
      [`journey:${echo}:session-user`],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      user_id: owner,
      character_id: echo,
      event_type: "cyberworld_journey",
      source: "cyberworld",
      content: expect.stringContaining("went to the Landing Page signs"),
    });
    expect(rows[0].user_id).not.toBe(other);
  });

  it("skips duplicates on journey:<id> and returns 200", async () => {
    const event = row({ journey_event_id: `${echo}:dedupe` });
    const first = await call("/api/memory/journey-events", owner, { method: "POST", body: { events: [event] } });
    expect(await first.json()).toEqual({ inserted: 1, duplicates: 0, rejected: [] });
    const second = await call("/api/memory/journey-events", owner, { method: "POST", body: { events: [event] } });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ inserted: 0, duplicates: 1, rejected: [] });
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM memory_events WHERE user_id = $1 AND dedupe_key = $2`,
      [owner, `journey:${echo}:dedupe`],
    );
    expect(rows[0].n).toBe(1);
  });

  it("rejects mock-* character and payload ids without inserting", async () => {
    const res = await call("/api/memory/journey-events", owner, {
      method: "POST",
      body: {
        events: [
          row({ character_id: "mock-echo", journey_event_id: "mock-echo:1" }),
          row({ journey_event_id: `${echo}:ok-with-mocks` }),
          row({
            journey_event_id: `${echo}:payload-mock`,
            payload: { target_id: "mock-spot", journey_event_id: `${echo}:payload-mock` },
          }),
        ],
      },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.inserted).toBe(1);
    expect(body.duplicates).toBe(0);
    expect(body.rejected).toEqual([
      { index: 0, reason: "mock_id" },
      { index: 2, reason: "mock_id" },
    ]);
    const { rows } = await getPool().query(
      `SELECT character_id, payload FROM memory_events WHERE user_id = $1 AND dedupe_key = ANY($2::text[])`,
      [owner, [`journey:mock-echo:1`, `journey:${echo}:ok-with-mocks`, `journey:${echo}:payload-mock`]],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].character_id).toBe(echo);
  });

  it("returns 404 when the session user does not own the character", async () => {
    const res = await call("/api/memory/journey-events", owner, {
      method: "POST",
      body: { events: [row({ character_id: otherChar, journey_event_id: `${otherChar}:stolen` })] },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Companion not found", code: "companion_not_found" });
    const { rows } = await getPool().query(
      `SELECT 1 FROM memory_events WHERE dedupe_key = $1`,
      [`journey:${otherChar}:stolen`],
    );
    expect(rows).toHaveLength(0);
  });

  it("rate-limits per companion per UTC day and leaves the row uninserted", async () => {
    process.env.ANIMA_JOURNEY_EVENTS_DAILY_LIMIT = "2";
    try {
      const first = await call("/api/memory/journey-events", owner, {
        method: "POST",
        body: {
          events: [
            row({ character_id: pulse, journey_event_id: `${pulse}:rate-1` }),
            row({ character_id: pulse, journey_event_id: `${pulse}:rate-2` }),
          ],
        },
      });
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({ inserted: 2, duplicates: 0 });

      const limited = await call("/api/memory/journey-events", owner, {
        method: "POST",
        body: { events: [row({ character_id: pulse, journey_event_id: `${pulse}:rate-3` })] },
      });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toEqual(expect.any(String));
      const body = await limited.json();
      expect(body).toMatchObject({ error: "rate_limited", code: "rate_limited", character_id: pulse, limit: 2 });
      expect(body.retry_after).toBeGreaterThan(0);
      // A retry of an already-stored event is a duplicate, not a 429.
      const dup = await call("/api/memory/journey-events", owner, {
        method: "POST",
        body: { events: [row({ character_id: pulse, journey_event_id: `${pulse}:rate-1` })] },
      });
      expect(dup.status).toBe(200);
      expect(await dup.json()).toEqual({ inserted: 0, duplicates: 1, rejected: [] });
    } finally {
      process.env.ANIMA_JOURNEY_EVENTS_DAILY_LIMIT = "5";
    }
    const { rows } = await getPool().query(
      `SELECT count(*)::int AS n FROM memory_events WHERE user_id = $1 AND dedupe_key = $2`,
      [owner, `journey:${pulse}:rate-3`],
    );
    expect(rows[0].n).toBe(0);
  });
});

describe("GET /api/memory/journey-interests", () => {
  it("requires authentication", async () => {
    expect((await call(`/api/memory/journey-interests?character_id=${echo}`, null)).status).toBe(401);
  });

  it("returns 404 for a character the user does not own", async () => {
    const res = await call(`/api/memory/journey-interests?character_id=${echo}`, other);
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("companion_not_found");
  });

  it("returns recent memories and topics for the owner", async () => {
    await getPool().query(
      `INSERT INTO chat_messages (id, session_id, user_id, role, content, character_id)
       VALUES ($1,$2,$3,'user',$4,$5)`,
      [`${PREFIX}msg`, `${PREFIX}session`, owner, "I want to talk about design and signs", echo],
    );
    const res = await call(`/api/memory/journey-interests?character_id=${echo}`, owner);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(body.character_id).toBe(echo);
    expect(body.source).toBe("mixed");
    expect(body.memories.some((m: { event_type: string; content: string }) => m.event_type === "cyberworld_journey" && m.content.includes("went to the Landing Page signs"))).toBe(true);
    expect(body.topics).toEqual(expect.arrayContaining(["curiosity", "signs"]));
    expect(body.topics).toEqual(expect.arrayContaining(["design"]));
  });
});
