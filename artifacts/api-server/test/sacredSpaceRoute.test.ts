// Sacred Space → Synchro over HTTP + Postgres: auth, ownership, idempotency,
// daily cap, persistence across a re-read, isolation, and no lost update when
// a ritual award races a chat turn's bond write.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, like } from "drizzle-orm";
import { sql } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import relationshipOsRouter from "../src/routes/relationshipOs";
import { companionMemories, db, ensureSchemaOnce, userEntities } from "@workspace/db";
import { emotionalStateWithTurnBond } from "../src/lib/turnMoodWrite";
import { initSynchroState } from "../src/lib/synchroEngine";

const P = `sacred_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const userId = `${P}_user`;
const otherUser = `${P}_other`;
const A = `${P}_char_a`;
const B = `${P}_char_b`;
let server: Server;
let base = "";

const SELF = { mood: "wary", energy: 11, intensity: 4 };

function seed(strength: number) {
  return {
    selfState: SELF,
    intimacy: 20,
    synchroStrength: strength,
    synchroLevel: "linked",
    totalTurns: 5,
    lastInteraction: new Date(Date.now() + 60_000).toISOString(),
    emotionalTone: "guarded",
  };
}

async function reseed(userStrengthA = 30) {
  await db.delete(companionMemories).where(like(companionMemories.userId, `${P}%`));
  for (const [uid, cid, st] of [
    [userId, A, userStrengthA],
    [userId, B, 30],
    [otherUser, A, 30],
  ] as const) {
    await db.insert(companionMemories).values({
      userId: uid,
      characterId: cid,
      summary: "",
      facts: [],
      emotionalState: seed(st),
      resonanceNotes: "",
    });
  }
}

async function stateOf(uid: string, cid: string) {
  const [row] = await db
    .select()
    .from(companionMemories)
    .where(and(eq(companionMemories.userId, uid), eq(companionMemories.characterId, cid)));
  return row!;
}

async function call(method: "GET" | "POST", path: string, user: string | null, body?: unknown) {
  const res = await fetch(`${base}/relationship-os${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as any };
}

const complete = (user: string | null, over: Record<string, unknown> = {}) =>
  call("POST", "/sacred-space/complete", user, {
    character_id: A,
    activity: "sacred_space_session",
    session_id: `sess-${Math.random().toString(36).slice(2, 12)}`,
    user_turns: 4,
    ...over,
  });

