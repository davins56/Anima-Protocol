import { describe, expect, it, vi } from "vitest";
import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { clerkMultiDomainMiddleware } from "../src/middlewares/clerkMultiDomainMiddleware";

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    createClerkClient: () => ({
      authenticateRequest: vi.fn(async () => {
        throw new Error("clerk unavailable");
      }),
    }),
  };
});

describe("clerkMultiDomainMiddleware", () => {
  it("attaches signed-out auth when Clerk verification fails so getAuth does not throw", async () => {
    const middleware = clerkMultiDomainMiddleware();
    const req = {
      method: "POST",
      url: "/api/store/Character/bulk-upsert",
      originalUrl: "/api/store/Character/bulk-upsert",
      headers: {
        host: "www.anima-protocol.com",
        authorization: "Bearer test-token",
        "x-anima-public-host": "www.anima-protocol.com",
      },
    } as Request;
    const res = {} as Response;
    const next = vi.fn() as NextFunction;

    await middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(() => getAuth(req)).not.toThrow();
    expect(getAuth(req).userId).toBeNull();
  });
});
