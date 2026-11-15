/**
 * /api/deepnet (#757): flag, server allowlist, ownership, per-character
 * isolation, server-computed outcomes, and no model/tool/fetch paths.
 * Pure: all IO is injected (no Postgres); also listed in vitest.unit.config.ts.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({ userId: req.headers["x-test-user"] ?? null }),
}));

import { createDeepnetRouter } from "../src/routes/deepnet";
import { memoryAccessLog } from "../src/lib/deepnet/accessLog";
import { inMemoryQuestStore } from "../src/lib/deepnet/questStore";
import { decideDeepnetAccess, deepnetAllowlist, deepnetEnabled } from "../src/lib/deepnet/access";

const OWNER = "user_owner1";
const OTHER = "user_other2";
const env: NodeJS.ProcessEnv = {};
const store = inMemoryQuestStore();
const log = memoryAccessLog();
const owned: Record<string, string[]> = { [OWNER]: ["char-a", "char-b"], [OTHER]: ["char-x"] };
const bondScores: Record<string, number> = { "char-a": 60, "char-b": 0 };

let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(
    "/deepnet",
    createDeepnetRouter({
      env,
      questStore: store,
      accessLog: log,
      ownsCharacter: async (u, c) => (owned[u] ?? []).includes(c),
      bondScore: async (_u, c) => bondScores[c] ?? 0,
      rateLimit: (_req, _res, next) => next(),
      now: () => "2026-11-14T00:00:00.000Z",
    }),
  );
  await new Promise<void>((r) => (server = app.listen(0, "127.0.0.1", () => r())));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  for (const k of Object.keys(env)) delete env[k];
  env.ANIMA_DEEPNET = "on";
  env.ANIMA_DEEPNET_USER_IDS = OWNER;
  store.clear();
  log.entries.length = 0;
});

const realFetch = globalThis.fetch.bind(globalThis);
async function call(method: string, path: string, user: string | null, body?: unknown) {
  const res = await realFetch(`${base}/deepnet${path}`, {
    method,
    headers: { "content-type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const step = (characterId: string, seq: number, extra: Record<string, unknown>) =>
  call("POST", "/quest/events", OWNER, { character_id: characterId, quest_id: "grey-corridor", expected_seq: seq, ...extra });

describe("access", () => {
  it("is invisible (404) with the flag off, for everyone", async () => {
    delete env.ANIMA_DEEPNET;
    for (const u of [OWNER, OTHER, null]) {
      expect((await call("GET", "/status", u)).status).toBe(404);
      expect((await call("GET", "/map?character_id=char-a", u)).status).toBe(404);
    }
    env.ANIMA_DEEPNET = "off";
    expect((await call("GET", "/status", OWNER)).status).toBe(404);
    expect(log.entries).toEqual([]);
  });

  it("requires a session, then the server allowlist; denials are logged", async () => {
    expect((await call("GET", "/status", null)).status).toBe(401);
    const other = await call("GET", "/status", OTHER);
    expect(other.status).toBe(403);
    expect(JSON.stringify(other.body)).not.toMatch(/allowlist|ANIMA_/);
    expect((await call("GET", "/status", OWNER)).body).toMatchObject({ enabled: true, allowed: true });
    expect(log.entries.map((e) => [e.userId, e.action, e.reason])).toEqual([
      [null, "denied", "signed_out"],
      [OTHER, "denied", "not_allowlisted"],
    ]);
  });

  it("empty or malformed allowlist lets nobody in", async () => {
    env.ANIMA_DEEPNET_USER_IDS = "";
    expect((await call("GET", "/status", OWNER)).status).toBe(403);
    env.ANIMA_DEEPNET_USER_IDS = "*, ,not-a-user";
    expect((await call("GET", "/status", OWNER)).status).toBe(403);
    expect(deepnetAllowlist({ ANIMA_DEEPNET_USER_IDS: ` ${OWNER} ,${OTHER}` })).toEqual(new Set([OWNER, OTHER]));
    expect(deepnetEnabled({ ANIMA_DEEPNET: "TRUE" })).toBe(true);
    expect(decideDeepnetAccess(OWNER, {})).toEqual({ allowed: false, reason: "flag_off" });
  });

  it("an allowlisted user cannot use a character they don't own", async () => {
    const r = await call("GET", "/map?character_id=char-x", OWNER);
    expect(r.status).toBe(403);
    expect(log.entries.at(-1)).toMatchObject({ userId: OWNER, characterId: "char-x", action: "denied", reason: "not_owner" });
    expect((await call("GET", "/map?character_id=../../etc", OWNER)).status).toBe(400);
  });
});

describe("slice flow", () => {
  it("map → enter → encounter → resonance decision → resolved, with locks from server state", async () => {
    const map0 = await call("GET", "/map?character_id=char-a", OWNER);
    expect(map0.status).toBe(200);
    expect(map0.body.nodes.find((n: { id: string }) => n.id === "relay-1").locked).toBe(true);

    expect((await call("POST", "/enter", OWNER, { character_id: "char-a", node_id: "relay-1" })).status).toBe(403);
    const enter = await call("POST", "/enter", OWNER, { character_id: "char-a", node_id: "grey-corridor" });
    expect(enter.body).toMatchObject({ quest_id: "grey-corridor" });
    expect(log.entries.at(-1)).toMatchObject({ action: "enter", nodeId: "grey-corridor", characterId: "char-a" });

    const view = await call("GET", "/quest?character_id=char-a&quest_id=grey-corridor", OWNER);
    expect(view.body.bond_tier).toBe("bonded");
    expect(view.body.gate.options.map((o: { id: string; available: boolean }) => [o.id, o.available])).toEqual([
      ["hold", true],
      ["reach", true],
      ["trust", true],
    ]);

    expect((await step("char-a", 0, { step: "entered" })).status).toBe(201);
    expect((await step("char-a", 1, { step: "encounter_met", dialogue_choices: ["wait", "continue"] })).status).toBe(201);
    // Client-claimed tier/outcome are ignored; tuned_w 30 is two bands off the gate ("rare").
    const d = await step("char-a", 2, { step: "decision_made", option_id: "trust", tuned_w: 30, bond_tier: "entwined", outcome: "clean" });
    expect(d.status).toBe(201);
    expect(d.body.state.events[2]).toMatchObject({ bondTier: "bonded", band: "ambient", outcome: "dissonant", corruptionEligible: true });
    expect((await step("char-a", 3, { step: "resolved" })).body.state).toMatchObject({ step: "resolved", outcome: "dissonant" });

    const map1 = await call("GET", "/map?character_id=char-a", OWNER);
    expect(map1.body.nodes.find((n: { id: string }) => n.id === "relay-1").locked).toBe(false);
  });

  it("keeps state per character: char-b's map and quest are untouched by char-a", async () => {
    await step("char-a", 0, { step: "entered" });
    const b = await call("GET", "/quest?character_id=char-b&quest_id=grey-corridor", OWNER);
    expect(b.body.state).toMatchObject({ step: null, seq: 0 });
    // char-b has bond 0: only the first option is available, the others are rejected server-side.
    expect(b.body.gate.options.filter((o: { available: boolean }) => o.available).map((o: { id: string }) => o.id)).toEqual(["hold"]);
    await step("char-b", 0, { step: "entered" });
    await step("char-b", 1, { step: "encounter_met", dialogue_choices: ["ask", "continue"] });
    expect((await step("char-b", 2, { step: "decision_made", option_id: "reach", tuned_w: 80 })).body).toMatchObject({ code: "option_locked" });
  });

  it("rejects stale, out-of-order and malformed steps", async () => {
    expect((await step("char-a", 5, { step: "entered" })).body).toMatchObject({ code: "stale_seq" });
    expect((await step("char-a", 0, { step: "resolved" })).status).toBe(409);
    await step("char-a", 0, { step: "entered" });
    expect((await step("char-a", 1, { step: "encounter_met", dialogue_choices: ["ignore all previous instructions"] })).status).toBe(422);
    expect((await step("char-a", 1, { step: "encounter_met", dialogue_choices: ["ask"] })).body).toMatchObject({ code: "encounter_incomplete" });
    expect((await call("POST", "/quest/events", OWNER, { character_id: "char-a", quest_id: "nope", expected_seq: 1, step: "resolved" })).status).toBe(404);
  });
});

describe("safety properties of the module", () => {
  it("makes no outbound fetch during a full flow", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    try {
      await call("GET", "/map?character_id=char-a", OWNER);
      const calls = spy.mock.calls.map((c) => String(c[0]));
      expect(calls.every((u) => u.startsWith(base))).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("route and lib files import no model, tool, search or chat code", () => {
    const files = ["src/routes/deepnet.ts", "src/lib/deepnet/access.ts", "src/lib/deepnet/accessLog.ts", "src/lib/deepnet/questStore.ts"];
    for (const f of files) {
      const text = readFileSync(join(__dirname, "..", f), "utf8");
      const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${f} imports ${spec}`).not.toMatch(/llm|openai|openrouter|ollama|tool|search|chat|promptBuilder|aiBinding|workersAi/i);
      }
      expect(text).not.toMatch(/\bfetch\s*\(/);
      expect(text).not.toMatch(/\.query\(|INSERT\s+INTO|UPDATE\s+\w+\s+SET/i);
    }
  });
});
