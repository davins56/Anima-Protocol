import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
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

import { db, userEntities, userProfiles } from "@workspace/db";
import { like } from "drizzle-orm";
import chatRouter from "../src/routes/chat";
import storeRouter from "../src/routes/store";
import { streamErrorMessage } from "../src/lib/chatStreamError";
import { LlmStreamTimeoutError, consumeLlmStream } from "../src/lib/consumeLlmStream";
import {
  OWN_MODEL_AUTH_HINT,
  OWN_MODEL_EMPTY_REPLY,
  OWN_MODEL_TIMEOUT_HINT,
  OWN_MODEL_UNAVAILABLE_HINT,
  asOwnModelError,
  buildOwnModelMessages,
  createOwnModelChatStream,
  ownModelBaseUrl,
  ownModelChatPreference,
  resetOwnModelForTests,
  wantsOwnModelReply,
} from "../src/lib/ownModel";

const PREFIX = `own_model_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const SAVED_ENV = { ...process.env };

type StubReply = { status?: number; deltas?: string[]; hang?: boolean };
let stubReply: StubReply = {};
const stubRequests: { headers: IncomingMessage["headers"]; body: Record<string, unknown> }[] = [];
let stub: Server;
let stubOrigin = "";

function sseChunk(delta: Record<string, unknown>, finish: string | null = null) {
  return `data: ${JSON.stringify({
    id: "chatcmpl-stub",
    object: "chat.completion.chunk",
    created: 0,
    model: "anima-own",
    choices: [{ index: 0, delta, finish_reason: finish }],
  })}\n\n`;
}

function handleStub(req: IncomingMessage, res: ServerResponse) {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    stubRequests.push({ headers: req.headers, body: JSON.parse(raw || "{}") });
    if (stubReply.status && stubReply.status !== 200) {
      res.writeHead(stubReply.status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "nope", error: { message: "nope" } }));
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(sseChunk({ role: "assistant", content: "" }));
    if (stubReply.hang) return;
    for (const d of stubReply.deltas ?? ["Hello ", "from my model."]) {
      res.write(sseChunk({ content: d }));
    }
    res.write(sseChunk({}, "stop"));
    res.end("data: [DONE]\n\n");
  });
}

beforeAll(async () => {
  stub = createServer(handleStub);
  await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
  stubOrigin = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
});

afterAll(async () => {
  stub.closeAllConnections();
  await new Promise<void>((resolve) => stub.close(() => resolve()));
});

beforeEach(() => {
  process.env.ANIMA_RUNTIME = "node";
  process.env.ANIMA_OWN_LLM_BASE_URL = `${stubOrigin}/v1`;
  process.env.ANIMA_OWN_LLM_API_KEY = "own-token";
  process.env.PROTOCOL_UPGRADE_ADMIN_USER_IDS = `${PREFIX}steward`;
  delete process.env.CLERK_SECRET_KEY;
  stubReply = {};
  stubRequests.length = 0;
  resetOwnModelForTests();
});

afterEach(() => {
  process.env = { ...SAVED_ENV };
  resetOwnModelForTests();
});

describe("own model config", () => {
  it("normalises the base URL and refuses loopback where it cannot be reached", () => {
    expect(ownModelBaseUrl({})).toBeNull();
    expect(ownModelBaseUrl({ ANIMA_OWN_LLM_BASE_URL: "https://me.fly.dev" })).toBe("https://me.fly.dev/v1");
    expect(ownModelBaseUrl({ ANIMA_OWN_LLM_BASE_URL: "https://me.fly.dev/v1/" })).toBe("https://me.fly.dev/v1");
    expect(ownModelBaseUrl({ ANIMA_OWN_LLM_BASE_URL: "me.fly.dev" })).toBeNull();
    expect(
      ownModelBaseUrl({ ANIMA_OWN_LLM_BASE_URL: "http://127.0.0.1:8000/v1", ANIMA_RUNTIME: "worker" }),
    ).toBeNull();
    expect(
      ownModelBaseUrl({ ANIMA_OWN_LLM_BASE_URL: "http://127.0.0.1:8000/v1", ANIMA_RUNTIME: "node" }),
    ).toBe("http://127.0.0.1:8000/v1");
  });

  it("reads the switch from the profile, not from settings", () => {
    expect(ownModelChatPreference({ model_tutor: { own_model_chat: true } })).toBe(true);
    expect(ownModelChatPreference({ settings: { own_model_chat: true } })).toBe(false);
    expect(ownModelChatPreference(null)).toBe(false);
  });

  it("routes only stewards who switched it on, and only when the model is connected", async () => {
    const on = { model_tutor: { own_model_chat: true } };
    expect(await wantsOwnModelReply({ userId: `${PREFIX}steward`, profile: on })).toBe(true);
    expect(await wantsOwnModelReply({ userId: `${PREFIX}steward`, profile: {} })).toBe(false);
    expect(await wantsOwnModelReply({ userId: `${PREFIX}someone`, profile: on })).toBe(false);
    delete process.env.ANIMA_OWN_LLM_BASE_URL;
    expect(await wantsOwnModelReply({ userId: `${PREFIX}steward`, profile: on })).toBe(false);
  });

  it("sends the conversation without the character sheet", () => {
    const messages = buildOwnModelMessages(
      [
        { role: "user", content: "Hi" },
        { role: "assistant", content: "Hello!" },
        { role: "assistant", content: "...", character_name: "__typing__" },
        { role: "user", content: "How are you?" },
      ],
      "How are you?",
    );
    expect(messages).toEqual([
      { role: "user", content: "Hi" },
      { role: "assistant", content: "Hello!" },
      { role: "user", content: "How are you?" },
    ]);
  });
});

describe("own model stream", () => {
  it("streams OpenAI chunks with the model id and bearer key", async () => {
    const opened = await createOwnModelChatStream({
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 64,
      temperature: 0.5,
    });
    expect(opened).toMatchObject({ provider: "own", brand: "own", model: "anima-own", failedOver: false });
    const result = await consumeLlmStream(opened.stream);
    expect(result.content).toBe("Hello from my model.");
    expect(stubRequests[0]!.headers.authorization).toBe("Bearer own-token");
    expect(stubRequests[0]!.body).toMatchObject({ model: "anima-own", stream: true, max_tokens: 64 });
  });

  it("explains auth and connection failures in the steward's terms", async () => {
    stubReply = { status: 401 };
    await expect(
      createOwnModelChatStream({ messages: [{ role: "user", content: "Hi" }], maxTokens: 8 }),
    ).rejects.toMatchObject({ name: "OwnModelError", message: OWN_MODEL_AUTH_HINT });

    process.env.ANIMA_OWN_LLM_BASE_URL = "http://127.0.0.1:1/v1";
    resetOwnModelForTests();
    await expect(
      createOwnModelChatStream({ messages: [{ role: "user", content: "Hi" }], maxTokens: 8 }),
    ).rejects.toMatchObject({ name: "OwnModelError", message: OWN_MODEL_UNAVAILABLE_HINT });
  });

  it("keeps its own wording through the chat error mapper", () => {
    expect(asOwnModelError(new LlmStreamTimeoutError("slow")).message).toBe(OWN_MODEL_TIMEOUT_HINT);
    const err = asOwnModelError(Object.assign(new Error("400 bad request"), { status: 400 }));
    expect(streamErrorMessage(err)).toBe(err.message);
    expect(err.message).toContain("Your own model could not reply");
  });
});

describe("POST /chat/messages with the own model", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    const app: Express = express();
    app.use(express.json({ limit: "4mb" }));
    app.use("/store", storeRouter);
    app.use("/chat", chatRouter);
    await new Promise<void>((resolve) => {
      server = app.listen(0, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
    await db.delete(userProfiles).where(like(userProfiles.userId, `${PREFIX}%`));
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  async function call(user: string, method: string, path: string, body?: unknown) {
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-test-user": user },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  }

  async function chatAs(user: string, content: string) {
    const suffix = Math.random().toString(36).slice(2, 8);
    const characterId = `${PREFIX}char_${suffix}`;
    const sessionId = `${PREFIX}sess_${suffix}`;
    await call(user, "PUT", `/store/Character/${characterId}`, { name: "Aria", universe: "Original" });
    await call(user, "PUT", `/store/ChatSession/${sessionId}`, {
      character_id: characterId,
      mode: "solo",
      title: "Own model",
    });
    await call(user, "PUT", "/store/profile", {
      settings: { theme_mode: "dark" },
      model_tutor: { own_model_chat: true },
    });
    const res = await call(user, "POST", "/chat/messages", {
      session_id: sessionId,
      content,
      character_id: characterId,
      mode: "solo",
      persist: false,
    });
    const events = (await res.text())
      .split("\n")
      .filter((line) => line.startsWith("data: "))
      .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
    return { status: res.status, events };
  }

  it("answers a steward's turn with their own model", async () => {
    const { status, events } = await chatAs(`${PREFIX}steward`, "Hi there");
    expect(status).toBe(200);
    const done = events.find((e) => e.done === true);
    expect(done, JSON.stringify(events).slice(0, 500)).toMatchObject({
      provider: "own",
      brand: "own",
      model: "anima-own",
      visible: "Hello from my model.",
    });
    const sent = stubRequests.at(-1)!.body as { messages: { role: string; content: string }[] };
    expect(sent.messages.some((m) => m.role === "system")).toBe(false);
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: "Hi there" });
  });

  it("never routes someone who is not a steward, whatever their profile says", async () => {
    const { events } = await chatAs(`${PREFIX}visitor`, "Hi there");
    expect(stubRequests).toHaveLength(0);
    expect(events.find((e) => e.done === true)?.provider).not.toBe("own");
  });

  it("keeps an empty reply as a teachable bubble", async () => {
    stubReply = { deltas: [] };
    const { events } = await chatAs(`${PREFIX}steward`, "Hello?");
    expect(events.find((e) => e.done === true)).toMatchObject({
      provider: "own",
      visible: OWN_MODEL_EMPTY_REPLY,
    });
  });

  it("fails closed with a clear message when the model is down", async () => {
    process.env.ANIMA_OWN_LLM_BASE_URL = "http://127.0.0.1:1/v1";
    resetOwnModelForTests();
    const { events } = await chatAs(`${PREFIX}steward`, "Hi there");
    expect(events.find((e) => typeof e.error === "string")?.error).toBe(OWN_MODEL_UNAVAILABLE_HINT);
  });
});