beforeAll(async () => {
  await ensureSchemaOnce();
  await db.insert(userEntities).values([
    { userId, entityName: "Character", entityId: A, data: { id: A, name: "A" } },
    { userId, entityName: "Character", entityId: B, data: { id: B, name: "B" } },
    { userId: otherUser, entityName: "Character", entityId: A, data: { id: A, name: "A" } },
  ]);
  const app = express();
  app.use(express.json());
  app.use("/relationship-os", relationshipOsRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(companionMemories).where(like(companionMemories.userId, `${P}%`));
  await db.delete(userEntities).where(like(userEntities.userId, `${P}%`));
});

describe("POST /sacred-space/complete", () => {
  it("rejects anonymous, malformed, and foreign-character requests", async () => {
    await reseed();
    expect((await complete(null)).status).toBe(401);
    expect((await complete(userId, { activity: "nope" })).status).toBe(400);
    expect((await complete(userId, { session_id: "x" })).status).toBe(400);
    expect((await complete(userId, { character_id: `${P}_missing` })).status).toBe(404);
    expect((await stateOf(userId, A)).emotionalState).toMatchObject({ synchroStrength: 30 });
  });

  it("awards once per session id, persists, and preserves mood/affect fields", async () => {
    await reseed();
    const id = `sess-${P}-1`;
    const first = await complete(userId, { session_id: id });
    expect(first.status).toBe(200);
    expect(first.json.resonance).toMatchObject({ awarded: 2, strength: 32, label: "Linked" });
    const replay = await complete(userId, { session_id: id });
    expect(replay.json.resonance).toMatchObject({ awarded: 0, duplicate: true, strength: 32 });

    const row = await stateOf(userId, A);
    const es = row.emotionalState as Record<string, any>;
    expect(es.synchroStrength).toBe(32);
    expect(es.selfState).toEqual(SELF);
    expect(es.emotionalTone).toBe("guarded");
    expect(es.intimacy).toBe(20);
    expect(row.facts).toEqual([]);

    // "Refresh": a fresh read returns the persisted value.
    const read = await call("GET", `/synchro/${A}`, userId);
    expect(read.json.synchro).toMatchObject({ strength: 32, level: "linked", label: "Linked" });
  });

  it("enforces the daily cap and a minimum-completion rule", async () => {
    await reseed();
    const amounts: number[] = [];
    for (let i = 0; i < 4; i++) amounts.push((await complete(userId)).json.resonance.awarded);
    expect(amounts).toEqual([2, 2, 1, 0]);
    const short = await complete(userId, { user_turns: 0 });
    expect(short.json.resonance.awarded).toBe(0);
    expect((await call("GET", `/synchro/${A}`, userId)).json.synchro.strength).toBe(35);
  });

  it("is scoped to user and character", async () => {
    await reseed();
    await complete(userId);
    expect((await stateOf(userId, B)).emotionalState).toMatchObject({ synchroStrength: 30 });
    expect((await stateOf(otherUser, A)).emotionalState).toMatchObject({ synchroStrength: 30 });
    expect((await call("GET", `/synchro/${A}`, otherUser)).json.synchro.strength).toBe(30);
    // Another user's read of a character they have no state for sees only their own (default) data.
    expect((await call("GET", `/synchro/${B}`, otherUser)).json.synchro.strength).not.toBe(32);
  });

  it("concurrent identical requests award exactly once", async () => {
    await reseed();
    const id = `sess-${P}-race`;
    const results = await Promise.all(
      Array.from({ length: 6 }, () => complete(userId, { session_id: id })),
    );
    expect(results.filter((r) => r.json.resonance.awarded === 2)).toHaveLength(1);
    expect((await stateOf(userId, A)).emotionalState).toMatchObject({ synchroStrength: 32 });
  });

  it("a ritual award racing a chat turn's locked bond write is not lost", async () => {
    await reseed(30);
    // Mirror applyRelationshipPostProcess: read under the per-companion lock,
    // hold it briefly, then write the evolved strength with the baseline.
    const chatTurn = db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${A}`}))`);
      const [row] = await tx
        .select({ es: companionMemories.emotionalState })
        .from(companionMemories)
        .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, A)));
      const stored = row!.es as Record<string, unknown>;
      const current = initSynchroState(stored, null, null);
      await new Promise((r) => setTimeout(r, 300));
      const next = emotionalStateWithTurnBond(stored, `${P}_turn`, {
        synchro: { synchroStrength: current.vector.synchroStrength + 1 },
        synchroBaseline: current.baselineStrength,
      });
      await tx
        .update(companionMemories)
        .set({ emotionalState: next.state })
        .where(and(eq(companionMemories.userId, userId), eq(companionMemories.characterId, A)));
    });
    await new Promise((r) => setTimeout(r, 50));
    const award = complete(userId);
    await Promise.all([chatTurn, award]);
    // Serialized by the lock: 30 + 1 (chat) + 2 (ritual).
    expect((await stateOf(userId, A)).emotionalState).toMatchObject({ synchroStrength: 33 });
  });

  it("writes no memory facts and never touches Heat", async () => {
    await reseed();
    const before = await db
      .select()
      .from(userEntities)
      .where(like(userEntities.userId, `${P}%`));
    await complete(userId, { has_reflection: true });
    const after = await db
      .select()
      .from(userEntities)
      .where(like(userEntities.userId, `${P}%`));
    expect(after.map((r) => r.data)).toEqual(before.map((r) => r.data));
    expect((await stateOf(userId, A)).facts).toEqual([]);
    expect((await stateOf(userId, A)).emotionalState).not.toHaveProperty("heat");
  });
});
