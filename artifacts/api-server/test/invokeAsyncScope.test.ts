import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AsyncLocalStorage } from "node:async_hooks";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const researchMock = vi.hoisted(() => vi.fn());
vi.mock("../src/lib/characterResearch", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/characterResearch")>()),
  researchCharacter: researchMock,
}));

// Behave like the Workers runtime: AsyncLocalStorage has run()/getStore()
// but enterWith() throws ("asyncLocalStorage.enterWith() is not implemented").
vi.mock("node:async_hooks", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:async_hooks")>();
  class WorkerdAsyncLocalStorage<T> {
    #inner = new real.AsyncLocalStorage<T>();
    run<R>(store: T, fn: (...args: unknown[]) => R, ...args: unknown[]): R {
      return this.#inner.run(store, fn, ...args);
    }
    getStore(): T | undefined {
      return this.#inner.getStore();
    }
    exit<R>(fn: (...args: unknown[]) => R, ...args: unknown[]): R {
      return this.#inner.exit(fn, ...args);
    }
    enterWith(): never {
      throw new Error("asyncLocalStorage.enterWith() is not implemented");
    }
    disable(): never {
      throw new Error("asyncLocalStorage.disable() is not implemented");
    }
    static bind = real.AsyncLocalStorage.bind;
    static snapshot = real.AsyncLocalStorage.snapshot;
  }
  return { ...real, default: { ...real, AsyncLocalStorage: WorkerdAsyncLocalStorage }, AsyncLocalStorage: WorkerdAsyncLocalStorage };
});

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

const createMock = vi.hoisted(() =>
  vi.fn(async (args: { signal?: AbortSignal }) => {
    void args;
    return { content: "The story keeps circling trust." };
  }),
);
vi.mock("../src/lib/llmFailover", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/lib/llmFailover")>()),
  createChatCompletionWithFailover: createMock,
  isLocalOnlyProviderChain: () => false,
}));

import functionsRouter from "../src/routes/openai/functions";

let server: Server;
let baseUrl = "";

beforeAll(async () => {
  const app: Express = express();
  app.use(express.json());
  app.use("/openai", functionsRouter);
  // Same shape as app.ts: anything that escapes a route lands here.
  app.use((err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
    void err;
    void next;
    res.status(500).json({ error: "unhandled" });
  });
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function invoke(fnName: string, body: unknown) {
  const res = await fetch(`${baseUrl}/openai/invoke/${fnName}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-test-user": "user_invoke_scope" },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as { result?: unknown; error?: string } };
}

describe("/openai/invoke on a runtime without AsyncLocalStorage.enterWith", () => {
  it("the stub really throws (guards the test itself)", () => {
    expect(() => new AsyncLocalStorage().enterWith({})).toThrow(/not implemented/);
  });

  it("a function with no model call answers 200", async () => {
    const r = await invoke("exportSessionData", { session_id: "s1" });
    expect(r.status).toBe(200);
    expect(r.json.result).toMatchObject({ data: { session_id: "s1" } });
  });

  it("generateInsightsSummary reaches the model and answers 200", async () => {
    createMock.mockClear();
    const r = await invoke("generateInsightsSummary", {
      session_id: "s1",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(r.status).toBe(200);
    expect(r.json.result).toBe("The story keeps circling trust.");
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock.mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it("a model failure is a handled JSON 500, not an escaped error", async () => {
    createMock.mockRejectedValueOnce(new Error("upstream down"));
    const r = await invoke("generateInsightsSummary", { session_id: "s1", messages: [] });
    expect(r.status).toBe(500);
    expect(r.json.error).toBe("upstream down");
  });

  it("passes the adaptation to research and returns sources with the generated profile", async () => {
    const research = { status: "sources_found", version: "original novels", sources: [{ title: "Holmes", url: "https://example.org/holmes", snippet: "A consulting detective." }] };
    researchMock.mockResolvedValueOnce(research);
    createMock.mockResolvedValueOnce({ content: JSON.stringify({ name: "Sherlock Holmes", is_real_character: true }) });
    const r = await invoke("generateCompanionFromPrompt", { prompt: "Sherlock Holmes", canon_version: "original novels" });
    expect(r.status).toBe(200);
    expect(researchMock).toHaveBeenLastCalledWith("Sherlock Holmes", { query: "Sherlock Holmes", enabled: true, version: "original novels" });
    expect(r.json.result).toMatchObject({ success: true, companion: { research, is_real_character: true } });
  });

  it("does not label an unavailable search as researched even if the model claims it", async () => {
    researchMock.mockResolvedValueOnce({ status: "unavailable", sources: [], version: "" });
    createMock.mockResolvedValueOnce({ content: JSON.stringify({ name: "Holmes", is_real_character: true }) });
    const r = await invoke("generateCompanionFromPrompt", { prompt: "Holmes" });
    expect(r.json.result).toMatchObject({ companion: { is_real_character: false, research: { status: "unavailable" } } });
  });
});

describe("server code never calls AsyncLocalStorage.enterWith", () => {
  it("no .enterWith( call in api-server src", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(ts|js|mjs)$/.test(name)) {
          readFileSync(p, "utf8")
            .split("\n")
            .forEach((line, i) => {
              const code = line.replace(/\/\/.*$/, "");
              if (/\.enterWith\s*\(/.test(code)) hits.push(`${p}:${i + 1}`);
            });
        }
      }
    };
    walk(join(__dirname, "..", "src"));
    expect(hits).toEqual([]);
  });
});
