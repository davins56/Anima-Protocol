import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, like } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

const llmMocks = vi.hoisted(() => ({
  createChatStreamWithFailover: vi.fn(),
}));

const ragMocks = vi.hoisted(() => ({
  retrieveRepositoryKnowledge: vi.fn(async () => "REPO_RAG_BLOCK"),
}));

const embeddingMocks = vi.hoisted(() => ({
  delayMs: 400,
  startedAt: 0,
  finishedAt: 0,
  attachStoredEmbeddings: vi.fn(async (_userId: string, memories: unknown) => {
    embeddingMocks.startedAt = Date.now();
    await new Promise((resolve) => setTimeout(resolve, embeddingMocks.delayMs));
    embeddingMocks.finishedAt = Date.now();
    return memories;
  }),
}));

vi.mock("../src/lib/llmFailover", () => ({
  createChatStreamWithFailover: llmMocks.createChatStreamWithFailover,
  createChatCompletionWithFailover: vi.fn(async () => ({
    content: "Aria",
    model: "test-anima",
    tier: "light",
    provider: "local",
    brand: "anima",
    failedOver: false,
  })),
  usesFreeTierOpenBudget: () => false,
  isOpenRouterAlreadyFreeTier: () => false,
  isOpenRouterGenericProviderError: () => false,
  isOpenRouterZdrOrDataPolicyError: () => false,
  isLocalOnlyProviderChain: () => true,
  isWorkerSubrequestLimitError: () => false,
  localOnlyTimeoutMessage: () =>
    "The self-hosted Anima LLM took too long to reply. The model may still be waking — wait a moment and send again. Chat does not fall through to OpenRouter.",
  OPENROUTER_FREE_PROVIDER_HINT: "OpenRouter free-tier hint",
  OPENROUTER_ZDR_PRIVACY_HINT: "OpenRouter ZDR privacy hint",
  LOCAL_LLM_SUBREQUEST_HINT:
    "The companion could not finish this reply because the chat service is busy. Please try again in a moment. Chat does not fall through to OpenRouter or MiniMax.",
  remapGenericProviderError: (err: Error) => err,
}));

vi.mock("../src/lib/localLlmWarm", () => ({
  hintLocalLlmWarm: vi.fn(),
}));

vi.mock("../src/lib/modelRouter", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/modelRouter")>();
  return {
    ...actual,
    routeModel: () => ({
      model: "test-anima",
      tier: "standard",
      maxTokens: 8192,
    }),
  };
});

vi.mock("../src/lib/localEnsemble", () => ({
  isLocalEnsembleEnabled: () => false,
  draftLocalMinds: vi.fn(),
  combineLocalDrafts: vi.fn(),
}));

vi.mock("../src/lib/repositoryKnowledge", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/repositoryKnowledge")>();
  return {
    ...actual,
    retrieveRepositoryKnowledge: ragMocks.retrieveRepositoryKnowledge,
  };
});

vi.mock("../src/lib/memoryEmbeddings", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../src/lib/memoryEmbeddings")>();
  return {
    ...actual,
    attachStoredEmbeddings: embeddingMocks.attachStoredEmbeddings,
  };
});

import chatRouter from "../src/routes/chat";
import {
  CHAT_SESSION,
  chatMessages,
  chatSessions,
  chatTurns,
  companionMemories,
  db,
  ensureSchemaOnce,
  userEntities,
} from "@workspace/db";

