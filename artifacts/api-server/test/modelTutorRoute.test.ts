import { createHash } from "node:crypto";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
    sessionClaims: null,
  }),
  createClerkClient: () => ({
    users: { getUser: async () => ({ emailAddresses: [], primaryEmailAddressId: null }) },
  }),
}));

const draftCompletion = vi.fn();
vi.mock("../src/lib/llmFailover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/llmFailover")>()),
  createChatCompletionWithFailover: (...args: unknown[]) => draftCompletion(...args),
}));

import { eq, like, sql } from "drizzle-orm";
import { db, ownModelBlobs, userEntities, userProfiles } from "@workspace/db";
import modelTutorRouter from "../src/routes/modelTutor";
import {
  MODEL_LESSON_ENTITY,
  MODEL_TUTOR_PARTITION,
  getLesson,
  readModelTutorPrefs,
  saveLesson,
} from "../src/lib/modelTutorStore";
import { lessonIdFor } from "../src/lib/modelTutor";
import {
  BLOB_CHUNK_BYTES,
  ensureOwnModelBlobsTable,
  readModelState,
  resetOwnModelForTests,
} from "../src/lib/ownModel";

const PREFIX = `tutor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const STEWARD = `${PREFIX}steward`;
const SAVED_ENV = { ...process.env };
const realFetch = globalThis.fetch;

let server: Server;
let baseUrl = "";
const githubCalls: { url: string; body: unknown; auth: string | null }[] = [];

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/tutor", modelTutorRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function clearTutorData() {
  await db.delete(userEntities).where(eq(userEntities.userId, MODEL_TUTOR_PARTITION));
  await db.delete(userProfiles).where(like(userProfiles.userId, `${PREFIX}%`));
  await ensureOwnModelBlobsTable();
  await db.delete(ownModelBlobs);
}

beforeEach(async () => {
  process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS = STEWARD;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.GITHUB_TRAINER_TOKEN;
  resetOwnModelForTests();
  draftCompletion.mockReset();
  githubCalls.length = 0;
  // GitHub's workflow-dispatch API, stubbed; everything else is real.
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://api.github.com/")) {
      const headers = new Headers(init?.headers);
      githubCalls.push({ url, body: JSON.parse(String(init?.body ?? "{}")), auth: headers.get("authorization") });
      return new Response(null, { status: 204 });
    }
    return realFetch(input, init);
  });
  await clearTutorData();
});

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...SAVED_ENV };
  resetOwnModelForTests();
});

afterAll(async () => {
  await clearTutorData();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown, user = STEWARD) {
  // Model chunks go up as base64 text, like the Model Tutor panel sends them.
  const binary = body instanceof Uint8Array;
  const res = await fetch(`${baseUrl}/tutor${path}`, {
    method,
    headers: {
      "Content-Type": binary ? "text/plain" : "application/json",
      "x-test-user": user,
    },
    body: body === undefined ? undefined : binary ? Buffer.from(body).toString("base64") : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, body: json, text, headers: res.headers };
}

const LESSON = {
  session_id: "sess-1",
  message_id: "turn_1:assistant",
  context: [
    { role: "user", content: "I had a rough day." },
    { role: "assistant", content: "The day number 1746 was kind." },
    { role: "user", content: "Can you just listen?" },
    { role: "system", content: "never sent to the model" },
  ],
  rejected: "The day number 1746 was kind.",
  chosen: "Of course. I'm here — tell me what happened.",
  note: "Listen first, don't ramble.",
  source_brand: "own",
};

const CONFIG = { vocab_size: 300, block_size: 48, n_layer: 2, n_head: 2, n_embd: 32 };

function bytes(n: number, seed: number): Uint8Array {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) out[i] = (i * 31 + seed) & 0xff;
  return out;
}

/** Upload a model the way the Model Tutor panel does. */
async function uploadModel(inference: Uint8Array, master: Uint8Array, opts: { finish?: boolean } = {}) {
  const started = await call("POST", "/uploads", {
    config: CONFIG,
    inference: { bytes: inference.length, sha256: createHash("sha256").update(inference).digest("hex") },
    master: { bytes: master.length },
  });
  expect(started.status, started.text).toBe(201);
  const version = started.body.version as number;
  for (const [kind, data] of [["inference", inference], ["master", master]] as const) {
    for (let idx = 0; idx * BLOB_CHUNK_BYTES < data.length; idx++) {
      const chunk = data.subarray(idx * BLOB_CHUNK_BYTES, (idx + 1) * BLOB_CHUNK_BYTES);
      const put = await call("PUT", `/uploads/${version}/${kind}/${idx}`, chunk);
      expect(put.status, put.text).toBe(200);
    }
  }
  if (opts.finish === false) return { version, finished: null };
  const finished = await call("POST", `/uploads/${version}/finish`);
  return { version, finished };
}

// ---- tests ---------------------------------------------------------------

describe("who may teach", () => {
  it("tells a non-steward they are not one, and refuses their lessons and uploads", async () => {
    expect((await call("GET", "/status", undefined, `${PREFIX}visitor`)).body).toEqual({ isSteward: false });
    const res = await call("POST", "/lessons", LESSON, `${PREFIX}visitor`);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("not_steward");
    expect((await call("POST", "/uploads", {}, `${PREFIX}visitor`)).status).toBe(403);
    expect((await call("PUT", "/settings", { answer_everyone: true }, `${PREFIX}visitor`)).status).toBe(403);
  });

  it("requires a signed-in user", async () => {
    const res = await fetch(`${baseUrl}/tutor/status`);
    expect(res.status).toBe(401);
  });
});

describe("uploading the model", () => {
  it("publishes a model sent in chunks, and says so in the status", async () => {
    const inference = bytes(BLOB_CHUNK_BYTES * 2 + 1234, 1);
    const master = bytes(BLOB_CHUNK_BYTES + 7, 2);
    const { version, finished } = await uploadModel(inference, master);
    expect(finished!.status, finished!.text).toBe(200);
    expect(finished!.body.model).toMatchObject({ published: true, base_version: version, current_version: version });

    const state = await readModelState();
    expect(state.versions[String(version)]).toMatchObject({
      kind: "base",
      config: CONFIG,
      inference: { bytes: inference.length, chunks: 3 },
      master: { bytes: master.length, chunks: 2 },
    });
    expect(state.uploads).toEqual({});

    const status = await call("GET", "/status");
    expect(status.body).toMatchObject({
      isSteward: true,
      model: { published: true, current_version: version, config: CONFIG },
      settings: { answer_everyone: false, always_learning: false, learn_from_opted_in: false },
      trainer: { dispatch_configured: false, relearn_pending: false },
      lessons: { total: 0, pending: 0 },
    });
  });

  it("refuses chunks of the wrong size and will not publish a partial upload", async () => {
    const inference = bytes(BLOB_CHUNK_BYTES + 10, 3);
    const master = bytes(100, 4);
    const started = await call("POST", "/uploads", {
      config: CONFIG,
      inference: { bytes: inference.length, sha256: "a".repeat(64) },
      master: { bytes: master.length },
    });
    const version = started.body.version;
    expect((await call("PUT", `/uploads/${version}/inference/0`, inference.subarray(0, 10))).status).toBe(400);
    expect((await call("PUT", `/uploads/${version}/inference/5`, inference.subarray(0, 10))).status).toBe(400);
    expect((await call("PUT", `/uploads/${version}/weights/0`, master)).status).toBe(400);
    const notBase64 = await fetch(`${baseUrl}/tutor/uploads/${version}/master/0`, {
      method: "PUT",
      headers: { "Content-Type": "text/plain", "x-test-user": STEWARD },
      body: "!".repeat(136),
    });
    expect(notBase64.status).toBe(400);
    await call("PUT", `/uploads/${version}/inference/0`, inference.subarray(0, BLOB_CHUNK_BYTES));
    const finish = await call("POST", `/uploads/${version}/finish`);
    expect(finish.status).toBe(409);
    expect(finish.body.code).toBe("upload_incomplete");
    expect((await readModelState()).current_version).toBeNull();
  });

  it("rejects a file without a config or checksum", async () => {
    expect((await call("POST", "/uploads", { inference: { bytes: 10 }, master: { bytes: 10 } })).status).toBe(400);
    const noHash = await call("POST", "/uploads", {
      config: CONFIG,
      inference: { bytes: 10 },
      master: { bytes: 10 },
    });
    expect(noHash.status).toBe(400);
  });

  it("makes a new upload the base: learned lessons are queued again and old weights dropped", async () => {
    const first = await uploadModel(bytes(1000, 5), bytes(2000, 6));
    await call("POST", "/lessons", LESSON);
    const id = lessonIdFor({ sessionId: "sess-1", messageId: "turn_1:assistant", part: null });
    const saved = (await getLesson(id))!;
    await saveLesson({ ...saved, status: "learned", version: first.version });

    const second = await uploadModel(bytes(1500, 7), bytes(2500, 8));
    expect(second.version).toBeGreaterThan(first.version);
    expect((await getLesson(id))!.status).toBe("saved");
    const versions = await db
      .selectDistinct({ version: ownModelBlobs.version })
      .from(ownModelBlobs);
    expect(versions.map((v) => v.version)).toEqual([second.version]);
    expect(Object.keys((await readModelState()).versions)).toEqual([String(second.version)]);
  });
});

describe("switches", () => {
  it("won't answer anyone before a model is uploaded", async () => {
    const res = await call("PUT", "/settings", { answer_everyone: true });
    expect(res.status).toBe(409);
    expect((await call("PUT", "/preferences", { own_model_chat: true })).status).toBe(409);
  });

  it("stores the global switches and the steward's own switch", async () => {
    await uploadModel(bytes(100, 1), bytes(100, 2));
    const res = await call("PUT", "/settings", {
      answer_everyone: true,
      always_learning: true,
      learn_from_opted_in: false,
      ignored: "x",
    });
    expect(res.body.settings).toEqual({ answer_everyone: true, always_learning: true, learn_from_opted_in: false });
    expect(await readModelState()).toMatchObject({ answer_everyone: true, always_learning: true });
    expect((await call("PUT", "/settings", {})).status).toBe(400);

    await db.insert(userProfiles).values({
      userId: STEWARD,
      data: { settings: { theme_mode: "light" }, display_name: "Dàvīn" },
    });
    const pref = await call("PUT", "/preferences", { own_model_chat: true });
    expect(pref.body.preferences).toEqual({ own_model_chat: true, share_for_training: false });
    const [row] = await db.select().from(userProfiles).where(eq(userProfiles.userId, STEWARD));
    expect(row!.data).toMatchObject({
      settings: { theme_mode: "light" },
      display_name: "Dàvīn",
      model_tutor: { own_model_chat: true },
    });
    await call("PUT", "/preferences", { own_model_chat: false });
    expect((await readModelTutorPrefs(STEWARD)).own_model_chat).toBe(false);
  });
});

describe("teaching", () => {
  it("queues the lesson for the trainer", async () => {
    const res = await call("POST", "/lessons", LESSON);
    expect(res.status).toBe(201);
    expect(res.body.lesson).toMatchObject({
      status: "saved",
      source: "manual",
      attempts: 0,
      chosen: LESSON.chosen,
      rejected: LESSON.rejected,
      taught_by: STEWARD,
    });
    expect(res.body.lesson.context).toEqual([
      { role: "user", content: "I had a rough day." },
      { role: "assistant", content: "The day number 1746 was kind." },
      { role: "user", content: "Can you just listen?" },
    ]);
    expect(res.body.trainer_started).toBe(false);
    expect(githubCalls).toHaveLength(0);
    expect((await call("GET", "/status")).body.lessons).toMatchObject({ total: 1, pending: 1, learned: 0 });
  });

  it("starts the trainer at once when a GitHub token is set", async () => {
    process.env.GITHUB_TRAINER_TOKEN = "ghp_test";
    const res = await call("POST", "/lessons", LESSON);
    expect(res.body.trainer_started).toBe(true);
    expect(githubCalls).toEqual([
      {
        url: "https://api.github.com/repos/davins56/Anima-Protocol/actions/workflows/own-model-trainer.yml/dispatches",
        body: { ref: "main" },
        auth: "Bearer ghp_test",
      },
    ]);
    // Debounced: a burst of lessons starts one run.
    await call("POST", "/lessons", { ...LESSON, message_id: "turn_2:assistant" });
    expect(githubCalls).toHaveLength(1);
    expect((await readModelState()).trainer_dispatched_at).toBeTruthy();
  });

  it("refines the same reply's lesson instead of stacking a second one", async () => {
    await call("POST", "/lessons", LESSON);
    const again = await call("POST", "/lessons", { ...LESSON, chosen: "I'm listening." });
    expect(again.body.lesson.chosen).toBe("I'm listening.");
    expect((await call("GET", "/lessons")).body.lessons).toHaveLength(1);
  });

  it("rejects a lesson without a better reply", async () => {
    const res = await call("POST", "/lessons", { ...LESSON, chosen: "  " });
    expect(res.status).toBe(400);
  });

  it("filters lessons by where they came from, and retries a failed one", async () => {
    await call("POST", "/lessons", LESSON);
    const id = lessonIdFor({ sessionId: "sess-1", messageId: "turn_1:assistant", part: null });
    await saveLesson({ ...(await getLesson(id))!, status: "failed", attempts: 3, error: "boom" });
    expect((await call("GET", "/lessons?source=auto")).body.lessons).toEqual([]);
    expect((await call("GET", "/lessons?source=manual")).body.lessons).toHaveLength(1);
    const retried = await call("POST", `/lessons/${id}/retry`);
    expect(retried.body.lesson).toMatchObject({ status: "saved", attempts: 0, error: null });
  });
});

describe("forgetting and relearning", () => {
  it("deletes a pending lesson without relearning", async () => {
    await call("POST", "/lessons", LESSON);
    const id = lessonIdFor({ sessionId: "sess-1", messageId: "turn_1:assistant", part: null });
    const res = await call("DELETE", `/lessons/${id}`);
    expect(res.body).toEqual({ deleted: true, relearning: false });
    expect((await readModelState()).rebuild_seq).toBe(0);
    expect((await call("DELETE", `/lessons/${id}`)).status).toBe(404);
  });

  it("relearns from the base when a learned lesson is deleted", async () => {
    await uploadModel(bytes(100, 1), bytes(100, 2));
    await call("POST", "/lessons", LESSON);
    const id = lessonIdFor({ sessionId: "sess-1", messageId: "turn_1:assistant", part: null });
    await saveLesson({ ...(await getLesson(id))!, status: "learned", version: 2 });
    const res = await call("DELETE", `/lessons/${id}`);
    expect(res.body).toEqual({ deleted: true, relearning: true });
    const state = await readModelState();
    expect(state.rebuild_seq).toBe(1);
    expect((await call("GET", "/status")).body.trainer.relearn_pending).toBe(true);

    expect((await call("POST", "/sync")).status).toBe(202);
    expect((await readModelState()).rebuild_seq).toBe(2);
  });

  it("will not relearn before a model exists, and explains learn-now without a token", async () => {
    expect((await call("POST", "/sync")).status).toBe(409);
    const res = await call("POST", "/learn-now");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("dispatch_not_configured");
    process.env.GITHUB_TRAINER_TOKEN = "ghp_test";
    expect((await call("POST", "/learn-now")).status).toBe(202);
    expect((await call("POST", "/learn-now")).status).toBe(429);
  });
});

describe("advice and drafting", () => {
  it("keeps standing advice and uses it to draft a better reply", async () => {
    const added = await call("POST", "/advice", { text: "Ask a gentle follow-up question." });
    expect(added.status).toBe(201);
    expect((await call("POST", "/advice", { text: "   " })).status).toBe(400);
    expect((await call("GET", "/advice")).body.advice.map((a: { text: string }) => a.text)).toEqual([
      "Ask a gentle follow-up question.",
    ]);

    draftCompletion.mockResolvedValue({
      content: '"I\'m here. What happened today?"',
      model: "anima-chat",
      brand: "anima",
    });
    const res = await call("POST", "/lessons/draft", {
      context: LESSON.context,
      rejected: LESSON.rejected,
      note: LESSON.note,
    });
    expect(res.body).toMatchObject({ draft: "I'm here. What happened today?", brand: "anima" });
    const request = draftCompletion.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    const prompt = request.messages.map((m) => m.content).join("\n");
    expect(prompt).toContain("Ask a gentle follow-up question.");
    expect(prompt).toContain(LESSON.note);
    expect(prompt).toContain(LESSON.rejected);

    const id = added.body.advice.id as string;
    expect((await call("DELETE", `/advice/${id}`)).body).toEqual({ deleted: true });
    expect((await call("GET", "/advice")).body.advice).toEqual([]);
  });

  it("says so when Anima cannot draft", async () => {
    draftCompletion.mockRejectedValue(new Error("down"));
    const res = await call("POST", "/lessons/draft", { context: [], rejected: "x" });
    expect(res.status).toBe(502);
    expect(res.body.code).toBe("draft_failed");
  });
});

describe("export", () => {
  it("exports lessons in the formats phases 2 and 3 read", async () => {
    await call("POST", "/lessons", LESSON);
    const sftRes = await call("GET", "/export?format=sft");
    expect(sftRes.headers.get("content-disposition")).toContain("steward_lessons.jsonl");
    const sftLine = JSON.parse(sftRes.text.trim());
    expect(sftLine.messages).toEqual([
      { role: "user", content: "I had a rough day." },
      { role: "anima", content: "The day number 1746 was kind.", train: false },
      { role: "user", content: "Can you just listen?" },
      { role: "anima", content: LESSON.chosen },
    ]);
    const dpoRes = await call("GET", "/export?format=dpo");
    expect(dpoRes.headers.get("content-disposition")).toContain("steward_preferences.jsonl");
    expect(JSON.parse(dpoRes.text.trim())).toMatchObject({
      chosen: LESSON.chosen,
      rejected: LESSON.rejected,
    });
  });
});

it("keeps lesson rows inside the model partition", async () => {
  await call("POST", "/lessons", LESSON);
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(userEntities)
    .where(eq(userEntities.entityName, MODEL_LESSON_ENTITY));
  expect(row!.count).toBe(1);
});
