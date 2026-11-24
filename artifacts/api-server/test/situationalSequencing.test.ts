/**
 * #763 PR 3: response sequencing. Plans bound to the scene rev (R2, 409
 * scene_plan_stale), eligibility and blocked / next_speaker, stage markers
 * held across chunks, zero-speaker turns (quiet and narrated), SSE ordering
 * and flag-off parity. Real chat router + Postgres; the model is mocked.
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

const llm = vi.hoisted(() => ({
  chunks: ["ok"] as string[],
  calls: 0,
  narration: "Wind moves through the antennae.",
  completions: 0,
}));
vi.mock("../src/lib/llmFailover", () => ({
  createChatStreamWithFailover: async () => {
    llm.calls += 1;
    const chunks = [...llm.chunks];
    return {
      stream: (async function* () {
        for (const c of chunks) yield { choices: [{ delta: { content: c } }] };
      })(),
      model: "test-anima",
      tier: "standard",
      provider: "local",
      brand: "anima",
      failedOver: false,
    };
  },
  createChatCompletionWithFailover: async () => {
    llm.completions += 1;
    return { content: llm.narration, model: "test-anima", tier: "light", provider: "local", brand: "anima", failedOver: false };
  },
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
import { CHAT_MESSAGE, chatSessions, chatTurns, db, ensureSchemaOnce, userEntities, userProfiles, companionMemories } from "@workspace/db";
import { and, eq, like, sql } from "drizzle-orm";
import {
  StageMarkerFilter,
  extractStageMarkers,
  markerCastPatch,
  planSpeakers,
  revalidateQueue,
  speakerEligible,
  type ScenePlan,
} from "../src/lib/scenes/scenePlan";
import { finishSceneTurn } from "../src/lib/scenes/scenePlanStore";
import { computeAdultGated, emptyScene, type SceneState } from "../src/lib/scenes/sceneState";

const P = `seq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const userA = `${P}a`;
const NAT = `${P}nat`;
const SER = `${P}ser`;
const AEL = `${P}ael`;
const SCA = `${P}sca`;
const CAST = [NAT, SER, AEL, SCA];
const NAMES: Record<string, string> = { [NAT]: "Natasha", [SER]: "Serenity", [AEL]: "Aeland", [SCA]: "Scarlet" };

let server: Server;
let base = "";
let n = 0;

type Frame = Record<string, any>;

async function call(method: string, path: string, body?: unknown) {
  return fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json", "x-test-user": userA },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

function frames(text: string): Frame[] {
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => Boolean(l))
    .map((l) => JSON.parse(l.slice(6)));
}

async function seedSession(cast = CAST, mode = "group"): Promise<string> {
  n += 1;
  const id = `${P}sess${n}`;
  await db.insert(userEntities).values({
    userId: userA,
    entityName: "ChatSession",
    entityId: id,
    data: mode === "group"
      ? { id, title: "Group", mode, group_character_ids: cast, messages: [], messages_migrated: true }
      : { id, title: "Solo", mode, character_id: cast[0], messages: [], messages_migrated: true },
  });
  return id;
}

async function patch(sessionId: string, partial: Record<string, unknown>) {
  const res = await call("PATCH", `/chat/sessions/${sessionId}/scene`, partial);
  if (res.status !== 200) throw new Error(`patch ${res.status}: ${await res.text()}`);
  return (await res.json()) as { scene: SceneState & { adult_gated: boolean } };
}

type TurnOpts = {
  speaker?: string;
  content?: string;
  chunks?: string[];
  scene?: Record<string, unknown>;
  isContinue?: boolean;
  castIds?: string[];
};

async function send(sessionId: string, opts: TurnOpts = {}) {
  n += 1;
  const turnId = `${P}turn${n}`;
  llm.chunks = opts.chunks ?? [`Line ${n}`];
  const callsBefore = llm.calls;
  const res = await call("POST", "/chat/messages", {
    turn_id: turnId,
    session_id: sessionId,
    content: opts.isContinue ? "(continue)" : opts.content ?? "Is anyone still up?",
    is_continue: Boolean(opts.isContinue),
    character_ids: opts.castIds ?? CAST,
    ...(opts.speaker ? { assistant_character_id: opts.speaker, assistant_character_name: NAMES[opts.speaker], force_character_id: opts.speaker } : {}),
    use_scene_mind: false,
    mode: "group",
    persist: false,
    persistence_owner: "client",
    region: { share_region: false },
    ...(opts.scene ?? {}),
  });
  const text = await res.text();
  return { status: res.status, text, frames: res.status === 200 ? frames(text) : [], json: res.status === 200 ? null : JSON.parse(text), turnId, modelCalls: llm.calls - callsBefore };
}

function doneOf(fs: Frame[]) {
  const d = fs.find((f) => f.done);
  if (!d) throw new Error(`no done frame: ${JSON.stringify(fs).slice(0, 400)}`);
  return d;
}

function streamed(fs: Frame[]) {
  return fs.filter((f) => typeof f.content === "string" && !f.done).map((f) => f.content).join("");
}

async function rawScene(sessionId: string): Promise<Record<string, any>> {
  const [row] = await db.select({ metadata: chatSessions.metadata }).from(chatSessions).where(eq(chatSessions.id, sessionId));
  return ((row?.metadata ?? {}) as Record<string, any>).scene ?? {};
}

async function setRawScene(sessionId: string, scene: Record<string, unknown>) {
  await db
    .update(chatSessions)
    .set({ metadata: sql`${chatSessions.metadata} || jsonb_build_object('scene', ${JSON.stringify(scene)}::jsonb)` })
    .where(eq(chatSessions.id, sessionId));
}

async function eventRows(sessionId: string) {
  const rows = await db
    .select({ data: userEntities.data })
    .from(userEntities)
    .where(and(eq(userEntities.userId, userA), eq(userEntities.entityName, CHAT_MESSAGE), sql`${userEntities.data}->>'session_id' = ${sessionId}`));
  return rows.map((r) => r.data as Record<string, any>).filter((m) => m.role === "event");
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
  const app: Express = express();
  app.use(express.json({ limit: "4mb" }));
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
});

// ------------------------------------------------------------------ pure
function sceneOf(cast: Record<string, Partial<SceneState["cast"][string]>>, extra: Partial<SceneState> = {}): SceneState {
  const s = emptyScene();
  for (const [id, e] of Object.entries(cast)) s.cast[id] = { presence: "here", reach: "none", since: null, note: null, ...e };
  return { ...s, ...extra };
}

describe("eligibility, planning and markers (pure)", () => {
  it("eligibility for each presence state", () => {
    const scene = sceneOf({
      a: { presence: "here" },
      b: { presence: "away", reach: "phone" },
      c: { presence: "away", reach: "none" },
      d: { presence: "asleep", reach: "phone" },
      e: { presence: "injured" },
      f: { presence: "busy", reach: "text" },
      g: { presence: "jacked_in" },
    });
    expect(speakerEligible(scene, "a", false)).toBe(true);
    expect(speakerEligible(scene, "b", false)).toBe(false);
    expect(speakerEligible(scene, "b", true)).toBe(true);
    for (const id of ["c", "d", "e", "f", "g"]) expect(speakerEligible(scene, id, true), id).toBe(false);
    expect(speakerEligible(scene, "not-in-cast", true)).toBe(false);
  });

  it("natural picks at most 2 (requested, then addressed); M5; everyone picks all eligible", () => {
    const scene = sceneOf({ a: {}, b: {}, c: {}, z: { presence: "asleep" } });
    const cast = ["a", "b", "c", "z"];
    expect(planSpeakers({ scene, cast, requested: "a", mentioned: ["b", "c", "z"], isContinue: false })).toEqual({
      speakers: [{ character_id: "a", reason: "forced" }, { character_id: "b", reason: "addressed" }],
      blocked: [{ id: "z", presence: "asleep" }],
      narrate: false,
    });
    // M5: the requested speaker is asleep; the user spoke, so someone answers.
    const m5 = planSpeakers({ scene, cast, requested: "z", mentioned: [], isContinue: false });
    expect(m5.speakers).toEqual([{ character_id: "a", reason: "picked" }]);
    expect(m5.blocked).toEqual([{ id: "z", presence: "asleep" }]);
    const everyone = planSpeakers({ scene: { ...scene, mode: "everyone" }, cast, requested: "b", mentioned: [], isContinue: false });
    expect(everyone.speakers.map((s) => s.character_id)).toEqual(["b", "a", "c"]);
    // Continue with nobody requested can be quiet; narrator never on a continue.
    expect(planSpeakers({ scene: { ...scene, narrator: true }, cast, requested: null, mentioned: [], isContinue: true })).toEqual({ speakers: [], blocked: [], narrate: false });
    const nobody = sceneOf({ z: { presence: "asleep" } }, { narrator: true });
    expect(planSpeakers({ scene: nobody, cast: ["z"], requested: null, mentioned: [], isContinue: false })).toEqual({ speakers: [], blocked: [], narrate: true });
  });

  it("revalidation skips speakers who can no longer answer and reports them blocked", () => {
    const plan: ScenePlan = { id: "p", rev: 1, queue: ["a", "b", "c"], reasons: ["forced", "addressed", "addressed"], addressed: ["b", "c"], index: 1, expires_at: new Date(Date.now() + 1e6).toISOString(), mode: "natural" };
    const scene = sceneOf({ a: {}, b: { presence: "asleep" }, c: { presence: "away", reach: "text" } });
    expect(revalidateQueue(plan, scene, 1)).toEqual({ index: 2, blocked: [{ id: "b", presence: "asleep" }] });
    expect(revalidateQueue(plan, sceneOf({ a: {}, b: { presence: "busy" }, c: { presence: "away" } }), 1)).toEqual({
      index: null,
      blocked: [{ id: "b", presence: "busy" }, { id: "c", presence: "away" }],
    });
  });

  it("the marker filter is chunk-invariant and stream == storage", () => {
    const reply = "Still up. I'll check on her [[exit]] and [[enter: Scarlet ]] maybe [[wave]] or [[ unclosed";
    const whole = extractStageMarkers(reply);
    expect(whole.visible).toBe("Still up. I'll check on her  and  maybe [[wave]] or [[ unclosed");
    expect(whole.markers).toEqual([{ kind: "exit" }, { kind: "enter", name: "Scarlet" }]);
    for (let trial = 0; trial < 200; trial += 1) {
      const f = new StageMarkerFilter();
      let out = "";
      let i = 0;
      while (i < reply.length) {
        const step = 1 + Math.floor(Math.random() * 7);
        const piece = f.push(reply.slice(i, i + step));
        // A recognized marker is never visible, even partially.
        expect(piece.includes("[[exit") || piece.includes("[[enter")).toBe(false);
        out += piece;
        i += step;
      }
      out += f.finish();
      expect(out).toBe(whole.visible);
      expect(f.markers).toEqual(whole.markers);
    }
    // Long brackets are text, not a held marker.
    const long = `[[${"x".repeat(100)}]]`;
    expect(extractStageMarkers(long).visible).toBe(long);
  });

  it("markers: only the speaker's own exit, only away->here entries, nothing while she is not here", () => {
    const names = new Map([["a", "Natasha"], ["b", "Serenity"], ["c", "Aeland"]]);
    const scene = sceneOf({ a: {}, b: { presence: "away" }, c: { presence: "asleep" } });
    expect(markerCastPatch({ markers: [{ kind: "exit" }, { kind: "enter", name: "serenity" }, { kind: "enter", name: "Aeland" }], scene, speakerId: "a", names })).toEqual({
      a: { presence: "away" },
      b: { presence: "here" },
    });
    expect(markerCastPatch({ markers: [{ kind: "exit" }], scene, speakerId: "b", names })).toBeNull();
    expect(markerCastPatch({ markers: [{ kind: "enter", name: "Aeland" }], scene, speakerId: "a", names })).toBeNull();
  });

  it("R3: the adult gate counts the stored cast, not just the ids a request lists", () => {
    expect(computeAdultGated({ rawScene: undefined, characterIds: ["a"], isCrossover: false })).toBe(false);
    expect(computeAdultGated({ rawScene: undefined, characterIds: [...new Set(["a", "a", "b"])], isCrossover: false })).toBe(true);
    expect(computeAdultGated({ rawScene: "unreadable", characterIds: ["a"], isCrossover: false })).toBe(true);
  });
});

// -------------------------------------------------------------- flag on
describe("flag on: plans, sequencing and stage markers over SSE", () => {
  it("two speakers: plan before content, marker held across chunks, event once, done carries scene / next_speaker / blocked", async () => {
    flag(true);
    const s = await seedSession();
    await patch(s, { cast: { [AEL]: { presence: "asleep" }, [SCA]: { presence: "away", reach: "phone" } } });
    const startRev = (await (await call("GET", `/chat/sessions/${s}/scene`)).json()).rev;
    const t = await send(s, {
      speaker: NAT,
      content: "@Serenity @Aeland is anyone still up?",
      chunks: ["Still up. ", "I'll check on her [[ex", "it]]"],
      scene: { if_rev: startRev },
    });
    expect(t.status).toBe(200);
    const fs = t.frames;
    const planAt = fs.findIndex((f) => f.scene_plan);
    const firstContent = fs.findIndex((f) => typeof f.content === "string" && !f.done);
    const eventAt = fs.findIndex((f) => f.scene_event);
    const doneAt = fs.findIndex((f) => f.done);
    expect(planAt).toBeGreaterThanOrEqual(0);
    expect(planAt).toBeLessThan(firstContent);
    expect(firstContent).toBeLessThan(eventAt);
    expect(eventAt).toBeLessThan(doneAt);
    const plan = fs[planAt]!.scene_plan;
    expect(plan.speakers).toEqual([{ character_id: NAT, reason: "forced" }, { character_id: SER, reason: "addressed" }]);
    expect(plan.blocked).toEqual([{ id: AEL, presence: "asleep" }]);
    expect(plan).toMatchObject({ narrate: false, mode: "natural" });
    expect(String(plan.id)).toMatch(/^plan_/);
    // Stream and storage carry the same visible text; no marker ever shown.
    const shown = streamed(fs);
    expect(shown).not.toContain("[[");
    const done = doneOf(fs);
    expect(done.visible).toBe("Still up. I'll check on her");
    expect(shown.trim()).toBe(done.visible);
    const [ledger] = await db.select({ assistantContent: chatTurns.assistantContent }).from(chatTurns).where(eq(chatTurns.id, t.turnId));
    expect(ledger!.assistantContent).toBe(done.visible);
    // Exactly one event row, streamed once, persisted once.
    const events = fs.filter((f) => f.scene_event).map((f) => f.scene_event);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ role: "event", metadata: { kind: "exit", character_id: NAT, presence: "away" } });
    expect((await eventRows(s)).filter((r) => r.id === events[0].id)).toHaveLength(1);
    expect(done.assistant_character_id).toBe(NAT);
    expect(done.scene.rev).toBe(startRev + 1);
    expect(done.scene.cast[NAT].presence).toBe("away");
    expect(done.scene.adult_gated).toBe(true);
    expect(done.next_speaker).toEqual({ character_id: SER, responder_index: 1 });
    expect(done.blocked).toEqual([{ id: AEL, presence: "asleep" }]);

    // Follow-up: if_rev from the latest done.scene; the plan's own exit did not make it stale.
    const f = await send(s, {
      isContinue: true,
      speaker: SER,
      chunks: ["I'm heading out too. [[exit]]"],
      scene: { if_rev: done.scene.rev, scene_plan_id: plan.id, responder_index: 1 },
    });
    expect(f.status).toBe(200);
    const fdone = doneOf(f.frames);
    expect(fdone.assistant_character_id).toBe(SER);
    expect(fdone.visible).toBe("I'm heading out too.");
    expect(fdone.next_speaker).toBeNull();
    expect(fdone.scene.rev).toBe(done.scene.rev + 1);
    expect(f.frames.filter((x) => x.scene_event)).toHaveLength(1);
    // The plan is finished: following it again is stale.
    const again = await send(s, { isContinue: true, speaker: SER, scene: { if_rev: fdone.scene.rev, scene_plan_id: plan.id, responder_index: 1 } });
    expect(again.status).toBe(409);
    expect(again.json.error).toBe("scene_plan_stale");
  });

  it("R2: a PATCH from another tab, a wrong plan id / index, an expired plan and a stale first-turn rev all 409 with the current scene, before any generation", async () => {
    flag(true);
    const s = await seedSession([NAT, SER]);
    const t = await send(s, { speaker: NAT, content: "@Serenity hi both", scene: { if_rev: 0 } });
    const done = doneOf(t.frames);
    const planId = t.frames.find((f) => f.scene_plan)!.scene_plan.id;
    expect(done.next_speaker).toEqual({ character_id: SER, responder_index: 1 });
    const follow = { if_rev: done.scene.rev, scene_plan_id: planId, responder_index: 1 };
    for (const bad of [
      { ...follow, scene_plan_id: "plan_other" },
      { ...follow, responder_index: 0 },
      { ...follow, responder_index: 5 },
      { ...follow, if_rev: done.scene.rev + 3 },
    ]) {
      const r = await send(s, { isContinue: true, speaker: SER, scene: bad });
      expect(r.status, JSON.stringify(bad)).toBe(409);
      expect(r.json.error).toBe("scene_plan_stale");
      expect(r.json.scene.rev).toBe(done.scene.rev);
      expect(r.modelCalls).toBe(0);
    }
    // Expired plan.
    const raw = await rawScene(s);
    await setRawScene(s, { ...raw, plan: { ...raw.plan, expires_at: new Date(Date.now() - 1000).toISOString() } });
    const expired = await send(s, { isContinue: true, speaker: SER, scene: follow });
    expect(expired.status).toBe(409);
    await setRawScene(s, raw);
    // Another tab sends Serenity away: rev moves, the plan is stale.
    const patched = await patch(s, { cast: { [SER]: { presence: "away" } } });
    const stale = await send(s, { isContinue: true, speaker: SER, scene: follow });
    expect(stale.status).toBe(409);
    expect(stale.json).toMatchObject({ error: "scene_plan_stale", scene: { rev: patched.scene.rev } });
    expect(stale.json.scene.cast[SER].presence).toBe("away");
    expect(stale.json.scene).toHaveProperty("adult_gated");
    expect(stale.modelCalls).toBe(0);
    // A first turn with an old if_rev is stale too (the client re-plans once).
    const first = await send(s, { speaker: NAT, scene: { if_rev: done.scene.rev } });
    expect(first.status).toBe(409);
    // Re-planned with the current rev: Serenity (away, unaddressed reach none) is not in it.
    const replanned = await send(s, { speaker: NAT, content: "@Serenity you there?", scene: { if_rev: patched.scene.rev } });
    const rp = replanned.frames.find((f) => f.scene_plan)!.scene_plan;
    expect(rp.speakers).toEqual([{ character_id: NAT, reason: "forced" }]);
    expect(rp.blocked).toEqual([{ id: SER, presence: "away" }]);
  });

  it("a queued speaker who can no longer answer is skipped (no 409): blocked, and next_speaker follows the revalidated queue", async () => {
    flag(true);
    const s = await seedSession([NAT, SER, AEL]);
    const t = await send(s, { speaker: NAT, content: "@Serenity @Aeland morning", scene: { if_rev: 0 } });
    const plan = t.frames.find((f) => f.scene_plan)!.scene_plan;
    expect(plan.speakers.map((x: any) => x.character_id)).toEqual([NAT, SER]);
    // Simulate an eligibility change that did not move the rev (the only
    // rev-neutral path is the plan's own markers), by editing the stored cast.
    const raw = await rawScene(s);
    await setRawScene(s, { ...raw, cast: { ...(raw.cast ?? {}), [SER]: { presence: "asleep", reach: "none", since: null, note: null } } });
    const done = doneOf(t.frames);
    const f = await send(s, { isContinue: true, speaker: SER, scene: { if_rev: done.scene.rev, scene_plan_id: plan.id, responder_index: 1 } });
    expect(f.status).toBe(200);
    // Nobody left: a zero-speaker frame, no model call, blocked names her.
    expect(f.modelCalls).toBe(0);
    expect(f.frames.find((x) => x.scene_plan)!.scene_plan.speakers).toEqual([]);
    const fdone = doneOf(f.frames);
    expect(fdone).toMatchObject({ visible: "", next_speaker: null, blocked: [{ id: SER, presence: "asleep" }] });
  });

  it("markers from a speaker whose plan went stale mid-reply change nothing", async () => {
    flag(true);
    const s = await seedSession([NAT, SER]);
    const t = await send(s, { speaker: NAT, content: "@Serenity hi", scene: { if_rev: 0 } });
    const plan = t.frames.find((f) => f.scene_plan)!.scene_plan;
    const before = await rawScene(s);
    const res = await finishSceneTurn({ userId: userA, sessionId: s, speakerId: SER, planId: "plan_not_this_one", responderIndex: 1, markers: [{ kind: "exit" }], blocked: [] });
    expect(res!.events).toEqual([]);
    expect(res!.next_speaker).toBeNull();
    expect((await rawScene(s)).rev).toBe(before.rev);
    expect((await rawScene(s)).plan.id).toBe(plan.id);
  });

  it("[[enter:Name]] brings an away cast member back; asleep stays asleep; unknown [[…]] stays as text", async () => {
    flag(true);
    const s = await seedSession([NAT, SER, AEL]);
    const p = await patch(s, { cast: { [SER]: { presence: "away" }, [AEL]: { presence: "asleep" } } });
    const t = await send(s, { speaker: NAT, chunks: ["Look who's here [[enter:", "Serenity]] [[enter:Aeland]] [[wave]]"], scene: { if_rev: p.scene.rev } });
    const done = doneOf(t.frames);
    expect(done.visible).toBe("Look who's here   [[wave]]");
    expect(streamed(t.frames).trim()).toBe(done.visible);
    expect(done.scene.cast[SER].presence).toBe("here");
    expect(done.scene.cast[AEL].presence).toBe("asleep");
    const events = t.frames.filter((f) => f.scene_event);
    expect(events.map((e) => e.scene_event.metadata.kind)).toEqual(["enter"]);
    expect(new Set(events.map((e) => e.scene_event.id)).size).toBe(events.length);
  });

  it("zero speakers (quiet): plan frame with speakers [], done visible '', no model call, commit 200, the user line stamped", async () => {
    flag(true);
    const s = await seedSession([NAT, SER]);
    const p = await patch(s, { cast: { [NAT]: { presence: "asleep" }, [SER]: { presence: "away" } } });
    const t = await send(s, { speaker: NAT, content: "@Natasha are you awake?", scene: { if_rev: p.scene.rev } });
    expect(t.status).toBe(200);
    expect(t.modelCalls).toBe(0);
    expect(t.frames.filter((f) => typeof f.content === "string")).toEqual([]);
    const plan = t.frames.find((f) => f.scene_plan)!.scene_plan;
    expect(plan).toMatchObject({ speakers: [], blocked: [{ id: NAT, presence: "asleep" }], narrate: false });
    const done = doneOf(t.frames);
    expect(done).toMatchObject({ visible: "", next_speaker: null, persistence_status: "committed" });
    expect(done.scene.rev).toBe(p.scene.rev);
    // The client keeps the user's line and commits it.
    const appended = await call("POST", "/store/messages", { session_id: s, message: { id: `${t.turnId}:user`, role: "user", content: "@Natasha are you awake?" } });
    expect(appended.status).toBe(201);
    expect((await appended.json()).metadata.heard_by).toEqual([]);
    expect((await call("POST", `/chat/turns/${t.turnId}/commit`, {})).status).toBe(200);
  });

  it("zero speakers (narrated): one narration row heard by whoever is here, streamed once, one extra model call", async () => {
    flag(true);
    const s = await seedSession([NAT, SER]);
    const p = await patch(s, { narrator: true, location: "Rooftop", cast: { [NAT]: { presence: "asleep" }, [SER]: { presence: "away" } } });
    const completions = llm.completions;
    const t = await send(s, { content: "Hello?", scene: { if_rev: p.scene.rev } });
    expect(t.modelCalls).toBe(0);
    expect(llm.completions - completions).toBe(1);
    expect(t.frames.find((f) => f.scene_plan)!.scene_plan).toMatchObject({ speakers: [], narrate: true });
    const events = t.frames.filter((f) => f.scene_event).map((f) => f.scene_event);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ role: "event", content: "Wind moves through the antennae.", metadata: { kind: "narration", heard_by: [] } });
    expect(doneOf(t.frames)).toMatchObject({ visible: "", next_speaker: null });
  });

  it("everyone mode queues every eligible character; the requested one first", async () => {
    flag(true);
    const s = await seedSession([NAT, SER, AEL]);
    const p = await patch(s, { mode: "everyone", cast: { [AEL]: { presence: "busy" } } });
    const t = await send(s, { speaker: SER, scene: { if_rev: p.scene.rev } });
    const plan = t.frames.find((f) => f.scene_plan)!.scene_plan;
    expect(plan.speakers.map((x: any) => x.character_id)).toEqual([SER, NAT]);
    expect(plan.mode).toBe("everyone");
    expect(doneOf(t.frames).next_speaker).toEqual({ character_id: NAT, responder_index: 1 });
  });

  it("an ineligible requested speaker is replaced by the plan's speaker (done.assistant_character_id says who)", async () => {
    flag(true);
    const s = await seedSession([NAT, SER]);
    const p = await patch(s, { cast: { [NAT]: { presence: "asleep" } } });
    const t = await send(s, { speaker: NAT, scene: { if_rev: p.scene.rev } });
    const done = doneOf(t.frames);
    expect(done.assistant_character_id).toBe(SER);
    expect(done.blocked).toEqual([{ id: NAT, presence: "asleep" }]);
  });

  it("concurrency: a PATCH racing a follow-up either 409s or answers on the old rev; rev never goes backwards; one plan per turn id", async () => {
    flag(true);
    for (let round = 0; round < 3; round += 1) {
      const s = await seedSession([NAT, SER]);
      const t = await send(s, { speaker: NAT, content: "@Serenity race", scene: { if_rev: 0 } });
      const done = doneOf(t.frames);
      const planId = t.frames.find((f) => f.scene_plan)!.scene_plan.id;
      const [followUp, patched] = await Promise.all([
        send(s, { isContinue: true, speaker: SER, scene: { if_rev: done.scene.rev, scene_plan_id: planId, responder_index: 1 } }),
        patch(s, { location: `Room ${round}` }),
      ]);
      if (followUp.status === 409) {
        expect(followUp.json.error).toBe("scene_plan_stale");
      } else {
        expect(followUp.status).toBe(200);
        const fd = doneOf(followUp.frames);
        expect(fd.scene.rev).toBeGreaterThanOrEqual(done.scene.rev);
      }
      expect((await rawScene(s)).rev).toBeGreaterThanOrEqual(patched.scene.rev);
    }
    // The same turn id sent twice at once keeps one plan.
    const s = await seedSession([NAT, SER]);
    n += 1;
    const turnId = `${P}dup${n}`;
    const body = { turn_id: turnId, session_id: s, content: "@Serenity dup", character_ids: [NAT, SER], assistant_character_id: NAT, use_scene_mind: false, mode: "group", persist: false, persistence_owner: "client", if_rev: 0 };
    const [a, b] = await Promise.all([call("POST", "/chat/messages", body), call("POST", "/chat/messages", body)]);
    const fa = frames(await a.text());
    const fb = frames(await b.text());
    const ids = [fa, fb].map((fs) => fs.find((f) => f.scene_plan)?.scene_plan.id).filter(Boolean);
    const storedPlanId = (await rawScene(s)).plan.id;
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.every((id) => id === storedPlanId)).toBe(true);
  });

  it("solo sessions: done carries the scene, no plan frame, no markers parsed", async () => {
    flag(true);
    const s = await seedSession([NAT], "solo");
    const res = await call("POST", "/chat/messages", {
      turn_id: `${P}solo1`, session_id: s, content: "hi", character_id: NAT, character_ids: [NAT], assistant_character_id: NAT, mode: "solo", persist: false, persistence_owner: "client", if_rev: 0,
    });
    const fs = frames(await res.text());
    expect(fs.some((f) => f.scene_plan)).toBe(false);
    const done = doneOf(fs);
    expect(done.scene).toMatchObject({ rev: 0, adult_gated: false });
    expect(done.next_speaker).toBeNull();
  });
});

// ------------------------------------------------------------- flag off
describe("flag off: byte-identical to main", () => {
  it("no plan frames, no scene fields in done, markers pass through, plan fields ignored", async () => {
    flag(false);
    const s = await seedSession([NAT, SER]);
    const t = await send(s, {
      speaker: NAT,
      chunks: ["Bye [[ex", "it]]"],
      scene: { if_rev: 99, scene_plan_id: "plan_x", responder_index: 4 },
    });
    expect(t.status).toBe(200);
    expect(t.frames.some((f) => f.scene_plan || f.scene_event)).toBe(false);
    const done = doneOf(t.frames);
    expect(done).not.toHaveProperty("scene");
    expect(done).not.toHaveProperty("next_speaker");
    expect(done).not.toHaveProperty("blocked");
    expect(streamed(t.frames)).toBe("Bye [[exit]]");
    expect(done.visible).toBe("Bye [[exit]]");
    expect(done.assistant_character_id).toBe(NAT);
    expect(await rawScene(s)).toEqual({});
  });
});
