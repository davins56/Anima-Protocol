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

const teacherCompletion = vi.fn();
vi.mock("../src/lib/llmFailover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/llmFailover")>()),
  createChatCompletionWithFailover: (...args: unknown[]) => teacherCompletion(...args),
}));

import { eq, like } from "drizzle-orm";
import { db, ownModelBlobs, userEntities, userProfiles } from "@workspace/db";
import chatRouter from "../src/routes/chat";
import storeRouter from "../src/routes/store";
import ownModelRouter from "../src/routes/ownModel";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit";
import { MODEL_TUTOR_PARTITION, getLesson, listLessons } from "../src/lib/modelTutorStore";
import { lessonIdFor } from "../src/lib/modelTutor";
import {
  BLOB_CHUNK_BYTES,
  OWN_MODEL_EMPTY_REPLY,
  base64ByteLength,
  ensureOwnModelBlobsTable,
  installBaseVersion,
  mergeModelState,
  modelTutorPrefs,
  normalizeModelState,
  ownModelAccess,
  resetOwnModelForTests,
  writeBlobChunk,
  type ModelState,
} from "../src/lib/ownModel";

const PREFIX = `own_model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const STEWARD = `${PREFIX}steward`;
const VISITOR = `${PREFIX}visitor`;
const SAVED_ENV = { ...process.env };
const VERSION = 7;
const WEIGHTS = new Uint8Array(BLOB_CHUNK_BYTES + 100).map((_, i) => (i * 7) & 0xff);

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/store", storeRouter);
  app.use("/chat", chatRouter);
  app.use("/model", ownModelRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

async function clearModelData() {
  await db.delete(userEntities).where(eq(userEntities.userId, MODEL_TUTOR_PARTITION));
  await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  await db.delete(userProfiles).where(like(userProfiles.userId, `${PREFIX}%`));
  await ensureOwnModelBlobsTable();
  await db.delete(ownModelBlobs);
}

/** A published model, as the Model Tutor upload leaves it. */
async function publishModel(settings: Partial<ModelState> = {}) {
  const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
  await writeBlobChunk(VERSION, "inference", 0, b64(WEIGHTS.subarray(0, BLOB_CHUNK_BYTES)));
  await writeBlobChunk(VERSION, "inference", 1, b64(WEIGHTS.subarray(BLOB_CHUNK_BYTES)));
  await writeBlobChunk(VERSION, "master", 0, b64(new Uint8Array([1, 2, 3])));
  await mergeModelState({ uploads: {} });
  await installBaseVersion(VERSION, {
    kind: "base",
    created_at: "2026-09-01T00:00:00.000Z",
    lessons: 0,
    inference: { bytes: WEIGHTS.length, chunks: 2, sha256: "ab".repeat(32) },
    master: { bytes: 3, chunks: 1 },
    config: { vocab_size: 300, block_size: 48, n_layer: 2, n_head: 2, n_embd: 32 },
  });
  if (Object.keys(settings).length) await mergeModelState(settings);
}

beforeEach(async () => {
  process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS = STEWARD;
  delete process.env.CLERK_SECRET_KEY;
  delete process.env.GITHUB_TRAINER_TOKEN;
  resetOwnModelForTests();
  resetRateLimitStateForTests();
  teacherCompletion.mockReset();
  await clearModelData();
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  resetOwnModelForTests();
});

afterAll(async () => {
  await clearModelData();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(user: string | null, method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(user ? { "x-test-user": user } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function json(user: string | null, method: string, path: string, body?: unknown) {
  const res = await call(user, method, path, body);
  return { status: res.status, body: (await res.json()) as any };
}

// ---- who the model answers ----------------------------------------------

describe("access", () => {
  const published = normalizeModelState({
    base_version: 1,
    current_version: 1,
    versions: { "1": { kind: "base", inference: { bytes: 1, chunks: 1 }, master: { bytes: 1, chunks: 1 } } },
  });
  const access = (userId: string, profile: unknown, state: Partial<ModelState> = {}) =>
    ownModelAccess({ userId, profile, state: { ...published, ...state } });
  const chatOn = { model_tutor: { own_model_chat: true } };
  const sharing = { model_tutor: { share_for_training: true } };

  it("measures base64 without decoding it", () => {
    for (const n of [0, 1, 2, 3, 512, 1000]) {
      expect(base64ByteLength(Buffer.alloc(n, 7).toString("base64"))).toBe(n);
    }
    expect(base64ByteLength("abc")).toBeNull();
    expect(base64ByteLength("ab!d")).toBeNull();
    expect(base64ByteLength("ab\ncd==")).toBeNull();
  });

  it("reads the switches from the profile, not from settings", () => {
    expect(modelTutorPrefs({ model_tutor: { own_model_chat: true } })).toEqual({
      own_model_chat: true,
      share_for_training: false,
    });
    expect(modelTutorPrefs({ settings: { own_model_chat: true } }).own_model_chat).toBe(false);
    expect(modelTutorPrefs(null)).toEqual({ own_model_chat: false, share_for_training: false });
  });

  it("answers nobody until a model is published", async () => {
    const empty = normalizeModelState({ answer_everyone: true });
    expect(await ownModelAccess({ userId: STEWARD, profile: chatOn, state: empty })).toMatchObject({
      enabled: false,
      learning: false,
    });
  });

  it("answers the steward who switched it on, and everyone when told to", async () => {
    expect((await access(STEWARD, chatOn)).enabled).toBe(true);
    expect((await access(STEWARD, {})).enabled).toBe(false);
    // The profile is the user's to write; the switch alone is not enough.
    expect((await access(VISITOR, chatOn)).enabled).toBe(false);
    expect((await access(VISITOR, {}, { answer_everyone: true })).enabled).toBe(true);
  });

  it("learns from the steward, and from others only when both sides agree", async () => {
    const everyone = { answer_everyone: true, always_learning: true };
    expect((await access(STEWARD, chatOn, everyone)).learning).toBe(true);
    expect((await access(STEWARD, chatOn, { answer_everyone: true })).learning).toBe(false);
    expect((await access(VISITOR, sharing, everyone)).learning).toBe(false);
    expect((await access(VISITOR, {}, { ...everyone, learn_from_opted_in: true })).learning).toBe(false);
    expect((await access(VISITOR, sharing, { ...everyone, learn_from_opted_in: true })).learning).toBe(true);
  });
});

// ---- /model --------------------------------------------------------------

describe("GET /model/config and the weights", () => {
  it("requires a signed-in user", async () => {
    expect((await call(null, "GET", "/model/config")).status).toBe(401);
    expect((await call(null, "GET", `/model/v/${VERSION}/inference/0`)).status).toBe(401);
  });

  it("gives the version to run to someone it answers, and serves it in chunks", async () => {
    await publishModel();
    await call(STEWARD, "PUT", "/store/profile", { model_tutor: { own_model_chat: true } });
    const config = await json(STEWARD, "GET", "/model/config");
    expect(config.body).toMatchObject({
      enabled: true,
      learning: false,
      model: {
        version: VERSION,
        chunk_bytes: BLOB_CHUNK_BYTES,
        inference: { bytes: WEIGHTS.length, chunks: 2, sha256: "ab".repeat(32) },
        config: { block_size: 48 },
      },
    });

    const parts: Buffer[] = [];
    for (const idx of [0, 1]) {
      const res = await call(STEWARD, "GET", `/model/v/${VERSION}/inference/${idx}`);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("immutable");
      const text = await res.text();
      expect(text).toMatch(/^[A-Za-z0-9+/]+=*$/);
      parts.push(Buffer.from(text, "base64"));
    }
    expect(Buffer.concat(parts).equals(Buffer.from(WEIGHTS))).toBe(true);

    expect((await call(STEWARD, "GET", `/model/v/${VERSION}/inference/2`)).status).toBe(404);
    expect((await call(STEWARD, "GET", `/model/v/${VERSION + 1}/inference/0`)).status).toBe(404);
    expect((await call(STEWARD, "GET", `/model/v/${VERSION}/master/0`)).status).toBe(404);
  });

  it("keeps the weights from users it does not answer", async () => {
    await publishModel();
    const config = await json(VISITOR, "GET", "/model/config");
    expect(config.body).toMatchObject({ enabled: false, model: null, learning_open: false });
    expect((await call(VISITOR, "GET", `/model/v/${VERSION}/inference/0`)).status).toBe(403);

    await mergeModelState({ answer_everyone: true });
    expect((await json(VISITOR, "GET", "/model/config")).body).toMatchObject({
      enabled: true,
      model: { version: VERSION },
    });
    expect((await call(VISITOR, "GET", `/model/v/${VERSION}/inference/0`)).status).toBe(200);
  });

  it("records a user's consent to learn from their chats", async () => {
    await publishModel({ answer_everyone: true, always_learning: true, learn_from_opted_in: true });
    expect((await json(VISITOR, "GET", "/model/config")).body).toMatchObject({
      learning_open: true,
      share_for_training: false,
      learning: false,
    });
    const res = await json(VISITOR, "PUT", "/model/consent", { share_for_training: true });
    expect(res.body).toEqual({ share_for_training: true });
    expect((await json(VISITOR, "GET", "/model/config")).body).toMatchObject({
      share_for_training: true,
      learning: true,
    });
  });
});

// ---- chat turns ---------------------------------------------------------

async function chatAs(user: string, content: string, extra: Record<string, unknown> = {}) {
  const suffix = Math.random().toString(36).slice(2, 8);
  const characterId = `${PREFIX}char_${suffix}`;
  const sessionId = `${PREFIX}sess_${suffix}`;
  await call(user, "PUT", `/store/Character/${characterId}`, { name: "Aria", universe: "Original" });
  await call(user, "PUT", `/store/ChatSession/${sessionId}`, {
    character_id: characterId,
    mode: "solo",
    title: "Own model",
  });
  const res = await call(user, "POST", "/chat/messages", {
    session_id: sessionId,
    content,
    character_id: characterId,
    mode: "solo",
    persist: false,
    ...extra,
  });
  const events = (await res.text())
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
  return { status: res.status, events, sessionId, done: events.find((e) => e.done === true) };
}

describe("POST /chat/messages with a reply from the own model", () => {
  beforeEach(async () => {
    await call(STEWARD, "PUT", "/store/profile", {
      settings: { theme_mode: "dark" },
      model_tutor: { own_model_chat: true },
    });
  });

  it("records the browser's reply as the turn", async () => {
    await publishModel();
    const { status, events, done } = await chatAs(STEWARD, "Hi there", {
      own_model_reply: "Hello from my model.",
      own_model_version: VERSION,
    });
    expect(status).toBe(200);
    expect(done, JSON.stringify(events).slice(0, 500)).toMatchObject({
      provider: "own",
      brand: "own",
      model: `anima-own v${VERSION}`,
      visible: "Hello from my model.",
    });
    expect(events.filter((e) => typeof e.content === "string").map((e) => e.content)).toEqual([
      "Hello from my model.",
    ]);
  });

  it("keeps an empty reply as a teachable bubble", async () => {
    await publishModel();
    const { done } = await chatAs(STEWARD, "Hello?", { own_model_reply: "   " });
    expect(done).toMatchObject({ provider: "own", visible: OWN_MODEL_EMPTY_REPLY });
  });

  it("ignores a reply from someone the model does not answer", async () => {
    await publishModel();
    await call(VISITOR, "PUT", "/store/profile", { model_tutor: { own_model_chat: true } });
    const { events, done } = await chatAs(VISITOR, "Hi there", { own_model_reply: "I am the model now." });
    expect(done?.provider).not.toBe("own");
    expect(JSON.stringify(events)).not.toContain("I am the model now.");
  });
});

// ---- automatic lessons ---------------------------------------------------

describe("POST /model/auto-lesson", () => {
  async function ownTurn(user: string, content: string, extra: Record<string, unknown> = {}) {
    const turn = await chatAs(user, content, { own_model_reply: "The number 1746 was kind.", ...extra });
    expect(turn.done?.provider).toBe("own");
    return turn;
  }

  beforeEach(async () => {
    await call(STEWARD, "PUT", "/store/profile", { model_tutor: { own_model_chat: true } });
    teacherCompletion.mockResolvedValue({
      content: '"That sounds heavy. Do you want to tell me about it?"',
      model: "anima-chat",
      brand: "anima",
    });
  });

  it("queues what the main model would have said, taught from the recent conversation", async () => {
    await publishModel({ always_learning: true });
    const { done, sessionId } = await ownTurn(STEWARD, "I had a rough day.");
    const res = await json(STEWARD, "POST", "/model/auto-lesson", {
      turn_id: done!.turn_id,
      context: [
        { role: "user", content: "Hey" },
        { role: "assistant", content: "Hi!" },
        { role: "user", content: "I had a rough day." },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ queued: true });

    const lesson = (await getLesson(res.body.lesson_id))!;
    expect(lesson).toMatchObject({
      source: "auto",
      status: "saved",
      chosen: "That sounds heavy. Do you want to tell me about it?",
      rejected: "The number 1746 was kind.",
      session_id: sessionId,
      taught_by: STEWARD,
    });
    expect(lesson.context).toEqual([
      { role: "user", content: "Hey" },
      { role: "assistant", content: "Hi!" },
      { role: "user", content: "I had a rough day." },
    ]);
    const teacher = teacherCompletion.mock.calls[0]![0] as { messages: { role: string; content: string }[] };
    expect(teacher.messages[0]!.role).toBe("system");
    expect(teacher.messages.at(-1)).toEqual({ role: "user", content: "I had a rough day." });

    // Same turn twice: one lesson.
    const again = await json(STEWARD, "POST", "/model/auto-lesson", { turn_id: done!.turn_id });
    expect(again.body).toEqual({ queued: false, reason: "already_taught" });
    expect(lesson.id).toBe(
      lessonIdFor({ sessionId, messageId: `${done!.turn_id}:assistant`, part: 0 }),
    );
  });

  it("does nothing unless learning is switched on", async () => {
    await publishModel();
    const { done } = await ownTurn(STEWARD, "Hi");
    const res = await json(STEWARD, "POST", "/model/auto-lesson", { turn_id: done!.turn_id });
    expect(res.body).toEqual({ queued: false, reason: "not_learning" });
    expect(teacherCompletion).not.toHaveBeenCalled();
  });

  it("never learns from therapy sessions or someone else's turn", async () => {
    await publishModel({ always_learning: true });
    const therapy = await ownTurn(STEWARD, "I feel hopeless", { metadata: { therapy_mode: true } });
    expect(
      (await json(STEWARD, "POST", "/model/auto-lesson", { turn_id: therapy.done!.turn_id })).body,
    ).toEqual({ queued: false, reason: "not_learnable" });

    const mine = await ownTurn(STEWARD, "Hello");
    await mergeModelState({ answer_everyone: true, learn_from_opted_in: true });
    await call(VISITOR, "PUT", "/store/profile", { model_tutor: { share_for_training: true } });
    expect(
      (await json(VISITOR, "POST", "/model/auto-lesson", { turn_id: mine.done!.turn_id })).body,
    ).toEqual({ queued: false, reason: "turn_not_found" });
    expect(teacherCompletion).not.toHaveBeenCalled();
    expect(await listLessons()).toEqual([]);
  });

  it("learns from an opted-in user's own-model turn", async () => {
    await publishModel({ answer_everyone: true, always_learning: true, learn_from_opted_in: true });
    await call(VISITOR, "PUT", "/store/profile", { model_tutor: { share_for_training: true } });
    const { done } = await ownTurn(VISITOR, "Tell me something nice");
    const res = await json(VISITOR, "POST", "/model/auto-lesson", { turn_id: done!.turn_id });
    expect(res.status).toBe(201);
    expect((await listLessons())[0]).toMatchObject({ source: "auto", taught_by: VISITOR });
  });

  it("skips a turn the main model could not improve on", async () => {
    await publishModel({ always_learning: true });
    teacherCompletion.mockResolvedValue({ content: "The number 1746 was kind.", model: "m", brand: "anima" });
    const { done } = await ownTurn(STEWARD, "Hi");
    expect((await json(STEWARD, "POST", "/model/auto-lesson", { turn_id: done!.turn_id })).body).toEqual({
      queued: false,
      reason: "no_better_reply",
    });
  });

  it("reports a teacher failure without saving anything", async () => {
    await publishModel({ always_learning: true });
    teacherCompletion.mockRejectedValue(new Error("down"));
    const { done } = await ownTurn(STEWARD, "Hi");
    const res = await json(STEWARD, "POST", "/model/auto-lesson", { turn_id: done!.turn_id });
    expect(res.status).toBe(502);
    expect(await listLessons()).toEqual([]);
  });
});