const prefix = `chat_ttft_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const userId = `${prefix}_user`;
const sessionId = `${prefix}_session`;
const characterId = `${prefix}_character`;
let server: Server;
let baseUrl = "";

async function request(path: string, init: RequestInit = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": userId,
      ...(init.headers || {}),
    },
  });
}

beforeAll(async () => {
  llmMocks.createChatStreamWithFailover.mockImplementation(async () => ({
    stream: (async function* () {
      yield { choices: [{ delta: { content: "Hello " } }] };
      yield { choices: [{ delta: { content: "from Anima." } }] };
    })(),
    model: "test-anima",
    tier: "standard",
    provider: "local",
    brand: "anima",
    failedOver: false,
  }));
  await ensureSchemaOnce();
  await db.insert(userEntities).values([
    {
      userId,
      entityName: "Character",
      entityId: characterId,
      data: {
        id: characterId,
        name: "Aria",
        personality: "Warm and concise",
        universe: "Original",
      },
    },
    {
      userId,
      entityName: CHAT_SESSION,
      entityId: sessionId,
      data: {
        id: sessionId,
        title: "TTFT",
        mode: "solo",
        character_id: characterId,
        messages: [],
        messages_migrated: true,
      },
    },
  ]);

  const app: Express = express();
  app.use(express.json());
  app.use("/chat", chatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
  await db.delete(chatSessions).where(eq(chatSessions.userId, userId));
  await db.delete(chatTurns).where(eq(chatTurns.userId, userId));
  await db.delete(companionMemories).where(eq(companionMemories.userId, userId));
  await db.delete(userEntities).where(like(userEntities.userId, `${prefix}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("chat TTFT (Slice 1)", () => {
  it("sends the first SSE heartbeat before memory retrieval completes", async () => {
    embeddingMocks.startedAt = 0;
    embeddingMocks.finishedAt = 0;
    ragMocks.retrieveRepositoryKnowledge.mockClear();

    const res = await request("/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        turn_id: `turn_${prefix}_hello`,
        session_id: sessionId,
        content: "Hello, I missed you.",
        character_id: characterId,
        character_ids: [characterId],
        assistant_character_id: characterId,
        mode: "solo",
        persist: false,
        persistence_owner: "client",
        region: { share_region: false },
      }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);

    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    const first = await reader!.read();
    const firstByteAt = Date.now();
    const chunk = new TextDecoder().decode(first.value);
    expect(chunk).toMatch(/keepalive/);
    expect(chunk).toMatch(/"status":"progress"/);
    expect(chunk).toMatch(/"phase":"preparing"/);
    expect(embeddingMocks.finishedAt).toBe(0);
    expect(ragMocks.retrieveRepositoryKnowledge).not.toHaveBeenCalled();

    const rest = await new Response(
      new ReadableStream({
        start(controller) {
          if (first.value) controller.enqueue(first.value);
          const pump = async () => {
            while (true) {
              const next = await reader!.read();
              if (next.done) {
                controller.close();
                return;
              }
              if (next.value) controller.enqueue(next.value);
            }
          };
          void pump();
        },
      }),
    ).text();
    expect(rest).toContain("Hello from Anima.");
    expect(embeddingMocks.finishedAt).toBeGreaterThan(0);
    expect(firstByteAt).toBeLessThan(embeddingMocks.finishedAt);
    const sent = llmMocks.createChatStreamWithFailover.mock.calls.at(-1)?.[0] as {
      maxTokens?: number;
    };
    expect(sent.maxTokens).toBe(1024);
  });

  it("retrieves repository knowledge only for repo-shaped turns", async () => {
    ragMocks.retrieveRepositoryKnowledge.mockClear();
    embeddingMocks.delayMs = 0;

    const res = await request("/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        turn_id: `turn_${prefix}_repo`,
        session_id: sessionId,
        content: "What does this repo's wrangler.jsonc set as the worker main?",
        character_id: characterId,
        character_ids: [characterId],
        assistant_character_id: characterId,
        mode: "solo",
        persist: false,
        persistence_owner: "client",
        region: { share_region: false },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(ragMocks.retrieveRepositoryKnowledge).toHaveBeenCalledTimes(1);
    expect(text).toContain("Hello from Anima.");
  });

  it("emits waking progress JSON while the local stream is still opening", async () => {
    embeddingMocks.delayMs = 0;
    llmMocks.createChatStreamWithFailover.mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return {
        stream: (async function* () {
          yield { choices: [{ delta: { content: "Hi." } }] };
        })(),
        model: "test-anima",
        tier: "standard",
        provider: "local",
        brand: "anima",
        failedOver: false,
      };
    });

    const res = await request("/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        turn_id: `turn_${prefix}_waking`,
        session_id: sessionId,
        content: "Are you there?",
        character_id: characterId,
        character_ids: [characterId],
        assistant_character_id: characterId,
        mode: "solo",
        persist: false,
        persistence_owner: "client",
        region: { share_region: false },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/"status":"progress"/);
    expect(text).toMatch(/"phase":"waking"/);
    expect(text).toMatch(/"phase":"generating"/);
    expect(text).toContain("Hi.");
    const wakingAt = text.indexOf('"phase":"waking"');
    const hiAt = text.indexOf("Hi.");
    expect(wakingAt).toBeGreaterThanOrEqual(0);
    expect(hiAt).toBeGreaterThan(wakingAt);
  });

  it("fails clearly on a local-only open abort instead of hanging", async () => {
    embeddingMocks.delayMs = 0;
    llmMocks.createChatStreamWithFailover.mockImplementationOnce(async () => {
      const err = Object.assign(new Error("Request was aborted."), {
        name: "AbortError",
      });
      throw err;
    });

    const res = await request("/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        turn_id: `turn_${prefix}_timeout`,
        session_id: sessionId,
        content: "Hello again.",
        character_id: characterId,
        character_ids: [characterId],
        assistant_character_id: characterId,
        mode: "solo",
        persist: false,
        persistence_owner: "client",
        region: { share_region: false },
      }),
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toMatch(/"status":"progress"/);
    expect(text).toMatch(/took too long to reply/);
    expect(text).toMatch(/does not fall through to OpenRouter/);
    expect(text).not.toMatch(/"done":true/);
  });
});
