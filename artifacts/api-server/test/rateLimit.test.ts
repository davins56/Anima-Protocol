import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

vi.mock("@clerk/express", () => ({
  getAuth: (req: { auth?: { userId?: string | null } }) => ({
    userId: req.auth?.userId ?? null,
  }),
}));

import {
  createRateLimit,
  rateLimitKey,
  resetRateLimitStateForTests,
} from "../src/lib/rateLimit";

function mockRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
      return this;
    },
  };
  return res as unknown as Response & {
    statusCode: number;
    body: { error?: string; code?: string } | null;
    headers: Record<string, string>;
  };
}

function mockReq(overrides: Partial<Request> & { auth?: { userId?: string } } = {}) {
  return {
    ip: "203.0.113.10",
    headers: {},
    socket: { remoteAddress: "203.0.113.10" },
    auth: undefined,
    ...overrides,
  } as unknown as Request;
}

describe("rateLimitKey", () => {
  it("prefers the signed-in Clerk user over IP", () => {
    const req = mockReq({ auth: { userId: "user_123" }, ip: "203.0.113.10" });
    expect(rateLimitKey(req, "chat")).toBe("chat:user:user_123");
  });

  it("falls back to IP when unsigned", () => {
    const req = mockReq({ ip: "198.51.100.20" });
    expect(rateLimitKey(req, "chat")).toBe("chat:ip:198.51.100.20");
  });
});

describe("createRateLimit", () => {
  afterEach(() => {
    resetRateLimitStateForTests();
  });

  it("allows traffic under the max", () => {
    const limit = createRateLimit({ name: "test", max: 2, windowMs: 60_000 });
    const req = mockReq({ auth: { userId: "user_a" } });
    const next = vi.fn();

    limit(req, mockRes(), next);
    limit(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });

  it("blocks the same user after max and keeps another user unaffected", () => {
    const limit = createRateLimit({ name: "test", max: 2, windowMs: 60_000 });
    const userA = mockReq({ auth: { userId: "user_a" } });
    const userB = mockReq({ auth: { userId: "user_b" } });
    const next = vi.fn();

    limit(userA, mockRes(), next);
    limit(userA, mockRes(), next);
    const blocked = mockRes();
    limit(userA, blocked, next);
    expect(blocked.statusCode).toBe(429);
    expect(blocked.body?.code).toBe("rate_limit");
    expect(blocked.body?.error).toMatch(/Too many requests/i);
    expect(blocked.headers["Retry-After"]).toBeTruthy();

    const nextB = vi.fn();
    limit(userB, mockRes(), nextB);
    expect(nextB).toHaveBeenCalledTimes(1);
  });

  it("does not share a bucket across named limiters", () => {
    const chat = createRateLimit({ name: "chat", max: 1, windowMs: 60_000 });
    const openai = createRateLimit({ name: "openai", max: 1, windowMs: 60_000 });
    const req = mockReq({ auth: { userId: "user_a" } });
    const next = vi.fn();

    chat(req, mockRes(), next);
    openai(req, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
  });
});
