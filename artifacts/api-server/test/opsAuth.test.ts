import { describe, expect, it } from "vitest";
import type { Request, Response } from "express";
import {
  configuredOpsSecrets,
  matchesOpsBearer,
  requireOpsBearer,
} from "../src/lib/opsAuth";

function fakeReq(headers: Record<string, string> = {}): Request {
  return {
    header(name: string) {
      const key = name.toLowerCase();
      const found = Object.entries(headers).find(
        ([k]) => k.toLowerCase() === key,
      );
      return found?.[1];
    },
  } as Request;
}

describe("opsAuth", () => {
  const savedAdmin = process.env.ADMIN_MIGRATION_SECRET;
  const savedCron = process.env.CRON_SECRET;

  function restore() {
    if (savedAdmin === undefined) delete process.env.ADMIN_MIGRATION_SECRET;
    else process.env.ADMIN_MIGRATION_SECRET = savedAdmin;
    if (savedCron === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = savedCron;
  }

  it("matches ADMIN_MIGRATION_SECRET or CRON_SECRET bearers", () => {
    process.env.ADMIN_MIGRATION_SECRET = "admin-secret";
    process.env.CRON_SECRET = "cron-secret";
    expect(configuredOpsSecrets()).toEqual(["admin-secret", "cron-secret"]);
    expect(matchesOpsBearer(fakeReq({ authorization: "Bearer admin-secret" }))).toBe(true);
    expect(matchesOpsBearer(fakeReq({ authorization: "Bearer cron-secret" }))).toBe(true);
    expect(matchesOpsBearer(fakeReq({ "x-admin-migration-secret": "admin-secret" }))).toBe(true);
    expect(matchesOpsBearer(fakeReq({ authorization: "Bearer nope" }))).toBe(false);
    restore();
  });

  it("returns 503 when no operator secret is configured", () => {
    delete process.env.ADMIN_MIGRATION_SECRET;
    delete process.env.CRON_SECRET;
    let status = 0;
    let body: unknown;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    } as Response;
    let nextCalled = false;
    requireOpsBearer(fakeReq({ authorization: "Bearer anything" }), res, () => {
      nextCalled = true;
    });
    expect(nextCalled).toBe(false);
    expect(status).toBe(503);
    expect(body).toMatchObject({ code: "ops_secret_unconfigured" });
    restore();
  });
});
