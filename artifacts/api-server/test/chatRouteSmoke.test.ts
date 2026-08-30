import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import express, { type Express } from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import chatRouter from "../src/routes/chat";
import storeRouter from "../src/routes/store";
import { db, userEntities } from "@workspace/db";
import { like } from "drizzle-orm";
import { hasLocalLlm, localLlmBaseUrl } from "../src/lib/openaiClient";

const PREFIX = `chat_smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}_`;
const userId = `${PREFIX}user`;
const sessionId = `${PREFIX}sess`;
const characterId = `${PREFIX}char`;

let server: Server;
let baseUrl = "";
let liveLlmAvailable = false;

async function probeLiveLocalLlm(): Promise<boolean> {
  if (!hasLocalLlm()) return false;
  const base = localLlmBaseUrl();
  if (!base) return false;
  try {
    const modelsUrl = base.replace(/\/+$/, "") + "/models";
    const res = await fetch(modelsUrl, {
      signal: AbortSignal.timeout(3_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

beforeAll(async () => {
  liveLlmAvailable = await probeLiveLocalLlm();
  const app: Express = express();
  app.use(express.json({ limit: "4mb" }));
  app.use("/store", storeRouter);
  app.use("/chat", chatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await db.delete(userEntities).where(like(userEntities.userId, `${PREFIX}%`));
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function call(method: string, path: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "x-test-user": userId,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("chat route AI response (live local LLM)", () => {
  it(
    "streams a non-empty assistant reply from anima-chat",
    async ({ skip }) => {
      if (!liveLlmAvailable) {
        skip(
          "Skipped: no reachable ANIMA_LOCAL_LLM_BASE_URL (set a live OpenAI-compatible Anima LLM to run this smoke test).",
        );
      }

      // PUT upserts with a stable entityId (POST always mints a new entityId).
      const charRes = await call("PUT", `/store/Character/${characterId}`, {
        name: "Aria",
        universe: "Original",
        category: "companion",
        personality: "warm and brief",
      });
      expect(charRes.status).toBeLessThan(300);

      const sessRes = await call("PUT", `/store/ChatSession/${sessionId}`, {
        character_id: characterId,
        mode: "solo",
        title: "Smoke test",
      });
      expect(sessRes.status).toBeLessThan(300);

      const chatRes = await call("POST", "/chat/messages", {
        session_id: sessionId,
        content: "Say hello in one short sentence and include the word Anima.",
        character_id: characterId,
        mode: "solo",
        persist: true,
      });
      const text = await chatRes.text();
      expect(chatRes.status, text.slice(0, 500)).toBe(200);

      let full = "";
      for (const line of text.split("\n")) {
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6);
        if (payload === "[DONE]") continue;
        try {
          const evt = JSON.parse(payload) as { content?: string };
          if (typeof evt.content === "string") full += evt.content;
        } catch {
          // ignore
        }
      }

      expect(full.trim().length).toBeGreaterThan(0);
      expect(full.toLowerCase()).toContain("anima");
    },
    120_000,
  );
});
