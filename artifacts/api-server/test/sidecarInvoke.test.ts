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
import {
  beginCompanionLlmTurn,
  resetCompanionLlmTurnForTests,
} from "../src/lib/sidecarLlm";

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
  createMock.mockReset();
  createMock.mockImplementation(async () => ({ content: "warmer, more direct" }));
  resetCompanionLlmTurnForTests();
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

  it("still calls an explicit sidecar when sidecars are enabled", async () => {
    await withSidecarEnv(true, async () => {
      const res = await invoke("generateGroupInteraction");
      expect(res.status).toBe(200);
      expect(res.json.result).toBe("warmer, more direct");
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });

  it("returns null for a background sidecar when the chain is local-only", async () => {
    await withSidecarEnv(true, async () => {
      const res = await invoke("scanAndLinkLoreKeywords");
      expect(res.status).toBe(200);
      expect(res.json.result).toBeNull();
      expect(createMock).not.toHaveBeenCalled();
    });
  });

  it("still runs a user-started unhandled function when no companion turn is open", async () => {
    await withSidecarEnv(true, async () => {
      const res = await invoke("predictNarrativeBranches");
      expect(res.status).toBe(200);
      expect(res.json.result).toBe("warmer, more direct");
      expect(createMock).toHaveBeenCalledTimes(1);
    });
  });

  it("matches lore keywords without calling the model", async () => {
    const res = await fetch(`${baseUrl}/openai/invoke/detectLoreKeywords`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user_sidecar_invoke",
      },
      body: JSON.stringify({
        content: "The harbor light is lit tonight.",
        lore_entries: [
          {
            subject: "harbor light",
            fact: "It guides ships home.",
            category: "location",
          },
        ],
      }),
    });
    const json = (await res.json()) as {
      result?: { data?: { context?: Array<{ keyword?: string; fact?: string }> } };
    };
    expect(res.status).toBe(200);
    expect(json.result?.data?.context?.[0]?.keyword).toBe("harbor light");
    expect(json.result?.data?.context?.[0]?.fact).toMatch(/guides ships/i);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("skips a non-chat local call while that user has an open companion turn", async () => {
    const release = beginCompanionLlmTurn("user_sidecar_invoke");
    try {
      await withSidecarEnv(true, async () => {
        const res = await invoke("respondMentalLine");
        expect(res.status).toBe(200);
        expect(createMock).not.toHaveBeenCalled();
      });
    } finally {
      release();
    }
  });

  it("aborts llm() upstream when the client disconnects", async () => {
    let seen: AbortSignal | undefined;
    createMock.mockImplementation((req: { signal?: AbortSignal }) => {
      seen = req.signal;
      return new Promise((_resolve, reject) => {
        const signal = req.signal;
        if (!signal) {
          reject(new Error("missing signal"));
          return;
        }
        const fail = () => reject(new Error("aborted"));
        if (signal.aborted) {
          fail();
          return;
        }
        signal.addEventListener("abort", fail, { once: true });
      });
    });

    const controller = new AbortController();
    const pending = fetch(`${baseUrl}/openai/invoke/respondMentalLine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-user": "user_sidecar_invoke",
      },
      body: JSON.stringify({ prompt: "stay with me" }),
      signal: controller.signal,
    }).catch((err: unknown) => err);
    await vi.waitFor(() => {
      expect(seen).toBeTruthy();
    });
    controller.abort();
    await vi.waitFor(() => {
      expect(seen?.aborted).toBe(true);
    });
    await pending;
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
