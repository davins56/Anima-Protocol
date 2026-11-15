import { afterEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { headers: Record<string, string | undefined> }) => ({
    userId: req.headers["x-test-user"] ?? null,
  }),
}));

import { bindRequestEnv, resetCloudflareEnvBindingsForTests } from "../src/lib/cloudflareEnv";
import {
  checkUserLimit,
  getUserLimiter,
  resetUserLimiterForTests,
  scopeRules,
  userRateLimit,
} from "../src/lib/usage/userRateLimit";
import { applyHit, applyRefund, normalizeBook, type LimiterBook, type LimitRule } from "../src/lib/usage/limiterState";

/** A fake USER_RATE_LIMITER namespace: one shared book per object name, like the DO. */
function fakeNamespace() {
  const books = new Map<string, LimiterBook>();
  const names: string[] = [];
  const ns = {
    getByName(name: string) {
      names.push(name);
      if (!books.has(name)) books.set(name, normalizeBook(null));
      const book = books.get(name)!;
      return {
        hit: async (rules: LimitRule[], cost: number) => applyHit(book, rules, cost, Date.now()),
        refund: async (rules: LimitRule[], cost: number) => applyRefund(book, rules, cost, Date.now()),
      };
    },
  };
  return { ns, names };
}

const saved = { ...process.env };
afterEach(() => {
  resetUserLimiterForTests();
  resetCloudflareEnvBindingsForTests();
  for (const key of Object.keys(process.env)) if (key.startsWith("ANIMA_RL_")) delete process.env[key];
  Object.assign(process.env, saved);
});

describe("durable per-user rate limit", () => {
  it("reads limits from env", () => {
    expect(scopeRules("photo", { ANIMA_RL_PHOTO_PER_MIN: "2", ANIMA_RL_PHOTO_PER_DAY: "9" })).toEqual([
      { name: "photo:min", max: 2, windowMs: 60_000 },
      { name: "photo:day", max: 9, windowMs: 86_400_000 },
    ]);
    expect(scopeRules("photo", { ANIMA_RL_PHOTO_PER_MIN: "nope" })[0]!.max).toBe(6);
  });

  it("uses one Durable Object per user and holds across isolates", async () => {
    process.env.ANIMA_RL_CHAT_PROXY_PER_MIN = "2";
    const { ns, names } = fakeNamespace();
    bindRequestEnv({ USER_RATE_LIMITER: ns });
    expect((await checkUserLimit("user_a", "chat_proxy")).allowed).toBe(true);
    expect((await checkUserLimit("user_a", "chat_proxy")).allowed).toBe(true);
    // A fresh isolate: in-memory state is gone, the DO still remembers.
    resetUserLimiterForTests();
    expect((await checkUserLimit("user_a", "chat_proxy")).allowed).toBe(false);
    expect((await checkUserLimit("user_b", "chat_proxy")).allowed).toBe(true);
    expect(names).toContain("u:user_a");
    expect(names).toContain("u:user_b");
  });

  it("falls back to the in-process book when the DO call throws", async () => {
    process.env.ANIMA_RL_PHOTO_PER_MIN = "1";
    bindRequestEnv({
      USER_RATE_LIMITER: {
        getByName: () => ({
          hit: async () => {
            throw new Error("DO down");
          },
          refund: async () => {
            throw new Error("DO down");
          },
        }),
      },
    });
    const limiter = getUserLimiter();
    const rules = scopeRules("photo");
    expect((await limiter.hit("u", rules, 1)).allowed).toBe(true);
    expect((await limiter.hit("u", rules, 1)).allowed).toBe(false);
  });

  it("middleware answers 429 with Retry-After, and skips signed-out callers", async () => {
    process.env.ANIMA_RL_INVOKE_PER_MIN = "1";
    const app = express();
    app.post("/x", userRateLimit("invoke"), (_req, res) => res.json({ ok: true }));
    const server = app.listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const h = { "x-test-user": "user_mw" };
      expect((await fetch(`${base}/x`, { method: "POST", headers: h })).status).toBe(200);
      const limited = await fetch(`${base}/x`, { method: "POST", headers: h });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
      expect(await limited.json()).toMatchObject({ code: "rate_limit", scope: "invoke" });
      // Signed out: passes through (the real routes answer 401 themselves).
      expect((await fetch(`${base}/x`, { method: "POST" })).status).toBe(200);
    } finally {
      server.close();
    }
  });
});
