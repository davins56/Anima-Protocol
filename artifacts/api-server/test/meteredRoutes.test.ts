import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

const mocks = vi.hoisted(() => ({
  generatePhoto: vi.fn(),
  consume: vi.fn(),
  refund: vi.fn(),
  balances: vi.fn(),
  routeModel: vi.fn(),
  completion: vi.fn(),
}));

vi.mock("../src/lib/photo/generatePhoto", () => ({ generatePhoto: mocks.generatePhoto }));
vi.mock("../src/lib/billing/ledger", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/billing/ledger")>();
  return {
    ...actual,
    consumeEntitlement: mocks.consume,
    refundEntitlement: mocks.refund,
    entitlementBalances: mocks.balances,
  };
});
vi.mock("../src/lib/modelRouter", () => ({ routeModel: mocks.routeModel }));
vi.mock("../src/lib/llmFailover", () => ({
  createChatStreamWithFailover: vi.fn(),
  createChatCompletionWithFailover: mocks.completion,
  usesFreeTierOpenBudget: () => false,
}));

import photoRouter from "../src/routes/photo";
import openaiRouter from "../src/routes/openai/index";
import elevenLabsRouter from "../src/routes/elevenlabs";
import { InsufficientEntitlementError } from "../src/lib/billing/ledger";
import { resetUserLimiterForTests } from "../src/lib/usage/userRateLimit";
import { resetRateLimitStateForTests } from "../src/lib/rateLimit";

let server: Server;
let base = "";
const savedEnv = { ...process.env };
const nativeFetch = globalThis.fetch.bind(globalThis);
const elevenFetch = vi.fn();

beforeAll(async () => {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) =>
    String(input).includes("api.elevenlabs.io") ? elevenFetch(input, init) : nativeFetch(input, init),
  );
  const app = express();
  app.use(express.json());
  app.use(photoRouter);
  app.use("/openai", openaiRouter);
  app.use(elevenLabsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  vi.unstubAllGlobals();
  process.env = savedEnv;
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetUserLimiterForTests();
  resetRateLimitStateForTests();
  for (const m of Object.values(mocks)) m.mockReset();
  elevenFetch.mockReset();
  process.env.ANIMA_FREE_PHOTOS_PER_DAY = "1";
  process.env.ANIMA_FREE_VOICE_UNITS_PER_DAY = "1";
  delete process.env.ANIMA_METERING;
  delete process.env.ANIMA_METERING_EXEMPT_USER_IDS;
  process.env.ELEVENLABS_API_KEY = "test-eleven";
  mocks.routeModel.mockImplementation((_text: string, opts: { deepMode?: boolean }) => ({
    model: opts.deepMode ? "deep-model" : "std-model",
    tier: opts.deepMode ? "deep" : "standard",
    maxTokens: 100,
  }));
  mocks.completion.mockResolvedValue({ content: "ok", model: "m", provider: "p" });
});

function post(path: string, body: unknown, user: string | null = "user_m") {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(user ? { "x-test-user": user } : {}) },
    body: JSON.stringify(body),
  });
}

