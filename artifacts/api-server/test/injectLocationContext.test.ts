import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

const { createMock, localOnly } = vi.hoisted(() => {
  return {
    localOnly: { value: true },
    createMock: vi.fn(async () => ({ content: "Salt wind and guttering lamps." })),
  };
});

vi.mock("../src/lib/llmFailover", () => ({
  createChatCompletionWithFailover: createMock,
  isLocalOnlyProviderChain: () => localOnly.value,
}));

import functionsRouter, {
  LOCATION_CONTEXT_TIMEOUT_MS,
} from "../src/routes/openai/functions";

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
  localOnly.value = true;
});

async function invoke(
  fnName: string,
  body: unknown,
): Promise<{ status: number; json: any }> {
  const res = await fetch(`${baseUrl}/openai/invoke/${fnName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-test-user": "user_location_context",
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json: any = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = text;
    }
  }
  return { status: res.status, json };
}

describe("injectLocationContext", () => {
  it("skips the model call when chat is local-only", async () => {
    localOnly.value = true;

    const named = await invoke("injectLocationContext", {
      location_name: "Neon Harbor",
      session_id: "sess-1",
      character_name: "Serenity",
    });
    expect(named.status).toBe(200);
    expect(named.json.result).toBe("Setting: Neon Harbor.");
    expect(createMock).not.toHaveBeenCalled();

    const unnamed = await invoke("injectLocationContext", {
      session_id: "sess-1",
      character_id: "char-1",
      character_name: "Serenity",
    });
    expect(unnamed.status).toBe(200);
    expect(unnamed.json.result).toBe("");
    expect(createMock).not.toHaveBeenCalled();
  });

  it("drops a non-local location context call at a short timeout", async () => {
    localOnly.value = false;
    const timeoutSpy = vi.spyOn(AbortSignal, "timeout");
    createMock.mockImplementation((req: { signal?: AbortSignal }) => {
      return new Promise((_resolve, reject) => {
        const signal = req.signal;
        if (!signal) {
          reject(new Error("missing timeout signal"));
          return;
        }
        const onAbort = () => reject(signal.reason ?? new Error("aborted"));
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
      });
    });

    const started = Date.now();
    const res = await invoke("injectLocationContext", { location: "the docks" });
    const elapsed = Date.now() - started;

    expect(res.status).toBe(200);
    expect(res.json.result).toBe("Setting: the docks.");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(timeoutSpy).toHaveBeenCalledWith(LOCATION_CONTEXT_TIMEOUT_MS);
    expect(elapsed).toBeGreaterThanOrEqual(LOCATION_CONTEXT_TIMEOUT_MS - 250);
    expect(elapsed).toBeLessThan(LOCATION_CONTEXT_TIMEOUT_MS + 2_000);
    timeoutSpy.mockRestore();
  });
});
