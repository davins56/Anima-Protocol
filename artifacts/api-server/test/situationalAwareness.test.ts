/**
 * #763 PR 2: awareness (heard_by), tombstone-backed restore and privacy on
 * every write and recall path. Real chat + store routers, real Postgres
 * (disposable schema from setup-db.ts). The model is mocked only so the
 * FINAL prompt each character receives can be asserted.
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

const llm = vi.hoisted(() => ({ reply: "ok", prompts: [] as string[] }));
vi.mock("../src/lib/llmFailover", () => ({
  createChatStreamWithFailover: async (req: { messages?: Array<{ content?: unknown }> }) => {
    llm.prompts.push((req.messages ?? []).map((m) => String(m.content ?? "")).join("\n---\n"));
    const text = llm.reply;
    return {
      stream: (async function* () {
        yield { choices: [{ delta: { content: text } }] };
      })(),
      model: "test-anima",
      tier: "standard",
      provider: "local",
      brand: "anima",
      failedOver: false,
    };
  },
  createChatCompletionWithFailover: async () => ({
    content: "ok",
    model: "test-anima",
    tier: "light",
    provider: "local",
    brand: "anima",
    failedOver: false,
  }),
  usesFreeTierOpenBudget: () => false,
  isOpenRouterAlreadyFreeTier: () => false,
  isOpenRouterGenericProviderError: () => false,
  isOpenRouterZdrOrDataPolicyError: () => false,
  isLocalOnlyProviderChain: () => true,
  isWorkerSubrequestLimitError: () => false,
  localOnlyTimeoutMessage: () => "timeout",
  OPENROUTER_FREE_PROVIDER_HINT: "",
  OPENROUTER_ZDR_PRIVACY_HINT: "",
  LOCAL_LLM_SUBREQUEST_HINT: "",
  remapGenericProviderError: (err: Error) => err,
}));
vi.mock("../src/lib/localLlmWarm", () => ({ hintLocalLlmWarm: vi.fn() }));
vi.mock("../src/lib/localEnsemble", () => ({
  isLocalEnsembleEnabled: () => false,
  draftLocalMinds: vi.fn(),
  combineLocalDrafts: vi.fn(),
}));

import chatRouter from "../src/routes/chat";
import storeRouter from "../src/routes/store";
import {
  CHAT_MESSAGE,
  chatSessions,
  chatTurns,
  companionMemories,
  db,
  ensureSchemaOnce,
  getPool,
  userEntities,
  userProfiles,
} from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";
import {
  AWAY_GAP_NOTE,
  TOMBSTONE_CAP,
  classifyHeardBy,
  heardByCharacter,
  historyForCharacter,
  liveTombstones,
  mentionedCastIds,
  readHeardBy,
  restoredHeardBy,
  rowDigest,
  sharedFactsHeardBy,
  tombstoneFor,
  withTombstones,
} from "../src/lib/scenes/awareness";
import { turnListeners } from "../src/lib/scenes/awarenessStore";
import { clientTurnMetadata } from "../src/lib/replyReplacement";

const P = `aware_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const userA = `${P}a`;
const userB = `${P}b`;
const NAT = `${P}nat`;
const SER = `${P}ser`;
const AEL = `${P}ael`;
const B_CHAR = `${P}bchar`;
const CAST = [NAT, SER, AEL];
const NAMES: Record<string, string> = { [NAT]: "Natasha", [SER]: "Serenity", [AEL]: "Aeland" };

let server: Server;
let base = "";
let n = 0;

async function call(method: string, path: string, body?: unknown, user: string = userA) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": user },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function seedSession(user = userA, cast = CAST): Promise<string> {
  n += 1;
  const id = `${P}sess${n}`;
  await db.insert(userEntities).values({
    userId: user,
    entityName: "ChatSession",
    entityId: id,
    data: { id, title: "Group", mode: "group", group_character_ids: cast, messages: [], messages_migrated: true },
  });
  return id;
}

async function patch(sessionId: string, cast: Record<string, unknown>) {
  const res = await call("PATCH", `/chat/sessions/${sessionId}/scene`, { cast });
  if (res.status !== 200) throw new Error(`patch ${res.status}: ${await res.text()}`);
  return res.json();
}

async function append(sessionId: string, message: Record<string, unknown>, user = userA) {
  const res = await call("POST", "/store/messages", { session_id: sessionId, message }, user);
  if (res.status !== 201) throw new Error(`append ${res.status}: ${await res.text()}`);
  return (await res.json()) as Record<string, any>;
}

async function stored(sessionId: string, user = userA): Promise<Record<string, any>[]> {
  const rows = await db
    .select({ data: userEntities.data })
    .from(userEntities)
    .where(and(eq(userEntities.userId, user), eq(userEntities.entityName, CHAT_MESSAGE), sql`${userEntities.data}->>'session_id' = ${sessionId}`));
  return rows.map((r) => r.data as Record<string, any>).sort((a, b) => Number(a.seq) - Number(b.seq));
}

async function storedRow(sessionId: string, id: string) {
  return (await stored(sessionId)).find((m) => m.id === id);
}

async function tombstones(sessionId: string, user = userA): Promise<Record<string, any>> {
  const [row] = await db
    .select({ metadata: chatSessions.metadata })
    .from(chatSessions)
    .where(and(eq(chatSessions.id, sessionId), eq(chatSessions.userId, user)));
  return ((row?.metadata ?? {}) as Record<string, any>).awareness_tombstones ?? {};
}

/** One client-owned turn exactly as Chat.jsx sends it; returns the final prompt. */
async function turn(sessionId: string, speaker: string, content: string, opts: { commit?: boolean } = {}) {
  n += 1;
  const turnId = `${P}turn${n}`;
  llm.prompts = [];
  llm.reply = `Reply by ${NAMES[speaker]} ${n}`;
  const res = await call("POST", "/chat/messages", {
    turn_id: turnId,
    session_id: sessionId,
    content,
    character_ids: CAST,
    assistant_character_id: speaker,
    assistant_character_name: NAMES[speaker],
    use_scene_mind: false,
    mode: "group",
    persist: false,
    persistence_owner: "client",
    // A client transcript the server must not trust with scenes on.
    system_prompt: `Continue this story naturally:\nUser: CLIENT-TRANSCRIPT-LEAK\n`,
    region: { share_region: false },
  });
  expect(res.status).toBe(200);
  const text = await res.text();
  expect(text).toContain('"done":true');
  if (opts.commit) {
    await append(sessionId, { id: `${turnId}:user`, role: "user", content, turn_id: turnId, metadata: { heard_by: [AEL], turn_id: turnId } });
    await append(sessionId, { id: `${turnId}:assistant`, role: "assistant", content: llm.reply, character_id: speaker, character_name: NAMES[speaker], turn_id: turnId, metadata: { turn_id: turnId } });
    const commit = await call("POST", `/chat/turns/${turnId}/commit`, {});
    expect(commit.status).toBe(200);
  }
  return { turnId, prompt: llm.prompts.join("\n=====\n"), reply: llm.reply };
}

