import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

const createMock = vi.hoisted(() =>
  vi.fn(async () => ({ content: "warmer, more direct" })),
);

vi.mock("../src/lib/llmFailover", () => ({
  createChatCompletionWithFailover: createMock,
  isLocalOnlyProviderChain: () => true,
}));

import functionsRouter from "../src/routes/openai/functions";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/openai", functionsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  createMock.mockClear();
});

async function invoke(fnName: string): Promise<{ status: number; json: { result?: unknown } }> {
  const res = await fetch(`${baseUrl}/openai/invoke/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-user": "user_sidecar_invoke",
    },
    body: JSON.stringify({
      character_id: "char-1",
      character_name: "Aria",
      max_sessions: 5,
    }),
  });
  const json = (await res.json()) as { result?: unknown };
  return { status: res.status, json };
}

async function withSidecarEnv(sidecarEnabled: boolean, run: () => Promise<void>): Promise<void> {
  const previousVitest = process.env.VITEST;
  const previousSidecar = process.env.ANIMA_SIDECAR_LLM;
  delete process.env.VITEST;
  if (sidecarEnabled) process.env.ANIMA_SIDECAR_LLM = "1";
  else delete process.env.ANIMA_SIDECAR_LLM;
  try {
    await run();
  } finally {
    if (previousVitest == null) delete process.env.VITEST;
    else process.env.VITEST = previousVitest;
    if (previousSidecar == null) delete process.env.ANIMA_SIDECAR_LLM;
    else process.env.ANIMA_SIDECAR_LLM = previousSidecar;
  }
}

describe("aggregatePersonalityShifts sidecar gate", () => {
  it("skips the model call in local-only mode", async () => {
    await withSidecarEnv(false, async () => {
      const res = await invoke("aggregatePersonalityShifts");
      expect(res.status).toBe(200);
      expect(res.json.result).toBeNull();
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  it("still calls the model when sidecars are enabled", async () => {
    await withSidecarEnv(true, async () => {
      const res = await invoke("aggregatePersonalityShifts");
      expect(res.status).toBe(200);
      expect(res.json.result).toBe("warmer, more direct");
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });

  it("still calls the model for a user-initiated invoke in local-only mode", async () => {
    await withSidecarEnv(false, async () => {
      const res = await invoke("respondMentalLine");
      expect(res.status).toBe(200);
      expect(res.json.result).toBe("warmer, more direct");
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });
});
