import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import { resolveModel } from "../src/lib/modelRouter";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? "codespace-user",
  }),
}));

const completion = vi.fn();

vi.mock("../src/lib/llmFailover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/llmFailover")>()),
  createChatCompletionWithFailover: (...args: unknown[]) => completion(...args),
}));

import repoCodespaceRouter from "../src/routes/repoCodespace";
import { setLocalChatActivityProbeForTests } from "../src/lib/localLlmPriority";
import { resetLocalLlmSlotForTests } from "../src/lib/localLlmSlot";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/repo-codespace", repoCodespaceRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

afterEach(() => {
  completion.mockReset();
  setLocalChatActivityProbeForTests(null);
  resetLocalLlmSlotForTests();
});

async function agentStep(): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/repo-codespace/agent-step`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": "codespace-user" },
    body: JSON.stringify({
      messages: [{ role: "user", content: "Add a comment to the top of the file." }],
      character: { name: "Serenity" },
    }),
  });
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`HTTP ${res.status} from agent-step: ${text.slice(0, 240)}`);
  }
  return { status: res.status, json };
}

describe("user-waited local jobs keep their own budget", () => {
  it("keeps the codespace heavy budget and provider chain when chat is idle", async () => {
    setLocalChatActivityProbeForTests(async () => false);
    completion.mockResolvedValue({
      content: "I opened the file.",
      model: "gpt-4.1",
      provider: "openai",
      toolCalls: null,
    });
    const heavy = resolveModel("heavy");
    const res = await agentStep();
    expect(res.status).toBe(200);
    expect(completion).toHaveBeenCalledTimes(1);
    const request = completion.mock.calls[0]![0] as {
      maxTokens: number;
      localOnly?: boolean;
      signal?: AbortSignal;
    };
    expect(request.maxTokens).toBe(heavy.maxTokens);
    expect(request.maxTokens).toBeGreaterThan(80);
    expect(request.localOnly).not.toBe(true);
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 429 for codespace while companion chat is active and does not call the model", async () => {
    setLocalChatActivityProbeForTests(async () => true);
    const res = await agentStep();
    expect(res.status).toBe(429);
    expect(res.json.code).toBe("llm_busy");
    expect(completion).not.toHaveBeenCalled();
  });
});
