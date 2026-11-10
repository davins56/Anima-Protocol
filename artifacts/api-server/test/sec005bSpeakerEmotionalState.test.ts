// SEC-005b: a group turn may change only the active speaker's emotional state:
//   mood    = emotional_state.selfState (own timestamp: selfState.updatedAt) + moodTurnId
//   synchro = the serializeSynchroState fields (own timestamp: lastInteraction)
// Other participants keep theirs. With no resolved speaker, no one's mood or
// synchro changes (fail closed, same rule as SEC-001).
// Deliberately pinned to current behavior, NOT changed by this patch:
//   - relationshipTurnId / savedMomentsTurnId stamps (bond + saved-moment pass)
//   - the shared "User: … | Companion: …" turn fact (SEC-005a / audit F-01)
// The row-level companion_memories.updated_at is not asserted: the bond and
// saved-moment stamps are still written for every participant and bump it.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { and, eq, like } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

const llm = vi.hoisted(() => ({ reply: "" }));

vi.mock("../src/lib/llmFailover", () => ({
  createChatStreamWithFailover: async () => {
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

const spies = vi.hoisted(() => ({ mood: [] as any[], bond: [] as any[] }));
vi.mock("../src/lib/turnMoodWrite", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/turnMoodWrite")>();
  return {
    ...actual,
    emotionalStateWithTurnMood: (...args: Parameters<typeof actual.emotionalStateWithTurnMood>) => {
      spies.mood.push({ turnId: args[1], selfState: args[2] });
      return actual.emotionalStateWithTurnMood(...args);
    },
    emotionalStateWithTurnBond: (...args: Parameters<typeof actual.emotionalStateWithTurnBond>) => {
      spies.bond.push({ turnId: args[1], input: args[2] });
      return actual.emotionalStateWithTurnBond(...args);
    },
  };
});

import chatRouter from "../src/routes/chat";
import {
  CHAT_SESSION,
  companionMemories,
  db,
  ensureSchemaOnce,
  getPool,
  userEntities,
  userProfiles,
} from "@workspace/db";
import { initCompanionAffect, serializeCompanionAffect } from "../src/lib/companionAffect";

const P = `sec005b_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const userId = `${P}_user`;
const NAT = `${P}_natasha`;
const STEVE = `${P}_steve`;
const WANDA = `${P}_wanda`;
const ALL = [NAT, STEVE, WANDA];
const NAMES: Record<string, string> = {
  [NAT]: "Natasha Romanoff",
  [STEVE]: "Steve Rogers",
  [WANDA]: "Wanda Maximoff",
};

let server: Server;
let base = "";

const SYNCHRO_KEYS = [
  "intimacy",
  "powerDynamic",
  "spiritualAttunement",
  "primalIntensity",
  "crossoverOpenness",
  "synchroStrength",
  "synchroLevel",
  "totalTurns",
  "lastInteraction",
  "emotionalTone",
] as const;

function seedState(i: number): Record<string, unknown> {
  const self = serializeCompanionAffect(initCompanionAffect(null));
  return {
    selfState: { ...self, mood: `seed-mood-${i}`, energy: 10 + i, intensity: 5 + i },
    intimacy: 10 * (i + 1),
    powerDynamic: 0,
    spiritualAttunement: 3 * (i + 1),
    primalIntensity: 0,
    crossoverOpenness: 2 * (i + 1),
    synchroStrength: 10 * (i + 1),
    synchroLevel: "disconnected",
    totalTurns: i,
    lastInteraction: "2026-01-01T00:00:00.000Z",
    emotionalTone: `seed-tone-${i}`,
  };
}

const SEEDS: Record<string, Record<string, unknown>> = {};

async function resetCharacters() {
  await db.delete(companionMemories).where(like(companionMemories.userId, `${P}%`));
  for (const [i, cid] of ALL.entries()) {
    SEEDS[cid] = seedState(i);
    await db.insert(companionMemories).values({
      userId,
      characterId: cid,
      summary: "",
      facts: [],
      emotionalState: SEEDS[cid],
      resonanceNotes: "",
      updatedAt: new Date("2026-01-01T00:00:00Z"),
    });
  }
  await getPool().query(`DELETE FROM memory_embeddings WHERE user_id = $1`, [userId]).catch(() => {});
}

async function rows(): Promise<Record<string, { facts: any[]; es: Record<string, any> }>> {
  const r = await db
    .select({
      characterId: companionMemories.characterId,
      facts: companionMemories.facts,
      emotionalState: companionMemories.emotionalState,
    })
    .from(companionMemories)
    .where(eq(companionMemories.userId, userId));
  const out: Record<string, { facts: any[]; es: Record<string, any> }> = {};
  for (const row of r) {
    out[row.characterId] = {
      facts: (row.facts as any[]) ?? [],
      es: (row.emotionalState as Record<string, any>) ?? {},
    };
  }
  return out;
}

async function embeddings(): Promise<Record<string, string[]>> {
  const r = await getPool().query(
    `SELECT character_id, text FROM memory_embeddings WHERE user_id = $1 ORDER BY character_id`,
    [userId],
  );
  const out: Record<string, string[]> = {};
  for (const row of r.rows as { character_id: string; text: string }[]) {
    (out[row.character_id] ||= []).push(row.text);
  }
  return out;
}

async function waitFor(pred: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await pred()) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  // Let any trailing background writes (other participants) land.
  await new Promise((r) => setTimeout(r, 1200));
}

async function post(path: string, body?: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": userId },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, text: await res.text() };
}

const synchroOf = (es: Record<string, any>) =>
  Object.fromEntries(SYNCHRO_KEYS.map((k) => [k, es[k]]));

beforeAll(async () => {
  await ensureSchemaOnce();
  await db.insert(userProfiles).values({ userId, data: { display_name: "Mara" } });
  await db.insert(userEntities).values([
    ...ALL.map((cid) => ({
      userId,
      entityName: "Character",
      entityId: cid,
      data: { id: cid, name: NAMES[cid], personality: "test", universe: "Marvel" },
    })),
    ...["srv", "cli", "srvnone", "clinone"].map((s) => ({
      userId,
      entityName: CHAT_SESSION,
      entityId: `${P}_${s}`,
      data: {
        id: `${P}_${s}`,
        title: "Group",
        mode: "group",
        group_character_ids: ALL,
        messages: [],
        messages_migrated: true,
      },
    })),
  ]);
  const app: Express = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/chat", chatRouter);
  await new Promise<void>((r) => {
    server = app.listen(0, () => r());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
  await db.delete(companionMemories).where(like(companionMemories.userId, `${P}%`));
  await db.delete(userEntities).where(like(userEntities.userId, `${P}%`));
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
});

type Flow = "server" | "client";

async function groupTurn(flow: Flow, opts: { speaker: string | null; tag: string }) {
  await resetCharacters();
  const turnId = `${P}_${opts.tag}`;
  const content = `Question for the team (${opts.tag})`;
  llm.reply = `Reply from the speaker (${opts.tag}). I feel close to you, thank you, I trust you.`;
  const session = `${P}_${opts.tag}`;
  const res = await post("/chat/messages", {
    turn_id: turnId,
    session_id: session,
    content,
    character_ids: ALL,
    ...(opts.speaker
      ? { assistant_character_id: opts.speaker }
      : { assistant_character_name: "Nobody In This Scene" }),
    mode: "group",
    persist: flow === "server",
    ...(flow === "client" ? { persistence_owner: "client" } : {}),
    region: { share_region: false },
  });
  expect(res.status).toBe(200);
  if (flow === "client") {
    const commit = await post(`/chat/turns/${turnId}/commit`);
    expect(commit.status).toBe(200);
  }
  await waitFor(async () => {
    const r = await rows();
    return ALL.every((cid) => r[cid]?.facts?.some((f: any) => f.turn_id === turnId));
  });
  return { turnId, content, reply: llm.reply, after: await rows(), emb: await embeddings() };
}

function expectSharedFactUnchanged(
  t: { turnId: string; content: string; reply: string; after: Awaited<ReturnType<typeof rows>>; emb: Record<string, string[]> },
) {
  // SEC-005a / F-01 is deliberately NOT fixed here: every participant still
  // receives the same unattributed "User: … | Companion: <speaker reply>" fact.
  const expected = `User: ${t.content} | Companion: ${t.reply}`;
  for (const cid of ALL) {
    const facts = t.after[cid].facts.filter((f: any) => f.turn_id === t.turnId);
    expect(facts.map((f: any) => f.text), cid).toEqual([expected]);
    expect(t.emb[cid] ?? [], cid).toContain(expected);
  }
}

const SPEAKER_CASES: { flow: Flow; tag: string }[] = [
  { flow: "server", tag: "srv" },
  { flow: "client", tag: "cli" },
];

describe("SEC-005b: group turn emotional-state scope", () => {
  for (const c of SPEAKER_CASES) {
    describe(`${c.flow}-persist group turn, speaker Natasha, listeners Steve + Wanda`, () => {
      let t: Awaited<ReturnType<typeof groupTurn>>;
      beforeAll(async () => {
        t = await groupTurn(c.flow, { speaker: NAT, tag: c.tag });
      });

      it("(a) speaker's mood (selfState) is updated and stamped with this turn", () => {
        const es = t.after[NAT].es;
        expect(es.moodTurnId).toBe(t.turnId);
        expect(es.selfState).toBeTruthy();
        expect(es.selfState).not.toEqual(SEEDS[NAT].selfState);
      });

      it("(a) speaker's synchro is updated and the bond is stamped with this turn", () => {
        const es = t.after[NAT].es;
        expect(es.relationshipTurnId).toBe(t.turnId);
        expect(synchroOf(es)).not.toEqual(synchroOf(SEEDS[NAT]));
      });

      it("(b) listeners' mood (selfState incl. selfState.updatedAt, moodTurnId) is not overwritten", () => {
        for (const cid of [STEVE, WANDA]) {
          const es = t.after[cid].es;
          expect(es.selfState, cid).toEqual(SEEDS[cid].selfState);
          expect(es.moodTurnId, cid).toBeUndefined();
        }
      });

      it("(b) listeners' synchro fields (incl. lastInteraction) are not overwritten", () => {
        for (const cid of [STEVE, WANDA]) {
          expect(synchroOf(t.after[cid].es), cid).toEqual(synchroOf(SEEDS[cid]));
        }
      });

      it("(unchanged) bond + saved-moment stamps still land on every participant", () => {
        for (const cid of ALL) {
          const es = t.after[cid].es;
          expect(es.relationshipTurnId, cid).toBe(t.turnId);
          expect(es.savedMomentsTurnId, cid).toBe(t.turnId);
        }
      });

      it("(c) memory fact attribution (SEC-005a) is unchanged", () => {
        expectSharedFactUnchanged(t);
      });
    });
  }

  for (const c of [
    // Current behavior pinned from origin/main 0895fe0: the server-persist
    // path has no synchro without a speaker, so no stamps; the client commit
    // path falls back to characterIds[0] for synchro and stamps everyone.
    { flow: "server" as Flow, tag: "srvnone", expectStamps: false },
    { flow: "client" as Flow, tag: "clinone", expectStamps: true },
  ]) {
    describe(`${c.flow}-persist group turn with NO resolved speaker`, () => {
      let t: Awaited<ReturnType<typeof groupTurn>>;
      beforeAll(async () => {
        t = await groupTurn(c.flow, { speaker: null, tag: c.tag });
      });

      it("fail-closed: no participant's mood (selfState incl. selfState.updatedAt, moodTurnId) changes", () => {
        for (const cid of ALL) {
          const es = t.after[cid].es;
          expect(es.selfState, cid).toEqual(SEEDS[cid].selfState);
          expect(es.moodTurnId, cid).toBeUndefined();
        }
      });

      it("fail-closed: no participant's synchro fields (incl. lastInteraction) change", () => {
        for (const cid of ALL) {
          expect(synchroOf(t.after[cid].es), cid).toEqual(synchroOf(SEEDS[cid]));
        }
      });

      it("fail-closed: no mood/synchro payload reaches the emotional-state writers", () => {
        const moodCalls = spies.mood.filter((c) => c.turnId === t.turnId && c.selfState);
        expect(moodCalls).toEqual([]);
        const bondCalls = spies.bond.filter((c) => c.turnId === t.turnId);
        for (const c of bondCalls) {
          expect(c.input.selfState ?? null).toBeNull();
          expect(Object.keys(c.input.synchro ?? {})).toEqual([]);
        }
      });

      it("(unchanged) bond + saved-moment stamps keep current behavior", () => {
        for (const cid of ALL) {
          const es = t.after[cid].es;
          expect(es.relationshipTurnId ?? null, cid).toBe(c.expectStamps ? t.turnId : null);
          expect(es.savedMomentsTurnId ?? null, cid).toBe(c.expectStamps ? t.turnId : null);
        }
      });

      it("(c) memory fact attribution (SEC-005a) is unchanged", () => {
        expectSharedFactUnchanged(t);
      });
    });
  }
});
