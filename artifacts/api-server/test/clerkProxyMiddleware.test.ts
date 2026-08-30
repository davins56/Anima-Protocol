import type { NextFunction, Request, Response } from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bindImportableEnv,
  resetCloudflareEnvBindingsForTests,
} from "../src/lib/cloudflareEnv";

vi.mock("../src/middlewares/clerkProxyFetch", () => ({
  handleClerkProxyRequest: vi.fn(async () => undefined),
}));

import { handleClerkProxyRequest } from "../src/middlewares/clerkProxyFetch";
import { clerkProxyMiddleware } from "../src/middlewares/clerkProxyMiddleware";

function mockRes() {
  const res = {
    headersSent: false,
    statusCode: 0,
    body: null as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
  return res as unknown as Response & { statusCode: number; body: unknown };
}

describe("clerkProxyMiddleware request-time secrets", () => {
  const savedSecret = process.env.CLERK_SECRET_KEY;
  const savedPublishable = process.env.CLERK_PUBLISHABLE_KEY;
  const savedNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    resetCloudflareEnvBindingsForTests();
    vi.mocked(handleClerkProxyRequest).mockClear();
    delete process.env.CLERK_SECRET_KEY;
    delete process.env.CLERK_PUBLISHABLE_KEY;
    process.env.NODE_ENV = "production";
  });

  afterEach(() => {
    resetCloudflareEnvBindingsForTests();
    if (savedSecret === undefined) delete process.env.CLERK_SECRET_KEY;
    else process.env.CLERK_SECRET_KEY = savedSecret;
    if (savedPublishable === undefined) delete process.env.CLERK_PUBLISHABLE_KEY;
    else process.env.CLERK_PUBLISHABLE_KEY = savedPublishable;
    process.env.NODE_ENV = savedNodeEnv;
  });

  it("constructs with empty env then proxies once secrets appear later", () => {
    const middleware = clerkProxyMiddleware();
    const req = {
      method: "GET",
      url: "/v1/environment",
      originalUrl: "/api/__clerk/v1/environment",
      headers: { host: "anima-protocol.com" },
    } as Request;
    const next = vi.fn() as NextFunction;

    const unavailable = mockRes();
    middleware(req, unavailable, next);
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.body).toMatchObject({
      error: "clerk_proxy_unavailable",
    });
    expect(handleClerkProxyRequest).not.toHaveBeenCalled();

    bindImportableEnv({
      CLERK_SECRET_KEY: "sk_live_later",
      CLERK_PUBLISHABLE_KEY: "pk_live_later",
    });

    const ready = mockRes();
    middleware(req, ready, next);
    expect(handleClerkProxyRequest).toHaveBeenCalledTimes(1);
    expect(vi.mocked(handleClerkProxyRequest).mock.calls[0]?.[2]).toBe(
      "sk_live_later",
    );
    expect(ready.statusCode).toBe(0);
  });

  it("rejects a publishable key used as CLERK_SECRET_KEY", () => {
    const middleware = clerkProxyMiddleware();
    bindImportableEnv({
      CLERK_SECRET_KEY: "pk_live_wrong",
      CLERK_PUBLISHABLE_KEY: "pk_live_later",
    });
    const res = mockRes();
    middleware(
      { headers: { host: "anima-protocol.com" } } as Request,
      res,
      vi.fn() as NextFunction,
    );
    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ error: "clerk_proxy_invalid_secret" });
    expect(handleClerkProxyRequest).not.toHaveBeenCalled();
  });
});
