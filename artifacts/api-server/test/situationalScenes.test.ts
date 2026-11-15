/**
 * #763 PR 1: scene state, GET/PATCH/command, scenes_enabled/adult_gated.
 * Real chat router + real Postgres (disposable schema from setup-db.ts).
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import chatRouter, { syncTypedSession } from "../src/routes/chat";
import storeRouter from "../src/routes/store";
import { CHAT_MESSAGE, chatSessions, db, userEntities } from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";
import {
  applyScenePatch,
  computeAdultGated,
  emptyScene,
  normalizeStoredScene,
  parseSceneCommand,
  sanitizeSceneText,
  sceneCommandPatch,
  sceneEventLine,
  sceneHeardBy,
  scenesEnabled,
  SCENE_PRESENCES,
} from "../src/lib/scenes/sceneState";
import { adultGate } from "../src/lib/safety/adultGate";
import { recapLines } from "../src/lib/sessionRecap";

const PREFIX = `scenes_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const userA = `${PREFIX}a`;
const userB = `${PREFIX}b`;
const NATASHA = `${PREFIX}natasha`;
const SERENITY = `${PREFIX}serenity`;
const SOLO_CHAR = `${PREFIX}solo`;

let server: Server;
let baseUrl = "";
let seq = 0;

async function seedCharacter(userId: string, id: string, name: string, universe = "Anima") {
  await db.insert(userEntities).values({ userId, entityName: "Character", entityId: id, data: { id, name, universe } });
}

async function seedSession(userId: string, opts: { group?: string[]; solo?: string; mode?: string } = {}) {
  seq += 1;
  const id = `${PREFIX}sess${seq}`;
  const data: Record<string, unknown> = { id, title: "t", messages_migrated: true };
  if (opts.group) {
    data.group_character_ids = opts.group;
    data.mode = opts.mode ?? "group";
  }
  if (opts.solo) {
    data.character_id = opts.solo;
    data.mode = opts.mode ?? "solo";
  }
  await db.insert(userEntities).values({ userId, entityName: "ChatSession", entityId: id, data });
  return id;
}

async function call(method: string, path: string, body?: unknown, user: string | null = userA) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function storedMessages(userId: string, sessionId: string) {
  const rows = await db
    .select({ data: userEntities.data })
    .from(userEntities)
    .where(
      and(
        eq(userEntities.userId, userId),
        eq(userEntities.entityName, CHAT_MESSAGE),
        sql`${userEntities.data} ->> 'session_id' = ${sessionId}`,
      ),
    );
  return rows.map((r) => r.data as Record<string, unknown>).sort((a, b) => Number(a.seq) - Number(b.seq));
}

async function typedRow(sessionId: string) {
  const [row] = await db.select().from(chatSessions).where(eq(chatSessions.id, sessionId)).limit(1);
  return row ?? null;
}

const flagOn = () => {
  process.env.ANIMA_SITUATIONAL_SCENES = "on";
};
const flagOff = () => {
  delete process.env.ANIMA_SITUATIONAL_SCENES;
};

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/store", storeRouter);
  app.use("/chat", chatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  await seedCharacter(userA, NATASHA, "Natasha", "Marvel");
  await seedCharacter(userA, SERENITY, "Serenity", "Marvel");
  await seedCharacter(userA, SOLO_CHAR, "Scarlet", "Anima");
});

afterEach(() => flagOff());

afterAll(async () => {
  flagOff();
  await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  await db.delete(chatSessions).where(like(chatSessions.userId, `${PREFIX}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("scene state (pure)", () => {
  it("reads the flag strictly", () => {
    expect(scenesEnabled({})).toBe(false);
    expect(scenesEnabled({ ANIMA_SITUATIONAL_SCENES: "off" })).toBe(false);
    expect(scenesEnabled({ ANIMA_SITUATIONAL_SCENES: "0" })).toBe(false);
    for (const v of ["on", "1", "TRUE", " yes "]) expect(scenesEnabled({ ANIMA_SITUATIONAL_SCENES: v })).toBe(true);
  });

  it("parses /scene commands (M10)", () => {
    expect(parseSceneCommand("/scene Rooftop")).toEqual({ ok: true, location: "Rooftop", names: null });
    expect(parseSceneCommand("/scene , Natasha")).toEqual({ ok: true, location: undefined, names: ["Natasha"] });
    expect(parseSceneCommand("/SCENE Rooftop, @Natasha , Serenity,")).toEqual({
      ok: true,
      location: "Rooftop",
      names: ["Natasha", "Serenity"],
    });
    expect(parseSceneCommand("/scene").ok).toBe(false);
    expect(parseSceneCommand("/scene ,").ok).toBe(false);
    expect(parseSceneCommand("/scenery Rooftop").ok).toBe(false);
    expect(parseSceneCommand("hello").ok).toBe(false);
    expect(parseSceneCommand(42).ok).toBe(false);
  });

  it("names here, everyone else away; all-unknown names leave the cast alone", () => {
    const members = [
      { id: "n", name: "Natasha" },
      { id: "s", name: "Serenity" },
    ];
    const both = sceneCommandPatch({ parsed: { ok: true, location: undefined, names: ["natasha", "Bob"] }, members });
    expect(both.patch.cast).toEqual({ n: { presence: "here" }, s: { presence: "away" } });
    expect(both.unresolved).toEqual(["Bob"]);
    const none = sceneCommandPatch({ parsed: { ok: true, location: "Roof", names: ["Bob"] }, members });
    expect(none.patch).toEqual({ location: "Roof" });
    expect(none.unresolved).toEqual(["Bob"]);
  });

  it("sanitises and caps location (80) and note (120)", () => {
    expect(sanitizeSceneText("  <b>Roof</b>\u0000top  ", 80)).toBe("Roof top");
    expect(sanitizeSceneText("x".repeat(200), 80)).toHaveLength(80);
    expect(sanitizeSceneText("   ", 80)).toBeNull();
    const session = { characterIds: ["n"], isGroup: false };
    const r = applyScenePatch(emptyScene(), { cast: { n: { presence: "away", note: "y".repeat(500) } } }, session, "t");
    expect(r.ok && r.scene.cast.n?.note).toHaveLength(120);
  });

  it("validates patches and reports changes as enter/exit/state", () => {
    const session = { characterIds: ["n", "s"], isGroup: true };
    expect(applyScenePatch(emptyScene(), { mode: "loud" }, session, "t").ok).toBe(false);
    expect(applyScenePatch(emptyScene(), { cast: { n: { presence: "gone" } } }, session, "t").ok).toBe(false);
    const unknown = applyScenePatch(emptyScene(), { cast: { x: { presence: "away" } } }, session, "t");
    expect(!unknown.ok && unknown.error.error).toBe("unknown_cast_member");
    const aspect = applyScenePatch(emptyScene(), { cast: { "aspect:shadow": { presence: "here" } } }, session, "t");
    expect(!aspect.ok && aspect.error.error).toBe("aspect_not_allowed");
    const soloAspect = applyScenePatch(
      emptyScene(),
      { cast: { "aspect:shadow": { presence: "here" } } },
      { characterIds: ["n"], isGroup: false },
      "t",
    );
    expect(soloAspect.ok).toBe(true);
    expect(applyScenePatch(emptyScene(), { cast: { "aspect:nope": { presence: "here" } } }, { characterIds: ["n"], isGroup: false }, "t").ok).toBe(false);

    const away = applyScenePatch(emptyScene(), { cast: { n: { presence: "away", note: "archive" } } }, session, "t1");
    if (!away.ok) throw new Error("expected ok");
    expect(away.changes).toEqual([{ kind: "exit", characterId: "n", presence: "away", from: "here", note: "archive" }]);
    const back = applyScenePatch(away.scene, { cast: { n: { presence: "here" } } }, session, "t2");
    if (!back.ok) throw new Error("expected ok");
    expect(back.changes[0]).toMatchObject({ kind: "enter", from: "away" });
    expect(back.scene.cast.n).toEqual({ presence: "here", reach: "none", since: "t2", note: null });
    const asleep = applyScenePatch(back.scene, { cast: { n: { presence: "asleep" } } }, session, "t3");
    expect(asleep.ok && asleep.changes[0]?.kind).toBe("state");
    const same = applyScenePatch(back.scene, { cast: { n: { presence: "here" } } }, session, "t4");
    expect(same.ok && same.changed).toBe(false);
  });

  it("renders in-world event lines", () => {
    const nameOf = () => "Scarlet";
    expect(sceneEventLine({ kind: "exit", characterId: "x", presence: "away", from: "here", note: "toward the archive" }, nameOf)).toBe(
      "Scarlet steps away (toward the archive).",
    );
    expect(sceneEventLine({ kind: "state", characterId: "x", presence: "here", from: "asleep", note: null }, nameOf)).toBe("Scarlet wakes up.");
    expect(sceneEventLine({ kind: "state", location: "Rooftop" }, nameOf)).toBe("The scene moves to Rooftop.");
  });

  it("heard_by: here, plus away characters with reach who are mentioned; never aspects", () => {
    const scene = normalizeStoredScene({
      cast: {
        a: { presence: "here" },
        b: { presence: "away", reach: "phone" },
        c: { presence: "asleep", reach: "phone" },
        "aspect:shadow": { presence: "here" },
      },
    });
    expect(sceneHeardBy(scene)).toEqual(["a"]);
    expect(sceneHeardBy(scene, ["b", "c"])).toEqual(["a", "b"]);
  });
});

describe("adult gate R3 (fail closed)", () => {
  const ids = ["me", "other"];
  it("every presence other than away counts as present", () => {
    for (const presence of SCENE_PRESENCES) {
      const gated = computeAdultGated({
        rawScene: { cast: { me: { presence: "here" }, other: { presence } } },
        characterIds: ids,
        isCrossover: false,
      });
      expect([presence, gated]).toEqual([presence, presence !== "away"]);
    }
  });
  it("a strictly solo scene passes; remote listeners and missing entries close it", () => {
    expect(computeAdultGated({ rawScene: undefined, characterIds: ["me"], isCrossover: false })).toBe(false);
    expect(computeAdultGated({ rawScene: { cast: { me: { presence: "here" }, other: { presence: "away" } } }, characterIds: ids, isCrossover: false })).toBe(false);
    for (const reach of ["text", "phone", "carrier-pigeon"]) {
      expect(computeAdultGated({ rawScene: { cast: { me: { presence: "here" }, other: { presence: "away", reach } } }, characterIds: ids, isCrossover: false })).toBe(true);
    }
    // `other` has no cast entry, so counts as here.
    expect(computeAdultGated({ rawScene: { cast: { me: { presence: "here" } } }, characterIds: ids, isCrossover: false })).toBe(true);
    expect(computeAdultGated({ rawScene: undefined, characterIds: ids, isCrossover: false })).toBe(true);
  });
  it("malformed scene jsonb, unknown presence and crossover close it", () => {
    for (const rawScene of ["junk", 7, [], { cast: [] }, { cast: { me: "here" } }]) {
      expect(computeAdultGated({ rawScene, characterIds: ["me"], isCrossover: false })).toBe(true);
    }
    expect(computeAdultGated({ rawScene: { cast: { me: { presence: "here" }, other: { presence: "levitating" } } }, characterIds: ids, isCrossover: false })).toBe(true);
    expect(computeAdultGated({ rawScene: undefined, characterIds: ["me"], isCrossover: true })).toBe(true);
  });
  it("adultGate only narrows: scene=true closes it, absent leaves it unchanged", () => {
    const base = { therapy: false, crossover: false, ageAttested: true, settingEnabled: true, requested: true };
    expect(adultGate(base)).toEqual({ adult: true, reason: "allowed" });
    expect(adultGate({ ...base, scene: false })).toEqual({ adult: true, reason: "allowed" });
    expect(adultGate({ ...base, scene: true })).toEqual({ adult: false, reason: "scene" });
    expect(adultGate({ ...base, ageAttested: false, scene: false })).toEqual({ adult: false, reason: "not_attested" });
  });
});

describe("flag off: unchanged behaviour", () => {
  it("scene routes answer 409 scenes_disabled and write nothing", async () => {
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    for (const [method, path, body] of [
      ["GET", `/chat/sessions/${sessionId}/scene`, undefined],
      ["PATCH", `/chat/sessions/${sessionId}/scene`, { location: "Roof" }],
      ["POST", `/chat/sessions/${sessionId}/scene/command`, { text: "/scene Roof, Natasha" }],
    ] as const) {
      const res = await call(method, path, body);
      expect(res.status).toBe(409);
      expect(await res.json()).toEqual({ error: "scenes_disabled" });
    }
    expect(await typedRow(sessionId)).toBeNull();
    expect(await storedMessages(userA, sessionId)).toEqual([]);
  });

  it("GET /context has exactly main's keys (no scenes_enabled / adult_gated)", async () => {
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const res = await call("GET", `/chat/sessions/${sessionId}/context`);
    expect(res.status).toBe(200);
    expect(Object.keys(await res.json()).sort()).toEqual(
      ["characters", "companion_affect", "memories", "recent_messages", "session"].sort(),
    );
  });

  it("syncTypedSession still writes exactly the incoming metadata", async () => {
    const sessionId = await seedSession(userA, { solo: SOLO_CHAR });
    const base = { userId: userA, sessionId, title: "t", mode: "solo", characterIds: [SOLO_CHAR], isCrossover: false };
    await syncTypedSession({ ...base, metadata: { source: "chat_api" } });
    await syncTypedSession({ ...base, metadata: { source: "chat_api", turn_id: "t1" } });
    expect((await typedRow(sessionId))?.metadata).toEqual({ source: "chat_api", turn_id: "t1" });
    await syncTypedSession({ ...base });
    expect((await typedRow(sessionId))?.metadata).toEqual({});
  });

  it("recaps skip scene event rows; other roles are untouched", () => {
    expect(
      recapLines([
        { role: "user", content: "hi" },
        { role: "event", content: "Scarlet steps away." },
        { role: "assistant", content: "hey", character_name: "Scarlet" },
      ]),
    ).toHaveLength(2);
  });
});

describe("flag on: scene endpoints", () => {
  it("auth: 401 without a user, 404 for a missing or someone else's session", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    expect((await call("GET", `/chat/sessions/${sessionId}/scene`, undefined, null)).status).toBe(401);
    expect((await call("GET", `/chat/sessions/${sessionId}/scene`, undefined, userB)).status).toBe(404);
    expect((await call("PATCH", `/chat/sessions/${sessionId}/scene`, { location: "x" }, userB)).status).toBe(404);
    expect((await call("POST", `/chat/sessions/${sessionId}/scene/command`, { text: "/scene x" }, userB)).status).toBe(404);
    expect((await call("GET", `/chat/sessions/${PREFIX}nope/scene`)).status).toBe(404);
    expect(await typedRow(sessionId)).toBeNull();
  });

  it("cross-user ids: a same-id session of another user never reads or writes A's scene", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const patched = await call("PATCH", `/chat/sessions/${sessionId}/scene`, { location: "Secret base" });
    expect(patched.status).toBe(200);
    // B mints a ChatSession with A's id through the generic store.
    const forged = await call("PUT", `/store/ChatSession/${sessionId}`, { id: sessionId, title: "mine" }, userB);
    expect(forged.status).toBe(200);
    const bGet = await call("GET", `/chat/sessions/${sessionId}/scene`, undefined, userB);
    expect(bGet.status).toBe(200);
    expect((await bGet.json()).location).toBeNull();
    const bPatch = await call("PATCH", `/chat/sessions/${sessionId}/scene`, { location: "Hijack" }, userB);
    expect(bPatch.status).toBe(404);
    const row = await typedRow(sessionId);
    expect(row?.userId).toBe(userA);
    expect((row?.metadata as { scene: { location: string } }).scene.location).toBe("Secret base");
    expect(await storedMessages(userB, sessionId)).toEqual([]);
  });

  it("GET returns the default scene: rev 0, every character here", async () => {
    flagOn();
    const group = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const res = await call("GET", `/chat/sessions/${group}/scene`);
    expect(await res.json()).toEqual({
      version: 1,
      rev: 0,
      location: null,
      narrator: false,
      mode: "natural",
      cast: {
        [NATASHA]: { presence: "here", reach: "none", since: null, note: null },
        [SERENITY]: { presence: "here", reach: "none", since: null, note: null },
      },
      adult_gated: true,
    });
    const solo = await seedSession(userA, { solo: SOLO_CHAR });
    expect((await (await call("GET", `/chat/sessions/${solo}/scene`)).json()).adult_gated).toBe(false);
  });

  it("PATCH bumps rev, returns full persisted event rows, and if_rev guards stale tabs", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const res = await call("PATCH", `/chat/sessions/${sessionId}/scene`, {
      location: "Rooftop",
      cast: { [SERENITY]: { presence: "away", note: "toward the archive" } },
      if_rev: 0,
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.scene.rev).toBe(1);
    expect(body.scene.location).toBe("Rooftop");
    expect(body.scene.cast[SERENITY]).toMatchObject({ presence: "away", note: "toward the archive" });
    expect(body.scene.adult_gated).toBe(false);
    expect(body.events).toHaveLength(2);
    const stored = await storedMessages(userA, sessionId);
    expect(stored).toEqual(body.events);
    for (const ev of body.events) {
      expect(ev).toMatchObject({ role: "event", session_id: sessionId });
      expect(typeof ev.id).toBe("string");
      expect(typeof ev.seq).toBe("number");
      expect(typeof ev.created_at).toBe("string");
    }
    expect(body.events[0]).toMatchObject({ content: "The scene moves to Rooftop.", metadata: { kind: "state", location: "Rooftop", heard_by: [NATASHA] } });
    expect(body.events[1]).toMatchObject({
      content: "Serenity steps away (toward the archive).",
      metadata: { kind: "exit", character_id: SERENITY, presence: "away", heard_by: [NATASHA, SERENITY] },
    });

    const stale = await call("PATCH", `/chat/sessions/${sessionId}/scene`, { location: "Basement", if_rev: 0 });
    expect(stale.status).toBe(409);
    const staleBody = await stale.json();
    expect(staleBody.error).toBe("scene_conflict");
    expect(staleBody.scene).toMatchObject({ rev: 1, location: "Rooftop" });

    const noop = await call("PATCH", `/chat/sessions/${sessionId}/scene`, { location: "Rooftop" });
    expect((await noop.json())).toMatchObject({ scene: { rev: 1 }, events: [] });

    const invalid = await call("PATCH", `/chat/sessions/${sessionId}/scene`, { cast: { [`${PREFIX}stranger`]: { presence: "here" } } });
    expect(invalid.status).toBe(400);
    expect((await invalid.json()).error).toBe("unknown_cast_member");
    expect((await call("PATCH", `/chat/sessions/${sessionId}/scene`, { if_rev: "x" })).status).toBe(400);
  });

  it("revision race: concurrent PATCHes on the same if_rev give exactly one winner", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => call("PATCH", `/chat/sessions/${sessionId}/scene`, { location: `Place ${i}`, if_rev: 0 })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);
    const final = await (await call("GET", `/chat/sessions/${sessionId}/scene`)).json();
    expect(final.rev).toBe(1);
    expect(await storedMessages(userA, sessionId)).toHaveLength(1);
  });

  it("revision race: concurrent unconditioned PATCHes serialize (rev and seq unique)", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => call("PATCH", `/chat/sessions/${sessionId}/scene`, { location: `Spot ${i}` })),
    );
    expect(results.every((r) => r.status === 200)).toBe(true);
    const revs = (await Promise.all(results.map((r) => r.json()))).map((b) => b.scene.rev).sort((a, b) => a - b);
    expect(revs).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    const seqs = (await storedMessages(userA, sessionId)).map((m) => m.seq);
    expect(new Set(seqs).size).toBe(8);
  });

  it("/scene command: location + cast, unresolved names, cast-only, location-only", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const res = await call("POST", `/chat/sessions/${sessionId}/scene/command`, { text: "/scene Rooftop, natasha, Bob" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.unresolved).toEqual(["Bob"]);
    expect(body.scene.location).toBe("Rooftop");
    expect(body.scene.cast[NATASHA].presence).toBe("here");
    expect(body.scene.cast[SERENITY].presence).toBe("away");
    expect(body.events.map((e: { metadata: { kind: string } }) => e.metadata.kind)).toEqual(["state", "exit"]);

    const typo = await (await call("POST", `/chat/sessions/${sessionId}/scene/command`, { text: "/scene , Bob" })).json();
    expect(typo).toMatchObject({ unresolved: ["Bob"], events: [], scene: { rev: 1 } });

    const castOnly = await (await call("POST", `/chat/sessions/${sessionId}/scene/command`, { text: "/scene , Serenity" })).json();
    expect(castOnly.scene).toMatchObject({ location: "Rooftop", rev: 2 });
    expect(castOnly.scene.cast[SERENITY].presence).toBe("here");
    expect(castOnly.scene.cast[NATASHA].presence).toBe("away");

    const locOnly = await (await call("POST", `/chat/sessions/${sessionId}/scene/command`, { text: "/scene Basement" })).json();
    expect(locOnly.scene.cast[SERENITY].presence).toBe("here");
    expect(locOnly.scene.location).toBe("Basement");

    expect((await call("POST", `/chat/sessions/${sessionId}/scene/command`, { text: "hello" })).status).toBe(400);
    const stale = await call("POST", `/chat/sessions/${sessionId}/scene/command`, { text: "/scene Attic", if_rev: 0 });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("scene_conflict");
  });

  it("solo sessions accept aspect keys (M7) by PATCH and by /scene", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { solo: SOLO_CHAR });
    const res = await (await call("POST", `/chat/sessions/${sessionId}/scene/command`, { text: "/scene , Scarlet, shadow" })).json();
    expect(res.scene.cast["aspect:shadow"].presence).toBe("here");
    expect(res.scene.cast["aspect:angel"]).toBeUndefined();
    // Aspects share one voice/memory; the solo scene stays solo for the gate.
    expect(res.scene.adult_gated).toBe(false);
    const group = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const bad = await call("PATCH", `/chat/sessions/${group}/scene`, { cast: { "aspect:shadow": { presence: "here" } } });
    expect((await bad.json()).error).toBe("aspect_not_allowed");
  });

  it("the generic store cannot forge the scene (it lives in chat_sessions)", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    const forged = await call("PUT", `/store/ChatSession/${sessionId}`, {
      scene: { rev: 99, cast: { [NATASHA]: { presence: "away" } } },
      metadata: { scene: { rev: 99 } },
    });
    expect(forged.status).toBe(200);
    const scene = await (await call("GET", `/chat/sessions/${sessionId}/scene`)).json();
    expect(scene.rev).toBe(0);
    expect(scene.cast[NATASHA].presence).toBe("here");
  });

  it("a chat turn's syncTypedSession keeps the scene", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    await call("PATCH", `/chat/sessions/${sessionId}/scene`, { location: "Rooftop" });
    await syncTypedSession({
      userId: userA,
      sessionId,
      title: "t",
      mode: "group",
      characterIds: [NATASHA, SERENITY],
      isCrossover: false,
      metadata: { source: "chat_api", turn_id: "t9" },
    });
    const row = await typedRow(sessionId);
    expect(row?.metadata).toMatchObject({ source: "chat_api", turn_id: "t9", scene: { rev: 1, location: "Rooftop" } });
    const scene = await (await call("GET", `/chat/sessions/${sessionId}/scene`)).json();
    expect(scene).toMatchObject({ rev: 1, location: "Rooftop" });
  });

  it("GET /context adds scenes_enabled and adult_gated, and keeps event rows out of recent_messages", async () => {
    flagOn();
    const sessionId = await seedSession(userA, { group: [NATASHA, SERENITY] });
    await call("POST", "/store/messages", { session_id: sessionId, message: { role: "user", content: "hi" } });
    await call("PATCH", `/chat/sessions/${sessionId}/scene`, { cast: { [SERENITY]: { presence: "away" } } });
    const ctx = await (await call("GET", `/chat/sessions/${sessionId}/context`)).json();
    expect(ctx.scenes_enabled).toBe(true);
    expect(ctx.adult_gated).toBe(false);
    expect(ctx.recent_messages.map((m: { role: string }) => m.role)).toEqual(["user"]);
    // Crossover (2 universes) is gated even with one character present.
    await seedCharacter(userA, `${PREFIX}other_u`, "Ada", "Other");
    const cross = await seedSession(userA, { group: [NATASHA, `${PREFIX}other_u`] });
    await call("PATCH", `/chat/sessions/${cross}/scene`, { cast: { [`${PREFIX}other_u`]: { presence: "away" } } });
    expect((await (await call("GET", `/chat/sessions/${cross}/context`)).json()).adult_gated).toBe(true);
  });
});
