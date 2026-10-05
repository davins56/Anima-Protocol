import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

const llmMocks = vi.hoisted(() => ({
  createChatStreamWithFailover: vi.fn(),
  createChatCompletionWithFailover: vi.fn(),
}));

vi.mock("../src/lib/llmFailover", () => ({
  createChatStreamWithFailover: llmMocks.createChatStreamWithFailover,
  createChatCompletionWithFailover: llmMocks.createChatCompletionWithFailover,
  usesFreeTierOpenBudget: () => false,
}));

vi.mock("../src/lib/modelRouter", () => ({
  routeModel: () => ({
    model: "test-deepseek",
    tier: "standard",
    maxTokens: 200,
  }),
}));

import openaiRouter from "../src/routes/openai/index";
import {
  conversations,
  db,
  ensureSchemaOnce,
  messages,
} from "@workspace/db";
import { eq } from "drizzle-orm";

const prefix = `openai_auth_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const userId = `${prefix}_user`;
let server: Server;
let baseUrl = "";
let conversationId = 0;

function sseEvents(text: string): Array<Record<string, unknown>> {
  return text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as Record<string, unknown>);
}

async function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => {
  await ensureSchemaOnce();
  const [row] = await db
    .insert(conversations)
    .values({ userId, title: `${prefix} thread` })
    .returning();
  conversationId = row!.id;

  const app: Express = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/openai", openaiRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await db.delete(messages).where(eq(messages.conversationId, conversationId));
  await db.delete(conversations).where(eq(conversations.id, conversationId));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  llmMocks.createChatStreamWithFailover.mockReset();
  llmMocks.createChatCompletionWithFailover.mockReset();
  llmMocks.createChatStreamWithFailover.mockImplementation(async () => ({
    stream: (async function* () {
      yield { choices: [{ delta: { content: "<think>plan the line</think>\n\nStay close." } }] };
    })(),
    model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    tier: "standard",
    provider: "workersai",
    brand: "workersai",
    failedOver: false,
  }));
  llmMocks.createChatCompletionWithFailover.mockImplementation(async () => ({
    content: "<think>hidden</think>\nVisible.",
    model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    tier: "standard",
    provider: "workersai",
    brand: "workersai",
    failedOver: false,
  }));
});

describe("authenticated /openai chat paths", () => {
  it("returns 401 JSON on /v1/chat/completions without Clerk", async () => {
    const res = await post("/openai/v1/chat/completions", { content: "hello" });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "Unauthorized" });
    expect(llmMocks.createChatStreamWithFailover).not.toHaveBeenCalled();
  });

  it("returns 401 JSON on conversation messages without Clerk", async () => {
    const res = await post(`/openai/conversations/${conversationId}/messages`, {
      content: "hello",
    });
    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toMatchObject({ error: "Unauthorized" });
    expect(llmMocks.createChatStreamWithFailover).not.toHaveBeenCalled();
  });

  it("streams a visible DeepSeek reply on signed-in /v1/chat/completions", async () => {
    const res = await post(
      "/openai/v1/chat/completions",
      { content: "hello" },
      { "x-test-user": userId },
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(200);
    const events = sseEvents(text);
    const content = events
      .map((event) => (typeof event.content === "string" ? event.content : ""))
      .join("");
    expect(content).toBe("Stay close.");
    expect(events.some((event) => event.done === true)).toBe(true);
    expect(events.some((event) => event.provider === "workersai")).toBe(true);
    expect(llmMocks.createChatStreamWithFailover).toHaveBeenCalledTimes(1);
  });

  it("streams a think-only DeepSeek reply instead of an empty error", async () => {
    llmMocks.createChatStreamWithFailover.mockImplementation(async () => ({
      stream: (async function* () {
        yield { choices: [{ delta: { content: "<think>I hear you. Stay close.</think>" } }] };
      })(),
      model: "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
      tier: "standard",
      provider: "workersai",
      brand: "workersai",
      failedOver: false,
    }));

    const res = await post(
      `/openai/conversations/${conversationId}/messages`,
      { content: "are you there?" },
      { "x-test-user": userId },
    );
    const text = await res.text();
    expect(res.status, text.slice(0, 400)).toBe(200);
    const events = sseEvents(text);
    const content = events
      .map((event) => (typeof event.content === "string" ? event.content : ""))
      .join("");
    expect(content).toBe("I hear you. Stay close.");
    expect(events.some((event) => event.error)).toBe(false);
    expect(events.some((event) => event.done === true)).toBe(true);
  });

  it("returns a non-empty JSON completion when stream is false", async () => {
    const res = await post(
      "/openai/v1/chat/completions",
      { content: "hello", stream: false },
      { "x-test-user": userId },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.choices[0].message.content).toBe("Visible.");
    expect(json.provider).toBe("workersai");
  });
});
