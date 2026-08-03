import { describe, expect, it, vi } from "vitest";
import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import {
  attachSignedOutAuth,
  isClerkConfigError,
  safeClerkMiddleware,
} from "../src/middlewares/clerkAuthFallback";

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    clerkMiddleware: () => {
      return (_req: Request, _res: Response, next: NextFunction) => {
        next(new Error("Publishable key not valid."));
      };
    },
  };
});

describe("clerkAuthFallback", () => {
  it("detects Clerk publishable-key config errors", () => {
    expect(isClerkConfigError(new Error("Publishable key not valid."))).toBe(
      true,
    );
    expect(
      isClerkConfigError(new Error("Publishable key is missing. Ensure that...")),
    ).toBe(true);
    expect(isClerkConfigError(new Error("network timeout"))).toBe(false);
  });

  it("brands signed-out auth so getAuth does not throw", () => {
    const req = {} as Request;
    attachSignedOutAuth(req);
    expect(() => getAuth(req)).not.toThrow();
    expect(getAuth(req).userId).toBeNull();
  });

  it("safeClerkMiddleware returns 503 for invalid publishable key instead of 500", () => {
    const middleware = safeClerkMiddleware();
    const req = {
      method: "GET",
      url: "/api/store/Character",
      originalUrl: "/api/store/Character",
      headers: { host: "www.anima-protocol.com" },
    } as Request;
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
    } as unknown as Response & { statusCode: number; body: unknown };
    const next = vi.fn() as NextFunction;

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(res.body).toEqual({
      error: "API is misconfigured on the server. Check environment variables.",
    });
  });
});