async function waitFor(pred: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 150));
  }
}

async function memoryFacts(characterId: string): Promise<string[]> {
  const [row] = await db
    .select({ facts: companionMemories.facts })
    .from(companionMemories)
    .where(and(eq(companionMemories.userId, userA), eq(companionMemories.characterId, characterId)));
  return ((row?.facts as any[]) ?? []).map((f) => String(f.text ?? ""));
}

async function embeddingTexts(characterId: string): Promise<string[]> {
  const r = await getPool()
    .query(`SELECT text FROM memory_embeddings WHERE user_id = $1 AND character_id = $2`, [userA, characterId])
    .catch(() => ({ rows: [] as Array<{ text: string }> }));
  return (r.rows as Array<{ text: string }>).map((x) => x.text);
}

function flag(on: boolean) {
  if (on) process.env.ANIMA_SITUATIONAL_SCENES = "on";
  else delete process.env.ANIMA_SITUATIONAL_SCENES;
}

beforeAll(async () => {
  await ensureSchemaOnce();
  await db.insert(userProfiles).values({ userId: userA, data: { display_name: "Mara" } });
  for (const id of CAST) {
    await db.insert(userEntities).values({ userId: userA, entityName: "Character", entityId: id, data: { id, name: NAMES[id], universe: "Anima", personality: "test" } });
  }
  await db.insert(userEntities).values({ userId: userB, entityName: "Character", entityId: B_CHAR, data: { id: B_CHAR, name: "Intruder", universe: "Anima" } });
  const app: Express = express();
  app.use(express.json({ limit: "4mb" }));
  app.use((req, _res, next) => {
    (req as any).userId = req.headers["x-test-user"];
    next();
  });
  app.use("/store", storeRouter);
  app.use("/chat", chatRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(() => flag(false));

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(userEntities).where(like(userEntities.userId, `${P}%`));
  await db.delete(chatSessions).where(like(chatSessions.userId, `${P}%`));
  await db.delete(chatTurns).where(like(chatTurns.userId, `${P}%`));
  await db.delete(companionMemories).where(like(companionMemories.userId, `${P}%`));
  await db.delete(userProfiles).where(like(userProfiles.userId, `${P}%`));
  await getPool().query(`DELETE FROM memory_embeddings WHERE user_id LIKE $1`, [`${P}%`]).catch(() => {});
});

// ---------------------------------------------------------------- pure rules
describe("awareness rules (pure)", () => {
  const cast = [NAT, SER, AEL];
  it("absent = legacy (stored cast only), [] = nobody, malformed = nobody", () => {
    expect(readHeardBy({ content: "x" })).toEqual({ kind: "legacy" });
    expect(readHeardBy({ metadata: { heard_by: [] } })).toEqual({ kind: "list", ids: [] });
    for (const bad of ["oops", 3, null, [1], [""], { a: 1 }, Array(65).fill("x")]) {
      expect(readHeardBy({ metadata: { heard_by: bad } }).kind, JSON.stringify(bad)).toBe("malformed");
    }
    expect(readHeardBy({ metadata: "junk" }).kind).toBe("malformed");
    expect(heardByCharacter({ content: "legacy" }, AEL, cast)).toBe(true);
    expect(heardByCharacter({ content: "legacy" }, B_CHAR, cast)).toBe(false);
    expect(heardByCharacter({ metadata: { heard_by: [] } }, NAT, cast)).toBe(false);
    expect(heardByCharacter({ metadata: { heard_by: "oops" } }, NAT, cast)).toBe(false);
    // Cross-user id: listed, but not in this session's stored cast.
    expect(heardByCharacter({ metadata: { heard_by: [B_CHAR] } }, B_CHAR, cast)).toBe(false);
  });

  it("history drops unheard rows and adds one M12 note with no gap content", () => {
    const rows = [
      { id: "1", role: "user", content: "all", metadata: { heard_by: cast } },
      { id: "2", role: "user", content: "secret", metadata: { heard_by: [NAT] } },
      { id: "e", role: "event", content: "Aeland steps away.", metadata: { heard_by: cast } },
      { id: "3", role: "user", content: "back", metadata: { heard_by: cast } },
    ];
    const h = historyForCharacter(rows, AEL, cast);
    expect(h.rows.map((r) => r.id)).toEqual(["1", "3"]);
    expect(h.rows[1]!.content).toBe(`${AWAY_GAP_NOTE}\n\nback`);
    expect(JSON.stringify(h.rows)).not.toContain("secret");
    const trailing = historyForCharacter(rows.slice(0, 2), AEL, cast);
    expect(trailing.trailingGapNote).toBe(AWAY_GAP_NOTE);
    expect(historyForCharacter(rows, NAT, cast).rows.map((r) => r.id)).toEqual(["1", "2", "3"]);
  });

  it("@mentions resolve to cast ids, longest name first", () => {
    const names = new Map([[NAT, "Natasha"], [SER, "Ser"], [AEL, "Serenity"]]);
    expect(mentionedCastIds("hey @serenity and @natasha!", names).sort()).toEqual([AEL, NAT].sort());
    expect(mentionedCastIds("no mentions", names)).toEqual([]);
  });

  it("tombstones: bound to session + id + content, capped at 50, 7-day expiry", () => {
    const now = new Date("2026-11-20T00:00:00Z");
    const row = { id: "m1", role: "user", content: "hello", metadata: { heard_by: [NAT] } };
    const t = tombstoneFor(row, "s1", now.toISOString());
    expect(t).toMatchObject({ session_id: "s1", message_id: "m1", heard_by: [NAT], digest: rowDigest(row) });
    expect(restoredHeardBy(row, t)).toEqual([NAT]);
    expect(restoredHeardBy({ ...row, content: "hello, edited" }, t)).toEqual([]);
    expect(restoredHeardBy(row, undefined)).toEqual([]);
    // Bound to the session: another session's map never yields it.
    expect(liveTombstones({ m1: t }, "s2", now)).toEqual({});
    const old = { ...t, deleted_at: new Date(now.getTime() - 8 * 86400e3).toISOString() };
    expect(liveTombstones({ m1: old }, "s1", now)).toEqual({});
    const many = Array.from({ length: 60 }, (_, i) =>
      tombstoneFor({ id: `m${i}`, role: "user", content: String(i) }, "s1", new Date(now.getTime() - (60 - i) * 1000).toISOString()),
    );
    const kept = withTombstones({}, "s1", many, now);
    expect(Object.keys(kept)).toHaveLength(TOMBSTONE_CAP);
    expect(kept.m0).toBeUndefined();
    expect(kept.m59).toBeDefined();
  });

  it("shared facts and turn listeners follow the stamps; client metadata cannot carry them", () => {
    const facts = [{ text: "legacy" }, { text: "pair", heard_by: [NAT, SER] }, { text: "none", heard_by: [] }, { text: "bad", heard_by: "x" }];
    expect((sharedFactsHeardBy(facts, AEL, CAST) as any[]).map((f) => f.text)).toEqual(["legacy"]);
    expect((sharedFactsHeardBy(facts, NAT, CAST) as any[]).map((f) => f.text)).toEqual(["legacy", "pair"]);
    expect(sharedFactsHeardBy(facts, B_CHAR, CAST)).toEqual([]);
    expect(turnListeners([NAT, AEL, B_CHAR], { cast: CAST, user: [NAT], assistant: [NAT, SER] })).toEqual([
      { id: NAT, user: true, reply: true },
    ]);
    expect(turnListeners([NAT], null)).toEqual([{ id: NAT, user: true, reply: true }]);
    expect(clientTurnMetadata({ scene_awareness: { cast: [AEL], user: [AEL] }, source: "x" })).toEqual({ source: "x" });
    expect(classifyHeardBy([NAT, NAT])).toEqual({ kind: "list", ids: [NAT] });
  });
});

// ------------------------------------------------------------- write paths
describe("flag on: every write path stamps heard_by on the server", () => {
  it("append ignores a forged client stamp; here + @mentioned reachable listeners", async () => {
    flag(true);
    const s = await seedSession();
    await patch(s, { [AEL]: { presence: "away", reach: "phone" } });
    const forged = await append(s, { role: "user", content: "only the room", metadata: { heard_by: [AEL] }, heard_by: [AEL] });
    expect(forged.metadata.heard_by.sort()).toEqual([NAT, SER].sort());
    expect(forged.heard_by).toBeUndefined();
    const mention = await append(s, { role: "user", content: "@Aeland can you hear me?" });
    expect(mention.metadata.heard_by.sort()).toEqual([NAT, SER, AEL].sort());
    await patch(s, { [AEL]: { presence: "asleep", reach: "none" } });
    const asleep = await append(s, { role: "user", content: "@Aeland wake up" });
    expect(asleep.metadata.heard_by.sort()).toEqual([NAT, SER].sort());
  });

  it("a turn row takes the stamp from the moment the turn started (ledger), not the append time", async () => {
    flag(true);
    const s = await seedSession();
    const t = await turn(s, NAT, "said while everyone is here");
    await patch(s, { [AEL]: { presence: "away" } });
    const user = await append(s, { id: `${t.turnId}:user`, role: "user", content: "said while everyone is here", metadata: { heard_by: [] } });
    expect(user.metadata.heard_by.sort()).toEqual(CAST.slice().sort());
    const [ledger] = await db.select({ metadata: chatTurns.metadata }).from(chatTurns).where(eq(chatTurns.id, t.turnId));
    expect((ledger!.metadata as any).scene_awareness.user.sort()).toEqual(CAST.slice().sort());
  });

  it("R1: delete writes the tombstone atomically; restore after a cast change keeps the original set", async () => {
    flag(true);
    const s = await seedSession();
    await patch(s, { [AEL]: { presence: "away" } });
    const secret = await append(s, { role: "user", content: "the plan, Aeland must not know" });
    const del = await call("DELETE", `/store/messages/${encodeURIComponent(secret.id)}?session_id=${s}`);
    expect(del.status).toBe(200);
    const ts = await tombstones(s);
    expect(ts[secret.id]).toMatchObject({ session_id: s, message_id: secret.id, digest: rowDigest(secret) });
    expect(ts[secret.id].heard_by.sort()).toEqual([NAT, SER].sort());
    await patch(s, { [AEL]: { presence: "here" } });
    const res = await call("POST", "/store/messages/restore", { session_id: s, message: { ...secret, metadata: { heard_by: CAST } } });
    expect(res.status).toBe(201);
    const restored = await storedRow(s, secret.id);
    expect(restored!.metadata.heard_by.sort()).toEqual([NAT, SER].sort());
    expect((await tombstones(s))[secret.id]).toBeUndefined();
    // Final prompt for Aeland (now here) still lacks it; Natasha's has it.
    const ael = await turn(s, AEL, "what did I miss?");
    expect(ael.prompt).not.toContain("Aeland must not know");
    expect(ael.prompt).not.toContain("CLIENT-TRANSCRIPT-LEAK");
    const nat = await turn(s, NAT, "remind me");
    expect(nat.prompt).toContain("Aeland must not know");
  });

  it("edited restore, expired tombstone and evicted tombstone all give heard_by []", async () => {
    flag(true);
    const s = await seedSession();
    const a = await append(s, { role: "user", content: "original words" });
    await call("DELETE", `/store/messages/${encodeURIComponent(a.id)}?session_id=${s}`);
    await call("POST", "/store/messages/restore", { session_id: s, message: { ...a, content: "original words, plus a new secret" } });
    expect((await storedRow(s, a.id))!.metadata.heard_by).toEqual([]);

    const b = await append(s, { role: "user", content: "will expire" });
    await call("DELETE", `/store/messages/${encodeURIComponent(b.id)}?session_id=${s}`);
    const ts = await tombstones(s);
    ts[b.id].deleted_at = new Date(Date.now() - 8 * 86400e3).toISOString();
    await db
      .update(chatSessions)
      .set({ metadata: sql`${chatSessions.metadata} || jsonb_build_object('awareness_tombstones', ${JSON.stringify(ts)}::jsonb)` })
      .where(eq(chatSessions.id, s));
    await call("POST", "/store/messages/restore", { session_id: s, message: b });
    expect((await storedRow(s, b.id))!.metadata.heard_by).toEqual([]);

    const first = await append(s, { role: "user", content: "evicted first" });
    await call("DELETE", `/store/messages/${encodeURIComponent(first.id)}?session_id=${s}`);
    for (let i = 0; i < TOMBSTONE_CAP; i += 1) {
      const m = await append(s, { role: "user", content: `filler ${i}` });
      await call("DELETE", `/store/messages/${encodeURIComponent(m.id)}?session_id=${s}`);
    }
    expect(Object.keys(await tombstones(s)).length).toBeLessThanOrEqual(TOMBSTONE_CAP);
    await call("POST", "/store/messages/restore", { session_id: s, message: first });
    expect((await storedRow(s, first.id))!.metadata.heard_by).toEqual([]);
    // [] reaches the final prompt as "nobody heard it".
    const t = await turn(s, NAT, "anything?");
    expect(t.prompt).not.toContain("evicted first");
    expect(t.prompt).not.toContain("plus a new secret");
  });

  it("replace: edits keep the stored stamp byte-for-byte; new ids are stamped; trimmed rows leave tombstones", async () => {
    flag(true);
    const s = await seedSession();
    await patch(s, { [AEL]: { presence: "away" } });
    const a = await append(s, { role: "user", content: "before edit" });
    const b = await append(s, { role: "user", content: "will be trimmed" });
    await patch(s, { [AEL]: { presence: "here" } });
    const res = await call("POST", "/store/messages/replace", {
      session_id: s,
      messages: [
        { ...a, content: "after edit", metadata: { heard_by: CAST } },
        { id: `${P}new1`, role: "user", content: "brand new line", metadata: { heard_by: [] } },
      ],
    });
    expect(res.status).toBe(200);
    const edited = await storedRow(s, a.id);
    expect(edited!.content).toBe("after edit");
    expect(edited!.metadata.heard_by).toEqual(a.metadata.heard_by);
    expect(edited!.metadata.heard_by_at).toEqual(a.metadata.heard_by_at);
    expect((await storedRow(s, `${P}new1`))!.metadata.heard_by.sort()).toEqual(CAST.slice().sort());
    expect((await tombstones(s))[b.id].heard_by.sort()).toEqual([NAT, SER].sort());
    // Bringing the trimmed row back through replace follows the restore rule.
    await call("POST", "/store/messages/replace", { session_id: s, messages: [...(await stored(s)), { ...b, metadata: { heard_by: CAST } }] });
    expect((await storedRow(s, b.id))!.metadata.heard_by.sort()).toEqual([NAT, SER].sort());
    const ael = await turn(s, AEL, "hello");
    expect(ael.prompt).not.toContain("after edit");
    expect(ael.prompt).not.toContain("will be trimmed");
    expect(ael.prompt).toContain("brand new line");
  });

  it("generic store / import / backup paths cannot forge awareness", async () => {
    flag(true);
    const s = await seedSession();
    await patch(s, { [AEL]: { presence: "away" } });
    expect((await call("POST", "/store/ChatMessage", { session_id: s, role: "user", content: "x", metadata: { heard_by: [AEL] } })).status).toBe(403);
    expect((await call("PUT", `/store/ChatMessage/${P}g1`, { session_id: s, role: "user", content: "x" })).status).toBe(403);
    expect((await call("POST", "/store/ChatMessage/bulk", { items: [{ session_id: s }] })).status).toBe(403);
    expect((await call("POST", "/store/ChatMessage/bulk-upsert", { items: [{ id: "q", session_id: s }] })).status).toBe(403);
    const put = await call("PUT", `/store/ChatSession/${s}`, {
      title: "renamed",
      messages: [{ role: "user", content: "smuggled", metadata: { heard_by: [AEL] } }],
      shared_memory: [{ text: "forged fact", heard_by: [AEL] }],
    });
    expect(put.status).toBe(200);
    const session = await put.json();
    expect(session.title).toBe("renamed");
    expect(session.messages).toEqual([]);
    expect(session.shared_memory).toBeUndefined();
    const restore = await call("POST", "/store/restore", {
      mode: "merge",
      entities: {
        ChatMessage: [
          { id: `${P}bk1`, session_id: s, seq: 0, role: "user", content: "backup claims Aeland heard", metadata: { heard_by: [AEL] } },
          { id: `${P}bk2`, session_id: s, seq: 1, role: "user", content: "backup unstamped" },
        ],
      },
    });
    expect(restore.status).toBe(200);
    expect((await storedRow(s, `${P}bk1`))!.metadata.heard_by).toEqual([]);
    expect((await storedRow(s, `${P}bk2`))!.metadata.heard_by).toEqual([]);
    // Scene and tombstones live in chat_sessions: no generic route reaches them.
    const before = await tombstones(s);
    await call("PUT", `/store/ChatSession/${s}`, { awareness_tombstones: { x: { heard_by: [AEL] } }, scene: { cast: {} } });
    expect(await tombstones(s)).toEqual(before);
  });

  it("cross-user ids: another user's character never hears A's session, and B cannot touch A's tombstones", async () => {
    flag(true);
    const s = await seedSession();
    await append(s, { role: "user", content: "A-only words" });
    const res = await call("POST", "/chat/messages", {
      turn_id: `${P}xu1`,
      session_id: s,
      content: "hi",
      character_ids: [...CAST, B_CHAR],
      assistant_character_id: B_CHAR,
      mode: "group",
      persist: false,
      persistence_owner: "client",
    }, userA);
    expect(res.status).toBe(200);
    await res.text();
    expect(llm.prompts.join("\n")).not.toContain("A-only words");
    // B, using A's session id, gets its own (empty) world and cannot restore A's rows.
    const bs = await call("POST", "/store/messages/restore", { session_id: s, message: { id: "zz", role: "user", content: "x" } }, userB);
    expect([201, 404]).toContain(bs.status);
    expect((await stored(s)).some((m) => m.id === "zz")).toBe(false);
  });

  it("memory + embedding isolation: an absent character learns nothing from the turn", async () => {
    flag(true);
    const s = await seedSession();
    await patch(s, { [AEL]: { presence: "away" } });
    const t = await turn(s, NAT, "MEMORY-SECRET while Aeland is away", { commit: true });
    await waitFor(async () => (await memoryFacts(NAT)).some((f) => f.includes("MEMORY-SECRET")));
    expect((await memoryFacts(NAT)).some((f) => f.includes("MEMORY-SECRET"))).toBe(true);
    expect((await memoryFacts(SER)).some((f) => f.includes("MEMORY-SECRET"))).toBe(true);
    await new Promise((r) => setTimeout(r, 800));
    expect((await memoryFacts(AEL)).some((f) => f.includes("MEMORY-SECRET"))).toBe(false);
    expect((await embeddingTexts(AEL)).some((x) => x.includes("MEMORY-SECRET"))).toBe(false);
    // The client's forged stamp on its own user row was ignored (ledger stamp).
    expect((await storedRow(s, `${t.turnId}:user`))!.metadata.heard_by.sort()).toEqual([NAT, SER].sort());
    expect((await storedRow(s, `${t.turnId}:assistant`))!.metadata.heard_by.sort()).toEqual([NAT, SER].sort());
  });
});

// ----------------------------------------------------------- concurrency
describe("flag on: real concurrency on delete / replace / restore", () => {
  it("five concurrent restores of one deleted row: one row, the original stamp, tombstone consumed", async () => {
    flag(true);
    const s = await seedSession();
    await patch(s, { [AEL]: { presence: "away" } });
    const m = await append(s, { role: "user", content: "contested" });
    await call("DELETE", `/store/messages/${encodeURIComponent(m.id)}?session_id=${s}`);
    await patch(s, { [AEL]: { presence: "here" } });
    const results = await Promise.all(
      Array.from({ length: 5 }, () => call("POST", "/store/messages/restore", { session_id: s, message: { ...m, metadata: { heard_by: CAST } } })),
    );
    expect(results.every((r) => r.status === 201)).toBe(true);
    const rows = (await stored(s)).filter((r) => r.id === m.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.metadata.heard_by.sort()).toEqual([NAT, SER].sort());
    expect((await tombstones(s))[m.id]).toBeUndefined();
  });

  it("delete racing replace and restore: the row and its tombstone are never both live, and Aeland never gains it", async () => {
    flag(true);
    for (let round = 0; round < 4; round += 1) {
      const s = await seedSession();
      await patch(s, { [AEL]: { presence: "away" } });
      const m = await append(s, { role: "user", content: `race ${round}` });
      await patch(s, { [AEL]: { presence: "here" } });
      await Promise.all([
        call("DELETE", `/store/messages/${encodeURIComponent(m.id)}?session_id=${s}`),
        call("POST", "/store/messages/replace", { session_id: s, messages: [{ ...m, metadata: { heard_by: CAST } }] }),
        call("POST", "/store/messages/restore", { session_id: s, message: { ...m, metadata: { heard_by: CAST } } }),
      ]);
      const row = await storedRow(s, m.id);
      const ts = await tombstones(s);
      expect(Boolean(row) && Boolean(ts[m.id]), `round ${round}`).toBe(false);
      if (row) expect(row.metadata.heard_by).not.toContain(AEL);
      if (ts[m.id]) expect(ts[m.id].heard_by).not.toContain(AEL);
    }
  });

  it("an append racing a presence PATCH gets one consistent stamp (before or after, never mixed)", async () => {
    flag(true);
    const s = await seedSession();
    const [, appended] = await Promise.all([
      patch(s, { [AEL]: { presence: "away" }, [SER]: { presence: "away" } }),
      append(s, { role: "user", content: "racing line" }),
    ]);
    const stamp = (appended.metadata.heard_by as string[]).sort();
    expect([CAST.slice().sort(), [NAT]]).toContainEqual(stamp);
  });
});

// ----------------------------------------------------------- flag off
describe("flag off: byte-identical to main", () => {
  it("append, delete, restore and replace store exactly what the client sent; no tombstones", async () => {
    flag(false);
    const s = await seedSession();
    const msg = { role: "user", content: "flag off", metadata: { heard_by: [AEL], other: 1 }, heard_by: ["x"] };
    const a = await append(s, msg);
    expect(a.metadata).toEqual({ heard_by: [AEL], other: 1 });
    expect(a.heard_by).toEqual(["x"]);
    await call("DELETE", `/store/messages/${encodeURIComponent(a.id)}?session_id=${s}`);
    expect(await tombstones(s)).toEqual({});
    const r = await call("POST", "/store/messages/restore", { session_id: s, message: { ...a, metadata: { heard_by: ["anything"] } } });
    expect(r.status).toBe(201);
    expect((await storedRow(s, a.id))!.metadata).toEqual({ heard_by: ["anything"] });
    await call("POST", "/store/messages/replace", { session_id: s, messages: [{ ...a, metadata: { heard_by: [] } }] });
    expect((await storedRow(s, a.id))!.metadata).toEqual({ heard_by: [] });
    expect((await call("POST", "/store/ChatMessage", { session_id: s, role: "user", content: "generic" })).status).toBe(201);
  });

  it("the turn prompt ignores heard_by, keeps the client context, and the ledger has no scene_awareness", async () => {
    flag(false);
    const s = await seedSession();
    await append(s, { role: "user", content: "stamped nobody", metadata: { heard_by: [] } });
    const t = await turn(s, AEL, "hello");
    expect(t.prompt).toContain("stamped nobody");
    const [ledger] = await db.select({ metadata: chatTurns.metadata }).from(chatTurns).where(eq(chatTurns.id, t.turnId));
    expect((ledger!.metadata as any).scene_awareness).toBeUndefined();
  });

  it("generic ChatSession writes keep messages and shared_memory as before", async () => {
    flag(false);
    const s = await seedSession();
    const put = await call("PUT", `/store/ChatSession/${s}`, { shared_memory: [{ text: "kept" }] });
    expect((await put.json()).shared_memory).toEqual([{ text: "kept" }]);
  });
});