describe("POST /photo/generate metering", () => {
  it("uses the free photo, then 402s before calling the provider when there are no credits", async () => {
    mocks.generatePhoto.mockImplementation(async (_req: unknown, emit: (e: unknown) => void) => {
      emit({ type: "image", imageId: "i", url: "/x" });
      emit({ type: "done", imageId: "i" });
    });
    mocks.consume.mockRejectedValue(new InsufficientEntitlementError("none"));

    const first = await post("/photo/generate", { characterId: "c1" });
    expect(first.status).toBe(200);
    await first.text();
    expect(mocks.generatePhoto).toHaveBeenCalledTimes(1);

    const second = await post("/photo/generate", { characterId: "c1" });
    expect(second.status).toBe(402);
    expect(await second.json()).toMatchObject({ code: "insufficient_entitlement", entitlement: "photo_credits" });
    expect(mocks.generatePhoto).toHaveBeenCalledTimes(1);
  });

  it("spends a credit before the provider and refunds it when no image comes back", async () => {
    process.env.ANIMA_FREE_PHOTOS_PER_DAY = "0";
    const order: string[] = [];
    mocks.consume.mockImplementation(async () => {
      order.push("consume");
      return 4;
    });
    mocks.generatePhoto.mockImplementation(async () => {
      order.push("provider");
      throw new Error("fal down");
    });
    const res = await post("/photo/generate", { characterId: "c1" });
    await res.text();
    expect(order).toEqual(["consume", "provider"]);
    expect(mocks.refund).toHaveBeenCalledTimes(1);
    const useKey = (mocks.consume.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey;
    expect(mocks.refund.mock.calls[0]![0]).toMatchObject({ entitlement: "photo_credits", idempotencyKey: useKey });
  });

  it("ignores a client-supplied idempotency key", async () => {
    process.env.ANIMA_FREE_PHOTOS_PER_DAY = "0";
    mocks.consume.mockResolvedValue(3);
    mocks.generatePhoto.mockImplementation(async (_r: unknown, emit: (e: unknown) => void) => emit({ type: "image", imageId: "i", url: "/x" }));
    await (await post("/photo/generate", { characterId: "c1", idempotencyKey: "replay-me" })).text();
    expect((mocks.consume.mock.calls[0]![0] as { idempotencyKey: string }).idempotencyKey).not.toBe("replay-me");
  });
});

describe("generic chat proxy", () => {
  it("downgrades deep_mode without an active pass and allows it with one", async () => {
    mocks.balances.mockResolvedValueOnce({ photo_credits: 0, voice_minutes: 0, deep_mode_active_until: null });
    const plain = await post("/openai/v1/chat/completions", { content: "hi", deep_mode: true, stream: false });
    expect(plain.status).toBe(200);
    expect(mocks.routeModel.mock.calls[0]![1]).toMatchObject({ deepMode: false });

    mocks.balances.mockResolvedValueOnce({ photo_credits: 0, voice_minutes: 0, deep_mode_active_until: "2099-01-01T00:00:00Z" });
    await post("/openai/v1/chat/completions", { content: "hi", deep_mode: true, stream: false });
    expect(mocks.routeModel.mock.calls[1]![1]).toMatchObject({ deepMode: true });
  });

  it("applies the durable per-user limit with 429 + Retry-After", async () => {
    process.env.ANIMA_RL_CHAT_PROXY_PER_MIN = "1";
    try {
      expect((await post("/openai/v1/chat/completions", { content: "hi", stream: false })).status).toBe(200);
      const limited = await post("/openai/v1/chat/completions", { content: "hi", stream: false });
      expect(limited.status).toBe(429);
      expect(limited.headers.get("retry-after")).toBeTruthy();
    } finally {
      delete process.env.ANIMA_RL_CHAT_PROXY_PER_MIN;
    }
  });
});

describe("POST /tts metering", () => {
  it("charges voice units before ElevenLabs and refunds a provider error", async () => {
    process.env.ANIMA_FREE_VOICE_UNITS_PER_DAY = "0";
    mocks.consume.mockResolvedValue(10);
    elevenFetch.mockResolvedValue(new Response("boom", { status: 500 }));
    const res = await post("/tts", { text: "x".repeat(1000) });
    expect(res.status).toBe(500);
    expect(mocks.consume.mock.calls[0]![0]).toMatchObject({ entitlement: "voice_minutes", units: 2 });
    expect(mocks.refund).toHaveBeenCalledTimes(1);
  });

  it("402s without calling ElevenLabs when out of voice", async () => {
    process.env.ANIMA_FREE_VOICE_UNITS_PER_DAY = "0";
    mocks.consume.mockRejectedValue(new InsufficientEntitlementError("none"));
    const res = await post("/tts", { text: "hello" });
    expect(res.status).toBe(402);
    expect(elevenFetch).not.toHaveBeenCalled();
  });
});
