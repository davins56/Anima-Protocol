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

const llmMocks = vi.hoisted(() => ({
  createChatStreamWithFailover: vi.fn(),
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
}));

vi.mock("../src/lib/modelRouter", () => ({
  routeModel: () => ({
    model: "test-anima",
    tier: "standard",
    maxTokens: 200,
  }),
}));

vi.mock("../src/lib/localEnsemble", () => ({
  isLocalEnsembleEnabled: () => false,
  draftLocalMinds: vi.fn(),
  combineLocalDrafts: vi.fn(),
}));

import chatRouter from "../src/routes/chat";
import {
  CHAT_MESSAGE,
  CHAT_SESSION,
  chatMessages,
  chatSessions,
  chatTurns,
  db,
  ensureSchemaOnce,
  userEntities,
} from "@workspace/db";

const prefix = `chat_lifecycle_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const userId = `${prefix}_user`;
const sessionId = `${prefix}_session`;
const characterId = `${prefix}_character`;
const turnId = `turn_${prefix}`;
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

function sseEvents(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
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
        title: "Lifecycle",
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
  await db.delete(userEntities).where(like(userEntities.userId, `${prefix}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("chat lifecycle", () => {
  it("streams, checkpoints, retries idempotently, and replays a turn", async () => {
    const first = await request("/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        turn_id: turnId,
        session_id: sessionId,
        content: "Hello",
        character_id: characterId,
        character_ids: [characterId],
        assistant_character_id: characterId,
        mode: "solo",
        persist: true,
        region: { share_region: false },
      }),
    });
    expect(first.status).toBe(200);
    const events = sseEvents(await first.text());
    expect(
      events.filter((event) => typeof event.content === "string").map((event) => event.content).join(""),
    ).toBe("Hello from Anima.");
    expect(events.at(-1)).toMatchObject({
      done: true,
      turn_id: turnId,
      persistence_status: "generated",
    });

    const retry = await request(`/chat/turns/${turnId}/retry`, {
      method: "POST",
      body: "{}",
    });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toMatchObject({ persistence_status: "committed" });

    const stored = await db
      .select()
      .from(userEntities)
      .where(
        and(
          eq(userEntities.userId, userId),
          eq(userEntities.entityName, CHAT_MESSAGE),
        ),
      );
    expect(stored.map((row) => row.entityId).sort()).toEqual([
      `${turnId}:assistant`,
      `${turnId}:user`,
    ]);

    const replay = await request("/chat/messages", {
      method: "POST",
      body: JSON.stringify({
        turn_id: turnId,
        session_id: sessionId,
        content: "Hello",
        character_id: characterId,
        mode: "solo",
      }),
    });
    const replayEvents = sseEvents(await replay.text());
    expect(replayEvents.at(-1)).toMatchObject({
      done: true,
      replayed: true,
      persistence_status: "committed",
    });
    expect(llmMocks.createChatStreamWithFailover).toHaveBeenCalledTimes(1);
  });
});
